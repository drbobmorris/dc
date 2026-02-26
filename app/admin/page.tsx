'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Poster = {
  _id: string;
  id: string;
  title: string;
  author: string;
  uploadedAt: string;
};

export default function AdminPage() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosters();
  }, []);

  async function fetchPosters() {
    try {
      const response = await fetch('/api/posters');
      if (response.ok) {
        const data = await response.json();
        setPosters(data);
      }
    } catch (error) {
      console.error('Error fetching posters:', error);
    } finally {
      setLoading(false);
    }
  }

  async function deletePoster(id: string) {
    if (!confirm('Delete this presentation?')) return;

    try {
      const res = await fetch(`/api/posters/${id}`, { method: 'DELETE' });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error ?? 'Delete failed');
        return;
      }

      setPosters((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-4 md:p-8 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-baseline gap-4">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-700">Admin</h1>
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              Open attendee library →
            </Link>
          </div>

          <Link href="/" className="shrink-0">
            <img src="/presentrxiv-logo.png" alt="PresentrXiv" className="h-10 w-auto" />
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600">Loading presentations...</p>
          </div>
        ) : posters.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-xl text-gray-600 mb-4">No presentations yet</p>
            <Link
              href="/upload"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Upload the First One
            </Link>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {posters.map((poster) => (
                <div
                  key={poster._id}
                  className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow p-6 border border-gray-200 flex flex-col"
                >
                  <h2 className="text-xl font-bold mb-2 text-gray-900 line-clamp-2">{poster.title}</h2>

                  <p className="text-sm text-gray-600 mb-3">by {poster.author}</p>

                  <p className="text-xs text-gray-500 mb-4">
                    Uploaded {new Date(poster.uploadedAt).toLocaleDateString()}
                  </p>

                  <div className="mt-auto flex items-center justify-between">
                    <Link href={`/view/${poster.id}`} className="text-blue-600 font-medium text-sm hover:underline">
                      View →
                    </Link>

                    <button onClick={() => deletePoster(poster.id)} className="text-sm text-red-600 hover:underline">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block mt-8 pt-6 border-t">
              <Link
                href="/upload"
                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Upload Presentations
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}