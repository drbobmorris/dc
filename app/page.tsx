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

function firstAuthor(author: string) {
  const a = String(author || '').trim();
  if (!a) return '';
  // handle "A, B, C" or "A; B; C"
  return a.split(/[,;]+/)[0].trim();
}

export default function HomePage() {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-4 md:p-8 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-500">Library</h1>

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
            <p className="text-xl text-gray-600">No presentations yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {posters.map((poster) => (
              <Link
                key={poster._id}
                href={`/view/${poster.id}`}
                className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-5 border border-gray-200 block"
              >
                <div className="text-base font-semibold text-gray-900 leading-snug line-clamp-2">
                  {poster.title}
                </div>

                {poster.author ? (
                  <div className="mt-1 text-sm text-gray-600">by {firstAuthor(poster.author)}</div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}