import { useState } from 'react';
import { Film } from 'lucide-react';

interface MediaPosterProps {
  src?: string;
  alt: string;
  title: string;
  className?: string;
}

export function MediaPoster({ src, alt, title, className = '' }: MediaPosterProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#1A1D26] via-[#13151C] to-[#0D0F14] p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Film className="mb-2 h-7 w-7 text-zinc-500" strokeWidth={1.5} />
        <span className="font-display line-clamp-3 text-sm font-semibold tracking-tight text-zinc-200">
          {title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}
