import { useEffect, useRef, useState } from 'react';
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { EpisodeItem, MediaItem, ResolvedPlayback } from '../types.ts';
import { measureClientBandwidthMbps } from '../utils/bandwidth.ts';

interface VideoPlayerModalProps {
  item: MediaItem;
  episode?: EpisodeItem;
  initialTimeSeconds?: number;
  onClose: () => void;
  onSwitchEpisode?: (episode: EpisodeItem) => void;
  onProgressSaved?: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoPlayerModal({
  item,
  episode,
  initialTimeSeconds = 0,
  onClose,
  onSwitchEpisode,
  onProgressSaved,
}: VideoPlayerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [resolved, setResolved] = useState<ResolvedPlayback | null>(null);
  const [activeSrc, setActiveSrc] = useState<string>('');
  const [fallbackQueue, setFallbackQueue] = useState<string[]>([]);
  const [resolving, setResolving] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTimeSeconds);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const hideTimerRef = useRef<number | null>(null);

  // Automatic bandwidth-aware & seed-aware stream resolution
  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setErrorMsg(null);

    (async () => {
      try {
        const downlinkMbps = await measureClientBandwidthMbps();
        const res = await fetch('/api/resolve-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaId: item.id,
            episodeId: episode?.id,
            downlinkMbps,
            customMedia: {
              title: item.title,
              sources: item.sources,
            },
          }),
        });

        if (!res.ok) throw new Error('Unable to resolve video stream');
        const data = (await res.json()) as ResolvedPlayback;
        if (cancelled) return;

        setResolved(data);
        setActiveSrc(data.streamUrl);
        setFallbackQueue(data.fallbackUrls || []);
        setResolving(false);
      } catch {
        if (!cancelled) {
          setErrorMsg('Unable to start playback right now. Please try another title.');
          setResolving(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item, episode]);

  // Save watch progress periodically and on close
  const saveProgress = (completedOverride = false) => {
    const vid = videoRef.current;
    const progress = vid ? Math.floor(vid.currentTime) : Math.floor(currentTime);
    const total = vid && Number.isFinite(vid.duration) && vid.duration > 0
      ? Math.floor(vid.duration)
      : item.runtimeMinutes * 60;
    const completed = completedOverride || (total > 0 && progress / total > 0.9);

    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaId: item.id,
        episodeId: episode?.id,
        title: item.title,
        genres: item.genres,
        platform: item.platform,
        posterUrl: item.posterUrl,
        progressSeconds: progress,
        durationSeconds: total,
        completed,
      }),
    })
      .then(() => onProgressSaved?.())
      .catch(() => {});
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        saveProgress(false);
      }
    }, 8000);
    return () => {
      window.clearInterval(interval);
      saveProgress(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, episode?.id]);

  // Auto-hide controls while playing
  const bumpControls = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
      }
    }, 3200);
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch(() => {});
      setPlaying(true);
    } else {
      vid.pause();
      setPlaying(false);
    }
    bumpControls();
  };

  const seekBy = (delta: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + delta));
    bumpControls();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        seekBy(10);
      } else if (e.key === 'ArrowLeft') {
        seekBy(-10);
      } else if (e.key.toLowerCase() === 'm') {
        if (videoRef.current) {
          videoRef.current.muted = !videoRef.current.muted;
          setMuted(videoRef.current.muted);
        }
      } else if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVideoError = () => {
    if (fallbackQueue.length > 0) {
      const [nextUrl, ...rest] = fallbackQueue;
      setFallbackQueue(rest);
      setActiveSrc(nextUrl);
    } else {
      setErrorMsg('Stream momentarily unavailable. Try another title or check connection.');
    }
  };

  const nextEpisode = (() => {
    if (!episode || !item.episodes?.length) return undefined;
    const idx = item.episodes.findIndex((e) => e.id === episode.id);
    if (idx >= 0 && idx + 1 < item.episodes.length) {
      return item.episodes[idx + 1];
    }
    return undefined;
  })();

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={bumpControls}
      onTouchStart={bumpControls}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${resolved?.title || item.title}`}
    >
      {/* Top Overlay Bar */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-4 py-4 transition-opacity duration-200 sm:px-8 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="min-w-0">
          <h2 className="font-display truncate text-base font-semibold text-white sm:text-lg">
            {resolved?.title || item.title}
          </h2>
          <p className="text-xs text-zinc-300">
            {item.platform}
            {resolved?.selectedResolution ? ` · ${resolved.selectedResolution} Auto` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            saveProgress(false);
            onClose();
          }}
          aria-label="Exit player"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Main Video Surface */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {resolving && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-[#E11D48]" />
            <p className="text-sm font-medium text-zinc-300">Starting instant playback...</p>
          </div>
        )}

        {!resolving && errorMsg && (
          <div className="max-w-md px-6 text-center">
            <p className="text-sm text-zinc-300">{errorMsg}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Back to Browse
            </button>
          </div>
        )}

        {!resolving && !errorMsg && activeSrc && (
          <video
            ref={videoRef}
            src={activeSrc}
            autoPlay
            playsInline
            onClick={togglePlay}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(v.duration || 0);
              if (initialTimeSeconds > 5 && initialTimeSeconds < (v.duration || 0) - 10) {
                v.currentTime = initialTimeSeconds;
              }
              v.playbackRate = playbackRate;
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              saveProgress(true);
              if (nextEpisode && onSwitchEpisode) {
                onSwitchEpisode(nextEpisode);
              }
            }}
            onError={handleVideoError}
            className="max-h-full max-w-full w-full h-full object-contain"
          />
        )}
      </div>

      {/* Bottom Theater Controls */}
      {!resolving && !errorMsg && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pt-10 pb-5 transition-opacity duration-200 sm:px-8 sm:pb-6 ${
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {/* Scrubber */}
          <div className="mb-3 flex items-center gap-3">
            <span className="w-12 text-right text-xs font-medium tabular-nums text-zinc-300">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={Math.min(currentTime, duration || 100)}
              onChange={(e) => {
                const next = Number(e.target.value);
                setCurrentTime(next);
                if (videoRef.current) videoRef.current.currentTime = next;
              }}
              aria-label="Seek timeline"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-[#E11D48]"
            />
            <span className="w-12 text-xs font-medium tabular-nums text-zinc-400">
              {formatTime(duration)}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
              >
                {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
              </button>

              <button
                type="button"
                onClick={() => seekBy(-10)}
                aria-label="Rewind 10 seconds"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => seekBy(10)}
                aria-label="Forward 10 seconds"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10"
              >
                <RotateCw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.muted = !videoRef.current.muted;
                    setMuted(videoRef.current.muted);
                  }
                }}
                aria-label={muted ? 'Unmute' : 'Mute'}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10"
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {nextEpisode && onSwitchEpisode && (
                <button
                  type="button"
                  onClick={() => onSwitchEpisode(nextEpisode)}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  <span className="whitespace-nowrap">Next Episode</span>
                </button>
              )}

              <button
                type="button"
                onClick={cycleSpeed}
                aria-label="Playback speed"
                className="min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums text-zinc-200 transition-colors hover:bg-white/10"
              >
                {playbackRate}x
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10"
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
