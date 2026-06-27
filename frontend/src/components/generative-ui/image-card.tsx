'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ImageCardProps {
  imageUrl: string;
  caption?: string;
  title?: string;
  compact?: boolean;
}

/** Image card — a static picture/logo, not backed by a query result. Resizes within its grid box. */
export function ImageCard({ imageUrl, caption, title, compact }: ImageCardProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-2' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-lg bg-zinc-50">
        {failed || !imageUrl ? (
          <div className="flex flex-col items-center gap-2 text-zinc-400 p-4">
            <ImageOff className="w-6 h-6" />
            <span className="text-xs">{!imageUrl ? 'No image set' : 'Image failed to load'}</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={caption || title || 'Dashboard image'}
            className="max-w-full max-h-full object-contain"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {caption && (
        <p className="mt-2 text-[11px] text-zinc-500 text-center shrink-0 truncate">{caption}</p>
      )}
    </div>
  );
}
