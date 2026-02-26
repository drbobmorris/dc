'use client';

import React from 'react';

export type Comment = {
  _id?: string;
  id?: string;
  posterId: string;
  page: number;
  text: string;
  author?: string;
  timestamp: Date;
};

function getId(c: Comment) {
  return c._id || c.id || `${c.posterId}-${c.page}-${c.timestamp.toISOString()}`;
}

type CommentsPanelProps = {
  compactHeader?: boolean;
  page: number;
  numPages: number;
  loading: boolean;
  comments: Comment[];
  onOpenAdd: () => void;
  onDelete: (c: Comment) => void; // <-- NEW
};

export default function CommentsPanel({
  compactHeader,
  page,
  numPages,
  loading,
  comments,
  onOpenAdd,
  onDelete,
}: CommentsPanelProps) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* HEADER (never scrolls) */}
      <div className="shrink-0 border-b bg-white px-3 py-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800">
          Comments <span className="text-gray-500 font-normal">({comments.length})</span>
        </div>

        <button
          type="button"
          onClick={onOpenAdd}
          className="px-2 py-1.5 rounded bg-blue-600 text-white text-sm"
        >
          Add
        </button>
      </div>

      {/* SCROLL AREA (the ONLY scrolling region) */}
      <div
  className="flex-1 min-h-0 overflow-y-auto px-3 py-2"
  style={{ scrollbarGutter: 'stable', overflowAnchor: 'none' }}
>
        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="text-sm text-gray-600">No comments yet.</div>
        ) : (
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={getId(c)} className="rounded border border-gray-200 bg-gray-50 p-2">
                <div className="text-xs text-gray-500 flex items-center justify-between">
                  <span>{c.author || 'Anonymous'}</span>
                  <span>{(c.timestamp instanceof Date ? c.timestamp : new Date(c.timestamp as any)).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{c.text}</div>
                <div className="mt-2 flex justify-end">
                  <button type="button" className="text-xs text-red-700" onClick={() => onDelete(c)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}