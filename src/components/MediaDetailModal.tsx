import { useEffect, useState } from 'react';
import { Bell, Bookmark, Check, Play, X } from 'lucide-react';
import type { EpisodeItem, MediaItem } from '../types.ts';
import { MediaPoster } from './MediaPoster.tsx';

interface MediaDetailModalProps {
  item: MediaItem;
  inWatchlist: boolean;
  notifyEnabled: boolean;
  onClose: () => void;
  onPlay: (item: MediaItem, episode?: EpisodeItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onToggleNotify: (mediaId: string) => void;
}

export function MediaDetailModal({
  item,
  inWatchlist,
  notifyEnabled,
  onClose,
  onPlay,
  onToggleWatchlist,
  onToggleNotify,
}: MediaDetailModalProps) {
  const [detailed, setDetailed] = useState<MediaItem>(item);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  useEffect(() => {
    setDetailed(item);
    if (item.type === 'series' && (!item.episodes || item.episodes.length === 0)) {
      setLoadingEpisodes(true);
      fetch(`/api/media/${encodeURIComponent(item.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: MediaItem | null) => {
          if (data) setDetailed(data);
        })
        .catch(() => {})
        .finally(() => setLoadingEpisodes(false));
    }
  }, [item]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const platformsList = [
    detailed.platform,
    ...(detailed.otherPlatforms || []),
  ].filter((p, idx, arr) => arr.indexOf(p) === idx);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={detailed.title}
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#111319] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile sheet drag handle */}
        <div className="sticky top-0 z-20 flex justify-center bg-gradient-to-b from-[#111319] to-transparent pt-3 pb-1 sm:hidden">
          <div className="h-1.5 w-10 rounded-full bg-zinc-700" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-3 right-3 z-30 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/60 text-zinc-200 backdrop-blur-md transition-colors hover:bg-black/85 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Backdrop header */}
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#0A0B0E]">
          <MediaPoster
            src={detailed.backdropUrl || detailed.posterUrl}
            alt={detailed.title}
            title={detailed.title}
            className="h-full w-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111319] via-[#111319]/45 to-transparent" />

          <div className="absolute inset-x-5 bottom-5 sm:inset-x-8 sm:bottom-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white text-balance sm:text-3xl">
              {detailed.title}
            </h2>
            <p className="mt-1.5 text-xs text-zinc-300 sm:text-sm">
              {detailed.year}
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{detailed.rating.toFixed(1)}</span> Rating
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{detailed.runtimeMinutes}m</span>
              <span aria-hidden="true"> · </span>
              {detailed.genres.join(' / ')}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-6 p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onPlay(detailed, detailed.episodes?.[0])}
              className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#E11D48] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#BE123C]"
            >
              <Play className="h-4 w-4 fill-current" />
              <span className="whitespace-nowrap">
                {detailed.episodes?.length ? 'Play S1 E1' : 'Play Now'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onToggleWatchlist(detailed)}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10"
            >
              {inWatchlist ? <Check className="h-4 w-4 text-[#E11D48]" /> : <Bookmark className="h-4 w-4" />}
              <span className="whitespace-nowrap">
                {inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
              </span>
            </button>

            {inWatchlist && (
              <button
                type="button"
                onClick={() => onToggleNotify(detailed.id)}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  notifyEnabled
                    ? 'border-[#E11D48]/50 bg-[#E11D48]/15 text-white'
                    : 'border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Bell className="h-4 w-4" />
                <span className="whitespace-nowrap">
                  {notifyEnabled ? 'Release Alerts On' : 'Alerts Paused'}
                </span>
              </button>
            )}
          </div>

          <p className="max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-base">
            {detailed.synopsis}
          </p>

          <div className="grid gap-3 border-t border-white/10 pt-4 text-xs text-zinc-400 sm:grid-cols-2 sm:text-sm">
            <div>
              <span className="text-zinc-500">Creator / Director: </span>
              <span className="text-zinc-200">{detailed.directorOrCreator}</span>
            </div>
            <div>
              <span className="text-zinc-500">Indexed Platforms: </span>
              <span className="text-zinc-200">{platformsList.join(' · ')}</span>
            </div>
          </div>

          {/* Episode Guide */}
          {detailed.type === 'series' && (
            <div className="border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-white">
                  Episodes
                </h3>
                {loadingEpisodes && (
                  <span className="text-xs text-zinc-400">Loading episode guide...</span>
                )}
              </div>

              {!loadingEpisodes && (!detailed.episodes || detailed.episodes.length === 0) ? (
                <p className="text-sm text-zinc-400">
                  Full feature playback ready via instant stream.
                </p>
              ) : (
                <div className="divide-y divide-white/10">
                  {(detailed.episodes || []).map((ep) => (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => onPlay(detailed, ep)}
                      className="flex w-full items-center justify-between gap-4 py-3.5 text-left transition-colors hover:bg-white/5 sm:px-3 sm:rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-white">
                          <span className="tabular-nums text-zinc-400">
                            S{ep.season} E{ep.number}
                          </span>
                          <span className="truncate">{ep.title}</span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-zinc-400">
                          {ep.summary}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-zinc-400">
                        <span className="hidden tabular-nums sm:inline">{ep.runtimeMinutes}m</span>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white">
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
