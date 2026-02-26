'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Document, Page, pdfjs } from 'react-pdf';
import { List } from 'react-window';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

import CommentComposerModal from './CommentComposerModal';
import CommentsPanel, { type Comment } from './CommentsPanel';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

type Poster = {
  id: string;
  title?: string;
  author?: string;
  fileUrl?: string;
  filepath?: string;
};

/**
 * Measure any element using ResizeObserver.
 * (Keep this hook pure — do NOT put component state inside it.)
 */
function useMeasure<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [rect, setRect] = useState({ width: 0, height: 0 });

  const lastNodeRef = useRef<T | null>(null);
  const ref = React.useCallback((el: T | null) => {
    if (lastNodeRef.current === el) return;
    lastNodeRef.current = el;
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;

    const update = () => {
      const cr = node.getBoundingClientRect();
      setRect({ width: cr.width, height: cr.height });
    };

    update();
    requestAnimationFrame(update); // helps avoid initial 0-width on first paint

    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  return { ref, rect };
}

/**
 * VisualViewport size (more reliable than div measurement on iOS Safari).
 */
function useVisualViewportSize() {
  const [vv, setVv] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => {
      setVv({
        w: window.visualViewport?.width ?? window.innerWidth,
        h: window.visualViewport?.height ?? window.innerHeight,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return vv;
}

//*************POSTERVIEWER FUNCTION *************************
export default function PosterViewer({ posterId }: { posterId: string }) {
  const router = useRouter();

  // --- refs used by mobile zoom ---
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null);
  const resetTransformRef = useRef<null | (() => void)>(null);

  // Poster metadata
  const [poster, setPoster] = useState<Poster | null>(null);
  const [error, setError] = useState('');

  // PDF state
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

  // Comments
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentTargetPage, setCommentTargetPage] = useState<number>(1);

  // Comment input
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<'add' | 'edit'>('add');
  const [composerPage, setComposerPage] = useState<number>(1);
  const [editCommentId, setEditCommentId] = useState<string | null>(null);
  const [composerInitialText, setComposerInitialText] = useState<string>('');

  // Responsive
  const [isLandscape, setIsLandscape] = useState(false);

  // Measurements (top-level hooks)
  const centerMeasure = useMeasure<HTMLDivElement>();
  const mobileMeasure = useMeasure<HTMLDivElement>();

  // Fullscreen (mobile)
  const [mobileFullScreen, setMobileFullScreen] = useState(false);

  // Visual viewport (iOS-safe sizing)
  const vv = useVisualViewportSize();

  // Capture intrinsic PDF page size (scale=1 viewport)
  const [pageBase, setPageBase] = useState<{ w: number; h: number } | null>(null);

  // Mobile zoom state (drives swipe gating + messaging)
  const [mobileZoomed, setMobileZoomed] = useState(false);

  // Swipe-to-change-slide (only when not zoomed)
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);

  const [lowerPanel, setLowerPanel] = useState<'thumbs' | 'comments'>('thumbs');

  function onSwipeStart(e: React.TouchEvent) {
    if (mobileZoomed) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onSwipeEnd(e: React.TouchEvent) {
    if (mobileZoomed) return;
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;

    if (dt > 800) return;
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0) {
      const next = Math.min(numPages || pageNumber, pageNumber + 1);
      setPageNumber(next);
    } else {
      const prev = Math.max(1, pageNumber - 1);
      setPageNumber(prev);
    }
  }
  useEffect(() => {
    // Always snap back to fit whenever slide changes or orientation changes
    resetTransformRef.current?.();
    setMobileZoomed(false);
  }, [pageNumber, isLandscape]);
  // Keep comment panel synced to current slide (mobile + desktop)
  useEffect(() => {
    setCommentTargetPage(pageNumber);
  }, [pageNumber]);

  // Prevent iOS Safari viewport zoom ONLY inside the zoom surface
  useEffect(() => {
    const el = zoomSurfaceRef.current;
    if (!el) return;

    const blockPageZoom = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    };

    el.addEventListener('touchstart', blockPageZoom, { passive: false });
    el.addEventListener('touchmove', blockPageZoom, { passive: false });

    return () => {
      el.removeEventListener('touchstart', blockPageZoom as any);
      el.removeEventListener('touchmove', blockPageZoom as any);
    };
  }, []);

  // pdf.js worker
  useEffect(() => {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }, []);

  // Track orientation
  useEffect(() => {
    const update = () => {
      setIsLandscape(window.matchMedia('(orientation: landscape)').matches);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Load poster + comments
  useEffect(() => {
    fetchPoster();
    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posterId]);

  async function fetchPoster() {
    try {
      setPoster(null);
      setError('');

      const res = await fetch(`/api/posters/${posterId}`);
      if (!res.ok) {
        setError(`Failed to load poster (${res.status})`);
        return;
      }
      const data = await res.json();
      setPoster(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function fetchComments() {
    try {
      setLoadingComments(true);
      const res = await fetch(`/api/comments?posterId=${posterId}`);
      if (!res.ok) return;
      const data = await res.json();
      setComments(
        (data || []).map((c: any) => ({
          ...c,
          timestamp: new Date(c.timestamp),
        }))
      );
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleDeleteComment(c: { _id?: string; id?: string }) {
    const id = c._id || c.id;
    if (!id) return;
    if (!confirm('Delete this comment?')) return;

    try {
      const res = await fetch(`/api/comments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('Failed to delete comment.');
        return;
      }
      await fetchComments();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed.');
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this presentation?')) return;

    const res = await fetch(`/api/posters/${posterId}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(j?.error ?? 'Delete failed');
      return;
    }

    router.push('/');
    router.refresh();
  }

  const pdfUrl = useMemo(() => poster?.fileUrl || poster?.filepath || '', [poster]);

  const pageComments = useMemo(
    () => comments.filter((c) => c.page === commentTargetPage),
    [comments, commentTargetPage]
  );

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPageNumber((prev) => (prev < 1 ? 1 : prev > numPages ? numPages : prev));
  }

  async function addComment(targetPage: number, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posterId,
        page: targetPage,
        text: trimmed,
        author: 'Anonymous',
      }),
    });

    if (!res.ok) {
      alert('Failed to save comment');
      return;
    }

    const saved = await res.json();
    setComments((prev) => [...prev, { ...saved, timestamp: new Date(saved.timestamp) }]);
  }
 
  //Set up isMobileLandscape indicator variable
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 1024); // Tailwind lg breakpoint
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const isMobileLandscape = isMobile && isLandscape;

  // Desktop center width
  const centerPageWidth = useMemo(() => {
    const w = centerMeasure.rect.width || 0;
    return Math.max(320, Math.floor(w - 48));
  }, [centerMeasure.rect.width]);

  // Mobile measured width (from the actual viewer box)
  const mobileW = mobileMeasure.rect.width || 0;
  const mobilePageWidth = useMemo(() => {
    // If the measured box is 0 (first paint / transition), do NOT force 320;
    // let the UI show Loading… until measurement is real.
    if (mobileW <= 0) return 0;
    return Math.max(240, Math.floor(mobileW)); // viewer box already includes padding; don't subtract again
  }, [mobileW]);

  /**
   * Phase 1 (STABLE): In landscape, DO NOT try to "fit" using TransformWrapper scale.
   * Instead compute a width that guarantees the page height fits into the available viewport height.
   * Then render <Page width={fitWidth}> and keep Transform scale at 1.
   */
  const chromeY = useMemo(() => {
    // Fullscreen landscape applies only on MOBILE (desktop is usually landscape too)
    if (isMobileLandscape) return 0;

    // Portrait behavior unchanged
    if (mobileFullScreen) return 56; // overlay toolbar height (if you still use it elsewhere)
    return 56 + 48 + 24;
  }, [isMobileLandscape, mobileFullScreen]);

  const availH = useMemo(() => {
    const h = vv.h || (typeof window !== 'undefined' ? window.innerHeight : 0);
    return Math.max(120, h - chromeY - 16);
  }, [vv.h, chromeY]);

  const fitWidth = useMemo(() => {
    if (!mobilePageWidth) return 0;
    if (!pageBase) return mobilePageWidth;
    if (!isMobileLandscape) return mobilePageWidth;

    // width needed so that renderedHeight <= availH
    const widthForAvailH = (availH * pageBase.w) / pageBase.h;

    // never exceed container width
    return Math.max(240, Math.floor(Math.min(mobilePageWidth, widthForAvailH)));
  }, [mobilePageWidth, pageBase, isMobileLandscape, availH]);

  // ---- Virtualized mini navigator (react-window v2) ----
  type NavRowExtraProps = {
    currentPage: number;
    onJump: (p: number) => void;
    thumbWidth: number;
  };

  const MiniPdfNavigator = ({
    numPages,
    currentPage,
    onJump,
  }: {
    numPages: number;
    currentPage: number;
    onJump: (page: number) => void;
  }) => {
    const { ref, rect } = useMeasure<HTMLDivElement>();

    const thumbWidth = Math.max(140, Math.floor(rect.width) - 16);
    const thumbHeight = Math.round(thumbWidth * 0.72);
    const rowHeight = thumbHeight + 44;

    const NavRow = ({
      index,
      style,
      currentPage,
      onJump,
      thumbWidth,
    }: {
      index: number;
      style: React.CSSProperties;
    } & NavRowExtraProps) => {
      const page = index + 1;
      const isActive = page === currentPage;

      return (
        <div style={style} className="px-2 py-2">
          <button
            onClick={() => onJump(page)}
            className={[
              'w-full rounded-lg border bg-white hover:bg-gray-50 overflow-hidden',
              isActive ? 'border-blue-600 ring-1 ring-blue-200' : 'border-gray-200',
            ].join(' ')}
          >
            <div className="p-2">
              <div className="flex justify-center items-center" style={{ height: thumbHeight }}>
                <Page pageNumber={page} width={thumbWidth} renderTextLayer={false} renderAnnotationLayer={false} />
              </div>
              <div className="mt-2 text-xs text-gray-600 text-center">Slide {page}</div>
            </div>
          </button>
        </div>
      );
    };

    return (
      <div className="h-full flex flex-col bg-gray-50">
        <div className="p-3 border-b bg-white">
          <div className="text-sm font-semibold text-gray-700">Slides</div>
          <div className="text-xs text-gray-700">Click a slide to jump</div>
        </div>

        <div ref={ref} className="flex-1">
          {rect.height > 0 && rect.width > 0 && numPages > 0 ? (
            <List<NavRowExtraProps>
              rowComponent={NavRow}
              rowCount={numPages}
              rowHeight={rowHeight}
              rowProps={{ currentPage, onJump, thumbWidth }}
              overscanCount={3}
              defaultHeight={400}
              style={{ height: rect.height, width: rect.width }}
            />
          ) : (
            <div className="p-4 text-sm text-gray-700">Loading…</div>
          )}
        </div>
      </div>
    );
  };

  // ---------------- Render ----------------
  if (!poster) {
    return (
      <div className="min-h-[100dvh] bg-gray-50 p-8">
        <Link href="/" className="text-blue-600">
          ← Back
        </Link>
        <div className="mt-6 bg-white p-6 rounded shadow">
          <p>Loading presentation…</p>
          {error && <p className="text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    );
  }

  const openCommentComposer = () => {
    resetTransformRef.current?.();
    setMobileZoomed(false);

    setComposerMode('add');
    setComposerPage(pageNumber);
    setComposerInitialText('');
    setEditCommentId(null);
    setComposerOpen(true);
  };

  return (
    <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess}>
      <div className="min-h-[100dvh] bg-gray-50">
        {/* Top bar (hidden during mobile fullscreen) */}
        {!mobileFullScreen && !isMobileLandscape && (
          <div className="sticky top-0 z-40 bg-white border-b">
            <div className="mx-auto max-w-6xl px-3 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Link href="/" className="text-blue-600 text-sm whitespace-nowrap">
                  ← Back
                </Link>

                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-gray-900">{poster.title || 'Untitled'}</div>
                  <div className="truncate text-xs text-gray-700">{poster.author ? `by ${poster.author}` : ''}</div>
                </div>
              </div>

              <Link href="/" className="shrink-0">
                <img src="/presentrxiv-logo.png" alt="PresentrXiv" className="h-10 w-auto" />
              </Link>
            </div>
          </div>
        )}

        {/* ************MOBILE (2-mode: portrait + landscape-fullscreen) ************ */}
        <div
          className={
            isMobileLandscape
              ? 'fixed inset-0 z-[999] bg-black lg:hidden'
              : 'block lg:hidden px-3 py-4 space-y-3'
          }
        >
          {/* Portrait header row */}
          {!isMobileLandscape && (
            <div className="flex items-center justify-between w-full">
              <div className="text-sm font-medium text-gray-900">
                Slide {pageNumber} / {numPages || '?'}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetTransformRef.current?.();
                    setMobileZoomed(false);
                  }}
                  className="px-2 py-1.5 rounded border bg-white text-sm text-gray-700"
                >
                  Fit
                </button>

                <button
                  type="button"
                  onClick={openCommentComposer}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium"
                >
                  Comment
                </button>
              </div>
            </div>
          )}

          {/* Viewer container */}
          <div
            ref={mobileMeasure.ref}
            className={
              isMobileLandscape
                ? 'absolute inset-0 overflow-hidden'
                : 'w-full bg-white rounded-lg border p-2 max-w-full overflow-hidden max-h-[55dvh]'
            }
            onTouchStart={onSwipeStart}
            onTouchEnd={onSwipeEnd}
          >
            <div className="relative z-0 w-full h-full bg-white overflow-hidden">
              {mobilePageWidth <= 0 || fitWidth <= 0 ? (
                <div className="p-4 text-sm text-gray-700">Loading…</div>
              ) : (
                <TransformWrapper
                  key={`${pageNumber}-${isMobileLandscape ? `L-${fitWidth}` : `P-${mobilePageWidth}`}`}
                  initialScale={1}
                  minScale={1}
                  maxScale={4}
                  wheel={{ disabled: true }}
                  doubleClick={{ mode: 'reset' }}
                  panning={{ disabled: false, velocityDisabled: true }}
                  onZoomStop={(ref: any) => setMobileZoomed((ref?.state?.scale ?? 1) > 1.02)}
                  onPanningStop={(ref: any) => setMobileZoomed((ref?.state?.scale ?? 1) > 1.02)}
                  onPinchingStop={(ref: any) => setMobileZoomed((ref?.state?.scale ?? 1) > 1.02)}
                >
                  {({ resetTransform }) => {
                    resetTransformRef.current = resetTransform;

                    return (
                      <TransformComponent
                        wrapperStyle={{ width: '100%', height: '100%' }}
                        contentStyle={{ width: '100%', height: '100%' }}
                      >
                        <div
                          ref={zoomSurfaceRef}
                          style={{ touchAction: 'none' }}
                          className="w-full h-full flex items-center justify-center"
                        >
                          <Page
                            key={`${pageNumber}`}
                            pageNumber={pageNumber}
                            width={isMobileLandscape ? fitWidth : mobilePageWidth}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            onLoadSuccess={(page: any) => {
                              try {
                                const vp = page.getViewport({ scale: 1 });
                                setPageBase({ w: vp.width, h: vp.height });
                              } catch {
                                // ignore
                              }
                            }}
                          />
                        </div>
                      </TransformComponent>
                    );
                  }}
                </TransformWrapper>
              )}
            </div>
          </div>

          {/* Landscape right rail */}
          {isMobileLandscape && (
            <div className="fixed right-2 top-1/2 -translate-y-1/2 z-[2000] pointer-events-none lg:hidden">
              <div className="flex flex-col gap-2 pointer-events-auto">
                <div className="px-3 py-2 rounded-lg bg-white/90 border shadow text-sm text-gray-900">
                  {pageNumber}/{numPages || '?'}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    resetTransformRef.current?.();
                    setMobileZoomed(false);
                  }}
                  className="px-3 py-2 rounded-lg bg-white/90 border shadow text-sm text-gray-900"
                >
                  Fit
                </button>

                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  className="px-3 py-2 rounded-lg bg-white/90 border shadow text-sm text-gray-900 disabled:opacity-40 disabled:shadow-none"
                >
                  Prev
                </button>

                <button
                  type="button"
                  disabled={numPages === 0 || pageNumber >= numPages}
                  onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                  className="px-3 py-2 rounded-lg bg-white/90 border shadow text-sm text-gray-900 disabled:opacity-40 disabled:shadow-none"
                >
                  Next
                </button>

                <button
                  type="button"
                  onClick={openCommentComposer}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white shadow text-sm font-medium"
                >
                  Comment
                </button>
              </div>
            </div>
          )}
  {/* Portrait comments */}
  {!isLandscape && (
    <div className="bg-white rounded-lg border">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="text-sm font-semibold text-gray-800">
          Comments <span className="text-gray-500 font-normal">({pageComments.length})</span>
        </div>

        <button
          type="button"
          onClick={openCommentComposer}
          className="px-2 py-1.5 rounded bg-blue-600 text-white text-sm"
        >
          Add
        </button>
      </div>

      <div className="max-h-[35dvh] overflow-y-auto px-3 py-2">
        {loadingComments ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : pageComments.length === 0 ? (
          <div className="text-sm text-gray-600">No comments yet.</div>
        ) : (
          <div className="space-y-2">
            {pageComments.map((c) => (
              <div key={c._id || c.id} className="rounded border border-gray-200 bg-gray-50 p-2">
                <div className="text-xs text-gray-500 flex items-center justify-between">
                  <span>{c.author || 'Anonymous'}</span>
                  <span>
                    {c.timestamp instanceof Date
                      ? c.timestamp.toLocaleString()
                      : new Date(c.timestamp as any).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{c.text}</div>
                <div className="mt-2 flex justify-end">
                  <button type="button" className="text-xs text-red-700" onClick={() => handleDeleteComment(c)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )}

  {/* Portrait footer hint */}
  {!isLandscape && (
    <div className="text-center text-xs text-gray-700">
      {mobileZoomed ? 'Drag to move • Pinch to zoom • Fit to reset' : 'Swipe to change slides'}
    </div>
  )}
</div>

        {/* Modal composer */}
        <CommentComposerModal
          open={composerOpen}
          mode={composerMode}
          page={composerPage}
          numPages={numPages}
          initialText={composerInitialText}
          onClose={() => setComposerOpen(false)}
          onSubmit={async (text) => {
            await addComment(composerPage, text);
            setComposerOpen(false);
          }}
        />

      {/**************** DESKTOP ***********/}
{/* DESKTOP */}
<div className="hidden lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-3 lg:px-4 lg:py-4 lg:h-[calc(100vh-76px)] xl:gap-4">
  {/* LEFT (wide): slide on top, thumbnails grid below */}
  <div className="min-w-0 h-full grid grid-rows-[auto_minmax(0,1fr)] gap-3">
    {/* Top: slide viewer */}
    <div
  ref={centerMeasure.ref}
  className="min-w-0 rounded-lg border bg-white overflow-hidden"
  style={{ maxHeight: 'calc(100vh - 76px - 240px - 12px)' }} // leave ~240px + gap for grid
>
      <div className="h-full min-h-0 overflow-x-auto overflow-y-auto" style={{ touchAction: 'none' }}>
        <div className="p-3 border-b flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Slide <span className="font-semibold text-gray-700">{pageNumber}</span> of{' '}
            <span className="font-semibold text-gray-700">{numPages || '…'}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:bg-gray-300"
            >
              Prev
            </button>
            <button
              disabled={numPages === 0 || pageNumber >= numPages}
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:bg-gray-300"
            >
              Next
            </button>
          </div>
        </div>

        <div className="p-3">
          <div className="mx-auto w-full">
            <div className="w-full flex justify-center">
              <Page
                pageNumber={pageNumber}
                width={centerPageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="mx-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Bottom: thumbnails grid (no header/buttons) */}
    <div className="rounded-lg border bg-white overflow-hidden min-h-0">
      {numPages > 0 ? (
        <div className="h-full overflow-y-auto p-3" style={{ scrollbarGutter: 'stable' }}>
          <div className="grid grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {Array.from({ length: numPages }).map((_, idx) => {
              const p = idx + 1;
              const active = p === pageNumber;

              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPageNumber(p)}
                  className={[
                    'rounded-lg border bg-white hover:bg-gray-50 overflow-hidden text-left',
                    active ? 'border-blue-600 ring-1 ring-blue-200' : 'border-gray-200',
                  ].join(' ')}
                >
                  <div className="p-2">
                    <div className="flex justify-center items-center">
                      <Page pageNumber={p} width={150} renderTextLayer={false} renderAnnotationLayer={false} />
                    </div>
                    <div className="mt-2 text-xs text-gray-600 text-center">Slide {p}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-4 text-sm text-gray-700">Loading…</div>
      )}
    </div>
  </div>

  {/* RIGHT (narrow): comments only */}
  <div className="min-w-0 h-full rounded-lg border overflow-hidden bg-white">
    <CommentsPanel
      page={pageNumber}
      numPages={numPages || 0}
      loading={loadingComments}
      comments={pageComments}
      onOpenAdd={openCommentComposer}
      onDelete={handleDeleteComment}
    />
  </div>
</div>

          {/* Delete */}
          <div className="border-t mt-12 pt-6 col-span-3">
            <div className="max-w-6xl mx-auto px-4 flex justify-end">
              <button
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition"
              >
                Delete Presentation
              </button>
            </div>
          </div>
        </div>

    </Document>
  );
}