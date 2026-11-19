import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem, WatchHistoryEntry } from '../types.ts';
import { MediaCard } from './MediaCard.tsx';

interface MediaRowProps {
  title: string;
  subtitle?: string;
  items: MediaItem[];
  watchlistIds: Set<string>;
  historyMap?: Map<string, WatchHistoryEntry>;
  showRecommendationReason?: boolean;
  onPlay: (item: MediaItem) => void;
  onSelect: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
}

export function MediaRow({
  title,
  subtitle,
  items,
  watchlistIds,
  historyMap,
  showRecommendationReason = false,
  onPlay,
  onSelect,
  onToggleWatchlist,
}: MediaRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    const offset = Math.round(el.clientWidth * 0.78);
    el.scrollBy({
      left: direction === 'left' ? -offset : offset,
      behavior: 'smooth',
    });
  };

  return (
    <section className="relative py-4 sm:py-6" aria-label={title}>
      <div className="mb-3.5 flex items-end justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white sm:text-xl">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">{subtitle}</p>
          )}
        </div>

        <div className="hidden items-center gap-1.5 md:flex">
          <button
            type="button"
            onClick={() => scrollByAmount('left')}
            aria-label={`Scroll ${title} left`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#13151C] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount('right')}
            aria-label={`Scroll ${title} right`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#13151C] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="no-scrollbar flex gap-3.5 overflow-x-auto px-4 pb-2 scroll-smooth snap-x snap-mandatory sm:gap-4 sm:px-6 lg:px-10"
      >
        {items.map((item) => {
          const hist = historyMap?.get(item.id);
          const progressPercent =
            hist && hist.durationSeconds > 0
              ? Math.round((hist.progressSeconds / hist.durationSeconds) * 100)
              : undefined;

          return (
            <div
              key={item.id}
              className="w-[152px] shrink-0 snap-start sm:w-[182px] lg:w-[204px]"
            >
              <MediaCard
                item={item}
                inWatchlist={watchlistIds.has(item.id)}
                progressPercent={progressPercent}
                subtitleOverride={
                  showRecommendationReason && item.recommendationReason
                    ? item.recommendationReason
                    : undefined
                }
                onPlay={onPlay}
                onSelect={onSelect}
                onToggleWatchlist={onToggleWatchlist}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
