import { Bookmark, Check, Play } from 'lucide-react';
import type { MediaItem } from '../types.ts';
import { MediaPoster } from './MediaPoster.tsx';

interface MediaCardProps {
  item: MediaItem;
  inWatchlist: boolean;
  progressPercent?: number;
  subtitleOverride?: string;
  onPlay: (item: MediaItem) => void;
  onSelect: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
}

export function MediaCard({
  item,
  inWatchlist,
  progressPercent,
  subtitleOverride,
  onPlay,
  onSelect,
  onToggleWatchlist,
}: MediaCardProps) {
  return (
    <article className="group relative flex flex-col">
      <div
        onClick={() => onSelect(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(item);
          }
        }}
        aria-label={`Open details for ${item.title}`}
        className="relative aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-xl bg-[#13151C] ring-1 ring-white/10 transition-transform duration-200 ease-out group-hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E11D48]"
      >
        <MediaPoster
          src={item.posterUrl}
          alt={`${item.title} poster`}
          title={item.title}
          className="h-full w-full"
        />

        {/* Subtle bottom scrim for contrast */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent opacity-80 transition-opacity duration-200 group-hover:opacity-95" />

        {/* Hover / Focus quick actions */}
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(item);
            }}
            aria-label={`Play ${item.title}`}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#E11D48] px-3.5 py-2 text-xs font-semibold text-white shadow-lg transition-colors duration-150 hover:bg-[#BE123C] focus-visible:outline-2 focus-visible:outline-white"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span className="whitespace-nowrap">Play</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatchlist(item);
            }}
            aria-label={inWatchlist ? `Remove ${item.title} from watchlist` : `Add ${item.title} to watchlist`}
            className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-white ${
              inWatchlist
                ? 'border-white/25 bg-white/20 text-white backdrop-blur-md'
                : 'border-white/15 bg-black/55 text-zinc-200 backdrop-blur-md hover:bg-black/75'
            }`}
          >
            {inWatchlist ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </button>
        </div>

        {/* Continue watching progress bar */}
        {typeof progressPercent === 'number' && progressPercent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div
              className="h-full bg-[#E11D48]"
              style={{ width: `${Math.min(100, Math.max(4, progressPercent))}%` }}
            />
          </div>
        )}
      </div>

      {/* Unboxed clean metadata below poster */}
      <div className="mt-2.5 flex flex-col gap-0.5 px-0.5">
        <button
          type="button"
          onClick={() => onSelect(item)}
          className="text-left font-display text-sm font-semibold leading-snug text-zinc-100 transition-colors hover:text-white line-clamp-1"
        >
          {item.title}
        </button>
        <p className="text-xs text-zinc-400 line-clamp-1">
          {subtitleOverride || `${item.platform} · ${item.year} · ${item.genres[0] || (item.type === 'series' ? 'Series' : 'Movie')}`}
        </p>
      </div>
    </article>
  );
}
