'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
'use client';

import type { VisibilityType, CommentSubmitPayload } from '@/app/types/comments';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Document, Page, pdfjs } from 'react-pdf';
import { List } from 'react-window';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

import CommentComposerModal from './CommentComposerModal';
import CommentsPanel, { type Comment } from './CommentsPanel';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Group, Panel, Separator } from "react-resizable-panels";

function ResizeHandle() {
  return (
    <Separator className="w-2 relative group">
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-gray-200 group-hover:bg-gray-300" />
    </Separator>
  );
}

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
  const commentCounts = comments.reduce<Record<number, number>>((acc, c) => {
    const p = Number(c.page);
    if (!Number.isFinite(p)) return acc;
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  // Comment input
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<'add' | 'edit'>('add');
  const [composerPage, setComposerPage] = useState<number>(1);
  const [editCommentId, setEditCommentId] = useState<string | null>(null);
  const [composerInitialText, setComposerInitialText] = useState<string>('');
  //session User ID
  const [sessionUserId, setSessionUserId] = useState<string | undefined>(undefined);
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
  // set require log in 
  const [requireLogin, setRequireLogin] = useState<boolean>(true);
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
  //isStarred determines if use has starred a poster
  const [isStarred, setIsStarred] = useState(false);
  useEffect(() => {
    // Always snap back to fit whenever slide changes or orientation changes
    resetTransformRef.current?.();
    setMobileZoomed(false);
  }, [pageNumber, isLandscape]);
  // Keep comment panel synced to current slide (mobile + desktop)
  useEffect(() => {
    setCommentTargetPage(pageNumber);
  }, [pageNumber]);
  //add arrow controls for desktop slide viewer
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // don’t hijack typing
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (t as any)?.isContentEditable) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPageNumber((p) => Math.max(1, p - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPageNumber((p) => Math.min(numPages || p, p + 1));
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, [numPages, setPageNumber]);
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
  //handles starred posters
  useEffect(() => {
    let cancelled = false;

    async function loadStarStatus() {
      try {
        const res = await fetch("/api/stars", { cache: "no-store" });
        if (!res.ok) return;

        const stars = await res.json();
        if (cancelled) return;

        const starred = Array.isArray(stars)
          ? stars.some((s) => s.posterId === posterId)
          : false;

        setIsStarred(starred);
      } catch (e) {
        console.error("Failed to load star status:", e);
      }
    }

    if (posterId) loadStarStatus();

    return () => {
      cancelled = true;
    };
  }, [posterId]);
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
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posterId]);

  async function fetchConfig() {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      // support either shape: { requireLogin } or { requireLogin: {..} }
      setRequireLogin(Boolean(j?.requireLogin ?? j?.config?.requireLogin));
    } catch {
      // default stays true
    }
  }
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
  async function toggleStar(posterId: string, starred: boolean) {
    if (starred) {
      await fetch(`/api/stars?posterId=${posterId}`, {
        method: "DELETE",
      });
      setIsStarred(false);
    } else {
      await fetch("/api/stars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterId }),
      });
      setIsStarred(true);
    }
  }


  async function fetchComments() {
    try {
      setLoadingComments(true);
      const res = await fetch(`/api/comments?posterId=${posterId}`);
      if (!res.ok) return;

      const data = await res.json();

      setSessionUserId(data?.sessionUserId ? String(data.sessionUserId) : undefined);

      setComments(
        ((data?.comments || []) as any[]).map((c: any) => ({
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


  async function addComment(targetPage: number, text: string, visibilityType: VisibilityType) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posterId,
        page: targetPage,
        text: trimmed,
        visibilityType,
      }),
    });

    if (res.status === 401) {
      alert('Please log in to comment.');
      return;
    }

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
    if (!requireLogin) return; // passwords off => no commenting
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
                <img src="/1stcite-logo.png" alt="1stCite" className="h-10 w-auto" />
              </Link>
            </div>
          </div>
        )}
        <button
          onClick={() => toggleStar(posterId, isStarred)}
          className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm text-gray-900 hover:bg-gray-50"
          title={isStarred ? "Remove star" : "Star this presentation"}
        >
          {isStarred ? "★ Starred" : "☆ Star"}
        </button>
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
                {requireLogin && (
                  <button
                    type="button"
                    onClick={openCommentComposer}
                    className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium"
                  >
                    Comment
                  </button>
                )}
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
                {requireLogin && (
                  <button
                    type="button"
                    onClick={openCommentComposer}
                    className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium"
                  >
                    Comment
                  </button>
                )}
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
                {requireLogin && (
                  <button
                    type="button"
                    onClick={openCommentComposer}
                    className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium"
                  >
                    Comment
                  </button>
                )}
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
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{c.author || 'Attendee'}</span>

                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-white text-gray-700">
                              {((c as any).visibilityType ?? 'public') === 'note'
                                ? 'Note'
                                : ((c as any).visibilityType ?? 'public') === 'question'
                                  ? 'Question'
                                  : 'Public'}
                            </span>
                          </div>

                          <span>
                            {c.timestamp instanceof Date
                              ? c.timestamp.toLocaleString()
                              : new Date(c.timestamp as any).toLocaleString()}
                          </span>
                        </div>

                        <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{c.text}</div>

                        {sessionUserId && String((c as any).userId) === String(sessionUserId) && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              className="text-xs text-red-700"
                              onClick={() => handleDeleteComment(c)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
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
              {mobileZoomed ? 'Drag to move • Pinch to zoom • Fit to reset' : 'Use arrow keys or swipe to change slides'}
            </div>
          )}
        </div>

        {/* Modal composer */}
        {requireLogin && (
          <CommentComposerModal
            open={composerOpen}
            mode={composerMode}
            page={composerPage}
            numPages={numPages}
            initialText={composerInitialText}
            onClose={() => setComposerOpen(false)}
            onSubmit={async ({ text, visibilityType }) => {
              await addComment(composerPage, text, visibilityType);
              setComposerOpen(false);
            }}
          />
        )}

        {/**************** DESKTOP ***********/}
        {/* DESKTOP (resizable panels) */}
        <div className="hidden lg:block lg:px-4 lg:py-4 lg:h-[calc(100vh-76px)]">
          <Group orientation="horizontal" className="h-full w-full">
            {/* LEFT (wide): slide on top, thumbnails grid below */}
            <Panel defaultSize="70%" minSize="45%" maxSize="80%" className="min-w-0 h-full">
              <div className="min-w-0 h-full grid grid-rows-[auto_minmax(0,1fr)] gap-3">
                {/* Top: slide viewer */}
                <div
                  ref={centerMeasure.ref}
                  className="min-w-0 rounded-lg border bg-white overflow-hidden"
                  style={{ maxHeight: 'calc(100vh - 76px - 240px - 12px)' }} // leave ~240px + gap for grid
                >
                  <div className="h-full min-h-0 overflow-x-auto overflow-y-auto" style={{ touchAction: 'none' }}>


                    <div className="p-3">
                      <div className="mx-auto w-full">
                        <div className="w-full flex justify-left">
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
                                'relative rounded-lg border bg-white hover:bg-gray-50 overflow-hidden text-left',
                                active ? 'border-blue-600 ring-1 ring-blue-200' : 'border-gray-200',
                              ].join(' ')}
                            >
                              {commentCounts[p] > 0 && (
                                <div className="absolute bottom-3 right-3 flex items-center gap-1 text-gray-900 text-xs font-medium">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-3.5 w-3.5"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path d="M18 10c0 3.866-3.582 7-8 7a8.84 8.84 0 01-3.716-.78L2 17l1.02-3.06A6.73 6.73 0 012 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" />
                                  </svg>
                                  {commentCounts[p]}
                                </div>
                              )}

                              <div className="p-2">
                                <div className="flex justify-center items-center">
                                  <Page
                                    pageNumber={p}
                                    width={150}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                  />
                                </div>
                                <div className="mt-2 text-xs text-gray-600 text-left">
                                  Slide {p}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>

            {/* RESIZE HANDLE */}
            <Separator className="w-2 relative group cursor-col-resize">
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-gray-200 group-hover:bg-gray-300" />
            </Separator>

            {/* RIGHT (narrow): comments only */}
            <Panel defaultSize="30%" minSize="20%" maxSize="55%" className="min-w-0 h-full">
              <div className="min-w-0 h-full rounded-lg border overflow-hidden bg-white">
                <CommentsPanel
                  page={pageNumber}
                  numPages={numPages || 0}
                  loading={loadingComments}
                  comments={pageComments}
                  sessionUserId={sessionUserId}
                  onOpenAdd={openCommentComposer}
                  onDelete={handleDeleteComment}
                />
              </div>
            </Panel>
          </Group>
        </div>
      </div>

    </Document>
  );
}