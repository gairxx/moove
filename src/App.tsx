import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Bookmark,
  Check,
  Compass,
  Film,
  Info,
  Plus,
  Play,
  Search,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { AdminPanel } from './components/AdminPanel.tsx';
import { MediaCard } from './components/MediaCard.tsx';
import { MediaDetailModal } from './components/MediaDetailModal.tsx';
import { MediaPoster } from './components/MediaPoster.tsx';
import { MediaRow } from './components/MediaRow.tsx';
import { NotificationsPanel } from './components/NotificationsPanel.tsx';
import { VideoPlayerModal } from './components/VideoPlayerModal.tsx';
import type {
  EpisodeItem,
  FeedResponse,
  MediaItem,
  UserState,
  WatchHistoryEntry,
} from './types.ts';

type NavTab = 'home' | 'movies' | 'series' | 'watchlist' | 'admin' | 'search' | 'alerts';

const ALL_TASTE_GENRES = [
  'Sci-Fi',
  'Thriller',
  'Drama',
  'Documentary',
  'Animation',
  'Crime',
  'Adventure',
  'Mystery',
  'Comedy',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [userState, setUserState] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Unified multi-platform search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>('All');
  const [genreFilter, setGenreFilter] = useState<string>('All');

  // Modals & Drawers
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [playbackTarget, setPlaybackTarget] = useState<{
    item: MediaItem;
    episode?: EpisodeItem;
    initialTime?: number;
  } | null>(null);
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(false);

  // Stremio-compatible add-on quick-connect from unified search
  const [addonConnecting, setAddonConnecting] = useState(false);
  const [addonStatus, setAddonStatus] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadInitialData = useCallback(async () => {
    try {
      const [feedRes, userRes] = await Promise.all([
        fetch('/api/feed'),
        fetch('/api/user-state'),
      ]);
      if (!feedRes.ok) throw new Error('Unable to load catalog');
      const feedData = (await feedRes.json()) as FeedResponse;
      const userData = userRes.ok ? ((await userRes.json()) as UserState) : null;
      setFeed(feedData);
      if (userData) setUserState(userData);
      setError(null);
    } catch {
      setError('Unable to reach streaming catalog. Please refresh to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Debounced simultaneous multi-service search
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = (await res.json()) as { results: MediaItem[] };
          setSearchResults(data.results || []);
        }
      } catch {
        // Keep current results on transient error
      } finally {
        setSearching(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const watchlistIds = useMemo(
    () => new Set((userState?.watchlist || []).map((w) => w.mediaId)),
    [userState],
  );

  const watchlistNotifyMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const w of userState?.watchlist || []) {
      map.set(w.mediaId, w.notifyNewReleases);
    }
    return map;
  }, [userState]);

  const historyMap = useMemo(() => {
    const map = new Map<string, WatchHistoryEntry>();
    for (const h of userState?.history || []) {
      map.set(h.mediaId, h);
    }
    return map;
  }, [userState]);

  const unreadNotificationsCount = useMemo(
    () => (userState?.notifications || []).filter((n) => !n.read).length,
    [userState],
  );

  const allCatalogMap = useMemo(() => {
    const map = new Map<string, MediaItem>();
    if (!feed) return map;
    for (const list of [
      [feed.hero],
      feed.trending,
      feed.newReleases,
      feed.recommended,
      feed.movies,
      feed.series,
      searchResults,
    ]) {
      for (const item of list) {
        if (item) map.set(item.id, item);
      }
    }
    return map;
  }, [feed, searchResults]);

  const continueWatchingItems = useMemo(() => {
    if (!userState?.history?.length) return [];
    return userState.history
      .filter((h) => !h.completed && h.progressSeconds > 5)
      .map((h) => allCatalogMap.get(h.mediaId))
      .filter((item): item is MediaItem => Boolean(item));
  }, [userState, allCatalogMap]);

  const handlePlay = async (item: MediaItem, episode?: EpisodeItem) => {
    setSelectedItem(null);
    setShowAlertsDrawer(false);
    const existingHist = historyMap.get(item.id);
    const resumeTime =
      !episode || existingHist?.episodeId === episode.id
        ? existingHist?.progressSeconds || 0
        : 0;

    // Ensure series episodes are hydrated if missing
    if (item.type === 'series' && (!item.episodes || item.episodes.length === 0)) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(item.id)}`);
        if (res.ok) {
          const full = (await res.json()) as MediaItem;
          setPlaybackTarget({
            item: full,
            episode: episode || full.episodes?.[0],
            initialTime: resumeTime,
          });
          return;
        }
      } catch {
        // Fall back to direct item play
      }
    }

    setPlaybackTarget({
      item,
      episode: episode || item.episodes?.[0],
      initialTime: resumeTime,
    });
  };

  const handlePlayById = async (mediaId: string) => {
    const cached = allCatalogMap.get(mediaId);
    if (cached) {
      await handlePlay(cached);
      return;
    }
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}`);
      if (res.ok) {
        const fetched = (await res.json()) as MediaItem;
        await handlePlay(fetched);
      }
    } catch {
      // Ignore if unreachable
    }
  };

  const handleToggleWatchlist = async (item: MediaItem) => {
    try {
      const res = await fetch('/api/watchlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          userState: UserState;
          recommended: MediaItem[];
        };
        setUserState(data.userState);
        setFeed((prev) => (prev ? { ...prev, recommended: data.recommended } : prev));
      }
    } catch {
      // Ignore transient failure
    }
  };

  const handleToggleNotify = async (mediaId: string) => {
    try {
      const res = await fetch('/api/watchlist/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { userState: UserState };
        setUserState(data.userState);
      }
    } catch {
      // Ignore
    }
  };

  const handleMarkNotificationsRead = async () => {
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = (await res.json()) as { userState: UserState };
        setUserState(data.userState);
      }
    } catch {
      // Ignore
    }
  };

  const handleTogglePreferredGenre = async (genre: string) => {
    const current = userState?.preferredGenres || [];
    const next = current.includes(genre)
      ? current.filter((g) => g !== genre)
      : [...current, genre];
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: next }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          userState: UserState;
          recommended: MediaItem[];
        };
        setUserState(data.userState);
        setFeed((prev) => (prev ? { ...prev, recommended: data.recommended } : prev));
      }
    } catch {
      // Ignore
    }
  };

  const handleConnectAddon = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    setAddonConnecting(true);
    setAddonStatus(null);
    try {
      const res = await fetch('/api/addons/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: trimmed }),
      });
      const data = (await res.json()) as {
        addon?: { name: string };
        userState?: UserState;
        error?: string;
      };
      if (!res.ok) {
        setAddonStatus(data.error || 'Unable to connect stream provider.');
      } else {
        if (data.userState) setUserState(data.userState);
        setAddonStatus(`Connected "${data.addon?.name || 'Stream Provider'}" successfully.`);
        loadInitialData();
      }
    } catch {
      setAddonStatus('Network error while connecting stream provider.');
    } finally {
      setAddonConnecting(false);
    }
  };

  const refreshRecommendationsAfterWatch = async () => {
    try {
      const [feedRes, userRes] = await Promise.all([
        fetch('/api/feed'),
        fetch('/api/user-state'),
      ]);
      if (feedRes.ok) setFeed(await feedRes.json());
      if (userRes.ok) setUserState(await userRes.json());
    } catch {
      // Ignore
    }
  };

  const filterByGenre = (items: MediaItem[]) => {
    if (genreFilter === 'All') return items;
    return items.filter((i) =>
      i.genres.some((g) => g.toLowerCase() === genreFilter.toLowerCase()),
    );
  };

  const filteredSearchResults = useMemo(() => {
    if (platformFilter === 'All') return searchResults;
    return searchResults.filter((r) => r.platform === platformFilter);
  }, [searchResults, platformFilter]);

  const searchPlatforms = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const r of searchResults) set.add(r.platform);
    return Array.from(set);
  }, [searchResults]);

  const focusSearch = () => {
    setActiveTab('search');
    window.setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  const isSearchingView = activeTab === 'search' || searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#0A0B0E] pb-20 text-[#F4F5F7] md:pb-12">
      {/* Desktop Top Navigation — Strictly 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 hidden h-16 items-center justify-between gap-8 border-b border-white/10 bg-[#0A0B0E]/90 px-6 backdrop-blur-md md:flex lg:px-10">
        <button
          type="button"
          onClick={() => {
            setSearchQuery('');
            setActiveTab('home');
          }}
          className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          KinoStream
        </button>

        <nav className="flex items-center gap-7 text-sm font-medium" aria-label="Main navigation">
          {(
            [
              { id: 'home', label: 'Home' },
              { id: 'movies', label: 'Movies' },
              { id: 'series', label: 'Series' },
              { id: 'watchlist', label: 'Watchlist' },
              { id: 'admin', label: 'Admin' },
            ] as const
          ).map((navItem) => {
            const active = !isSearchingView && activeTab === navItem.id;
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveTab(navItem.id);
                }}
                className={`whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
                  active
                    ? 'border-[#E11D48] text-white'
                    : 'border-transparent text-zinc-400 hover:text-white'
                }`}
              >
                {navItem.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={focusSearch}
            className="flex items-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C] whitespace-nowrap shrink-0"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
          </button>
        </div>
      </header>

      {/* Mobile Compact Top App Bar (48px) */}
      <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-white/10 bg-[#0A0B0E]/95 px-4 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => {
            setSearchQuery('');
            setActiveTab('home');
          }}
          className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          KinoStream
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setActiveTab('admin');
            }}
            aria-label="Open Admin Console"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${
              activeTab === 'admin' ? 'text-[#E11D48]' : 'text-zinc-300'
            }`}
          >
            <Sliders className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('alerts')}
            aria-label="Release notifications"
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-end gap-1.5 text-zinc-200"
          >
            <Bell className="h-5 w-5" />
            {unreadNotificationsCount > 0 && (
              <span className="text-xs font-semibold tabular-nums text-[#E11D48]">
                {unreadNotificationsCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Workspace Unified Search & Release Alerts Toolbar */}
      {activeTab !== 'admin' && (
      <div className="border-b border-white/5 bg-[#0D0F14] px-4 py-3 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search movies, shows across all platforms, or paste a magnet link..."
              aria-label="Unified multi-platform search"
              className="h-11 w-full rounded-xl border border-white/10 bg-[#13151C] pr-10 pl-10 text-sm text-white placeholder:text-zinc-500 focus:border-[#E11D48] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  if (activeTab === 'search') setActiveTab('home');
                }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAlertsDrawer(true)}
            className="hidden min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-[#13151C] px-4 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 md:flex whitespace-nowrap shrink-0"
          >
            <Bell className="h-4 w-4 text-[#E11D48]" />
            <span>Release Alerts</span>
            {unreadNotificationsCount > 0 && (
              <span className="font-semibold tabular-nums text-[#E11D48]">
                ({unreadNotificationsCount})
              </span>
            )}
          </button>
        </div>
      </div>
      )}

      {/* Main Content Canvas */}
      <main className="mx-auto max-w-[1600px]">
        {loading && (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 px-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#E11D48]" />
            <p className="text-sm text-zinc-400">Indexing streaming feeds...</p>
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto my-16 max-w-md rounded-2xl border border-white/10 bg-[#13151C] p-6 text-center">
            <p className="text-sm text-zinc-300">{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                loadInitialData();
              }}
              className="mt-4 rounded-lg bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Retry
            </button>
          </div>
        )}

        {/* Simultaneous Multi-Service Search View */}
        {!loading && !error && isSearchingView && (
          <section className="px-4 py-6 sm:px-6 lg:px-10" aria-label="Search Results">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-xl font-semibold text-white sm:text-2xl">
                  {searchQuery.trim()
                    ? `Results for "${searchQuery.trim()}"`
                    : 'Search All Platforms'}
                </h1>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {searching
                    ? 'Searching Open Cinema, Internet Archive, and live platform indexes...'
                    : searchQuery.trim()
                      ? `${filteredSearchResults.length} playable titles found across services`
                      : 'Enter a movie, series, genre, or magnet link to stream instantly.'}
                </p>
              </div>

              {searchResults.length > 0 && (
                <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
                  {searchPlatforms.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => setPlatformFilter(platform)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        platformFilter === platform
                          ? 'bg-[#E11D48] text-white'
                          : 'bg-[#13151C] text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      {platform}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {searching && searchResults.length === 0 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="aspect-[3/4] animate-pulse rounded-xl bg-[#13151C]"
                  />
                ))}
              </div>
            )}

            {!searching && searchQuery.trim() && filteredSearchResults.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#13151C] p-10 text-center">
                {searchQuery.trim().startsWith('stremio://') ||
                searchQuery.trim().includes('/manifest.json') ? (
                  <div className="mx-auto max-w-md space-y-3">
                    <p className="text-sm text-zinc-200">
                      Detected a Stremio-compatible add-on manifest URL. Connect it as an automatic stream provider?
                    </p>
                    <button
                      type="button"
                      disabled={addonConnecting}
                      onClick={() => handleConnectAddon(searchQuery)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#E11D48] px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C] disabled:opacity-60"
                    >
                      <Plus className="h-4 w-4" />
                      <span>{addonConnecting ? 'Connecting...' : 'Connect Stream Provider'}</span>
                    </button>
                    {addonStatus && (
                      <p className="text-xs text-zinc-400">{addonStatus}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-300">
                    No matching titles found. Try a broader title, genre, or paste a direct magnet link.
                  </p>
                )}
              </div>
            )}

            {filteredSearchResults.length > 0 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {filteredSearchResults.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    inWatchlist={watchlistIds.has(item.id)}
                    onPlay={(i) => handlePlay(i)}
                    onSelect={(i) => setSelectedItem(i)}
                    onToggleWatchlist={handleToggleWatchlist}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Home Discovery View */}
        {!loading && !error && !isSearchingView && activeTab === 'home' && feed && (
          <>
            {/* Hero Spotlight — Single Dominant Focal Anchor */}
            <section className="relative overflow-hidden border-b border-white/5 bg-[#0A0B0E]">
              <div className="relative aspect-[4/5] max-h-[580px] w-full sm:aspect-[16/9] lg:aspect-[21/9]">
                <MediaPoster
                  src={feed.hero.backdropUrl || feed.hero.posterUrl}
                  alt={feed.hero.title}
                  title={feed.hero.title}
                  className="h-full w-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0B0E] via-[#0A0B0E]/60 to-black/20" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0A0B0E]/95 via-[#0A0B0E]/55 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 px-4 pb-8 sm:px-6 sm:pb-10 lg:px-10 lg:pb-12">
                  <div className="max-w-2xl">
                    <p className="text-xs font-medium text-zinc-300 sm:text-sm">
                      Featured Premiere
                      <span aria-hidden="true"> · </span>
                      {feed.hero.platform}
                      <span aria-hidden="true"> · </span>
                      {feed.hero.year}
                      <span aria-hidden="true"> · </span>
                      {feed.hero.genres.slice(0, 2).join(' / ')}
                    </p>

                    <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white text-balance sm:text-5xl">
                      {feed.hero.title}
                    </h1>

                    <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-zinc-300 sm:line-clamp-3 sm:text-base">
                      {feed.hero.synopsis}
                    </p>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handlePlay(feed.hero)}
                        className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#E11D48] px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#BE123C]"
                      >
                        <Play className="h-4 w-4 fill-current" />
                        <span className="whitespace-nowrap">Play Now</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleWatchlist(feed.hero)}
                        className="flex min-h-[44px] items-center gap-2 rounded-lg border border-white/20 bg-black/45 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/15"
                      >
                        {watchlistIds.has(feed.hero.id) ? (
                          <Check className="h-4 w-4 text-[#E11D48]" />
                        ) : (
                          <Bookmark className="h-4 w-4" />
                        )}
                        <span className="whitespace-nowrap">
                          {watchlistIds.has(feed.hero.id) ? 'In Watchlist' : 'Watchlist'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedItem(feed.hero)}
                        className="flex min-h-[44px] items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-medium text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/10"
                      >
                        <Info className="h-4 w-4" />
                        <span className="whitespace-nowrap">Episodes & Info</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Interactive Genre Filter Bar */}
            <div className="px-4 pt-5 sm:px-6 lg:px-10">
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
                {['All', 'Sci-Fi', 'Thriller', 'Drama', 'Documentary', 'Animation', 'Crime', 'Adventure'].map(
                  (genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => setGenreFilter(genre)}
                      className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        genreFilter === genre
                          ? 'bg-white text-[#0A0B0E]'
                          : 'bg-[#13151C] text-zinc-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {genre}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Continue Watching */}
            {continueWatchingItems.length > 0 && genreFilter === 'All' && (
              <MediaRow
                title="Continue Watching"
                subtitle="Pick up right where you left off"
                items={continueWatchingItems}
                watchlistIds={watchlistIds}
                historyMap={historyMap}
                onPlay={(item) => handlePlay(item)}
                onSelect={(item) => setSelectedItem(item)}
                onToggleWatchlist={handleToggleWatchlist}
              />
            )}

            {/* Personalized Recommendations */}
            <MediaRow
              title="Picked For You"
              subtitle="Adapted from your watch history and saved genres"
              items={filterByGenre(feed.recommended)}
              watchlistIds={watchlistIds}
              historyMap={historyMap}
              showRecommendationReason
              onPlay={(item) => handlePlay(item)}
              onSelect={(item) => setSelectedItem(item)}
              onToggleWatchlist={handleToggleWatchlist}
            />

            {/* Trending Across Platforms */}
            <MediaRow
              title="Trending Across Platforms"
              subtitle="Most watched movies and series right now"
              items={filterByGenre(feed.trending)}
              watchlistIds={watchlistIds}
              historyMap={historyMap}
              onPlay={(item) => handlePlay(item)}
              onSelect={(item) => setSelectedItem(item)}
              onToggleWatchlist={handleToggleWatchlist}
            />

            {/* New Releases */}
            <MediaRow
              title="New Releases"
              subtitle="Fresh premieres and newly dropped episodes"
              items={filterByGenre(feed.newReleases)}
              watchlistIds={watchlistIds}
              historyMap={historyMap}
              onPlay={(item) => handlePlay(item)}
              onSelect={(item) => setSelectedItem(item)}
              onToggleWatchlist={handleToggleWatchlist}
            />

            {/* Movies & Series Rails */}
            <MediaRow
              title="Feature Films & Classics"
              items={filterByGenre(feed.movies)}
              watchlistIds={watchlistIds}
              historyMap={historyMap}
              onPlay={(item) => handlePlay(item)}
              onSelect={(item) => setSelectedItem(item)}
              onToggleWatchlist={handleToggleWatchlist}
            />

            <MediaRow
              title="Series & Multi-Platform Shows"
              items={filterByGenre(feed.series)}
              watchlistIds={watchlistIds}
              historyMap={historyMap}
              onPlay={(item) => handlePlay(item)}
              onSelect={(item) => setSelectedItem(item)}
              onToggleWatchlist={handleToggleWatchlist}
            />
          </>
        )}

        {/* Movies Grid View */}
        {!loading && !error && !isSearchingView && activeTab === 'movies' && feed && (
          <section className="px-4 py-6 sm:px-6 lg:px-10">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-white">
                  Movies
                </h1>
                <p className="mt-1 text-sm text-zinc-400">
                  Instant-play feature films and open cinema releases
                </p>
              </div>
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
                {['All', 'Sci-Fi', 'Thriller', 'Animation', 'Documentary', 'Adventure'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenreFilter(g)}
                    className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      genreFilter === g
                        ? 'bg-white text-[#0A0B0E]'
                        : 'bg-[#13151C] text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filterByGenre(feed.movies).map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  inWatchlist={watchlistIds.has(item.id)}
                  onPlay={(i) => handlePlay(i)}
                  onSelect={(i) => setSelectedItem(i)}
                  onToggleWatchlist={handleToggleWatchlist}
                />
              ))}
            </div>
          </section>
        )}

        {/* Series Grid View */}
        {!loading && !error && !isSearchingView && activeTab === 'series' && feed && (
          <section className="px-4 py-6 sm:px-6 lg:px-10">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-white">
                  Series & Shows
                </h1>
                <p className="mt-1 text-sm text-zinc-400">
                  Popular series aggregated across streaming platforms with episode tracking
                </p>
              </div>
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
                {['All', 'Sci-Fi', 'Drama', 'Crime', 'Thriller', 'Documentary'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenreFilter(g)}
                    className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      genreFilter === g
                        ? 'bg-white text-[#0A0B0E]'
                        : 'bg-[#13151C] text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filterByGenre(feed.series).map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  inWatchlist={watchlistIds.has(item.id)}
                  onPlay={(i) => handlePlay(i)}
                  onSelect={(i) => setSelectedItem(i)}
                  onToggleWatchlist={handleToggleWatchlist}
                />
              ))}
            </div>
          </section>
        )}

        {/* Watchlist & Taste Profile View */}
        {!loading && !error && !isSearchingView && activeTab === 'watchlist' && (
          <section className="px-4 py-6 sm:px-6 lg:px-10">
            <div className="mx-auto max-w-6xl space-y-10">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <h1 className="font-display text-2xl font-bold tracking-tight text-white">
                    My Watchlist
                  </h1>
                  <p className="mt-1 text-sm text-zinc-400">
                    Saved titles with automatic release notifications when new episodes arrive
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAlertsDrawer(true)}
                  className="flex min-h-[42px] items-center gap-2 rounded-lg border border-white/15 bg-[#13151C] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10"
                >
                  <Bell className="h-4 w-4 text-[#E11D48]" />
                  <span>View Release Alerts</span>
                  {unreadNotificationsCount > 0 && (
                    <span className="font-semibold tabular-nums text-[#E11D48]">
                      ({unreadNotificationsCount})
                    </span>
                  )}
                </button>
              </div>

              {(userState?.watchlist || []).length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#13151C] p-10 text-center">
                  <Film className="mx-auto mb-3 h-8 w-8 text-zinc-500" />
                  <p className="text-sm text-zinc-300">
                    Your watchlist is empty. Save movies or series from the feed to track new releases.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-[#111319]">
                  {(userState?.watchlist || []).map((entry) => {
                    const fullItem = allCatalogMap.get(entry.mediaId);
                    return (
                      <div
                        key={entry.mediaId}
                        className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-[#1A1D26]">
                            <MediaPoster
                              src={entry.posterUrl}
                              alt={entry.title}
                              title={entry.title}
                              className="h-full w-full"
                            />
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (fullItem) setSelectedItem(fullItem);
                              }}
                              className="font-display text-base font-semibold text-white hover:underline text-left truncate block max-w-full"
                            >
                              {entry.title}
                            </button>
                            <p className="mt-0.5 text-xs text-zinc-400">
                              {entry.platform}
                              <span aria-hidden="true"> · </span>
                              {entry.year}
                              <span aria-hidden="true"> · </span>
                              {entry.genres.slice(0, 2).join(' / ')}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                          <button
                            type="button"
                            onClick={() => handlePlayById(entry.mediaId)}
                            className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C]"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Play</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleNotify(entry.mediaId)}
                            className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                              entry.notifyNewReleases
                                ? 'border-[#E11D48]/40 bg-[#E11D48]/15 text-white'
                                : 'border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <Bell className="h-3.5 w-3.5" />
                            <span className="whitespace-nowrap">
                              {entry.notifyNewReleases ? 'Alerts On' : 'Alerts Off'}
                            </span>
                          </button>

                          {fullItem && (
                            <button
                              type="button"
                              onClick={() => handleToggleWatchlist(fullItem)}
                              aria-label={`Remove ${entry.title} from watchlist`}
                              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Taste Preferences to steer Recommendation Engine */}
              <div className="rounded-2xl border border-white/10 bg-[#111319] p-5 sm:p-6">
                <h2 className="font-display text-lg font-semibold text-white">
                  Viewing Preferences
                </h2>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  Select favorite genres to tune your Picked For You recommendations immediately.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {ALL_TASTE_GENRES.map((genre) => {
                    const selected = (userState?.preferredGenres || []).includes(genre);
                    return (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => handleTogglePreferredGenre(genre)}
                        className={`min-h-[40px] rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-[#E11D48] bg-[#E11D48]/20 text-white'
                            : 'border-white/10 bg-[#161922] text-zinc-300 hover:bg-white/10'
                        }`}
                      >
                        {genre}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Link to Admin Add-on Console */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#111319] p-5 sm:p-6">
                <div>
                  <h2 className="font-display text-base font-semibold text-white">
                    Stream Providers & Platform Controls
                  </h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    {(userState?.addons || []).filter((a) => a.enabled).length} external add-ons active. Install or test Stremio-compatible manifests and manage catalog settings in the Admin Console.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin')}
                  className="flex min-h-[40px] items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 whitespace-nowrap shrink-0"
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>Open Admin Console</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Admin Console View */}
        {!loading && !error && !isSearchingView && activeTab === 'admin' && (
          <AdminPanel
            onCatalogChanged={loadInitialData}
            onUserStateChanged={refreshRecommendationsAfterWatch}
          />
        )}

        {/* Mobile Dedicated Alerts View */}
        {!loading && !error && !isSearchingView && activeTab === 'alerts' && (
          <section className="px-4 py-6">
            <NotificationsPanel
              embedded
              notifications={userState?.notifications || []}
              onPlayMediaId={handlePlayById}
              onMarkAllRead={handleMarkNotificationsRead}
            />
          </section>
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb Navigation Bar (64px height) */}
      <nav
        aria-label="Mobile navigation"
        className="fixed right-0 bottom-0 left-0 z-40 grid h-16 grid-cols-4 items-center border-t border-white/10 bg-[#0A0B0E]/95 pb-safe backdrop-blur-md md:hidden"
      >
        {(
          [
            { id: 'home', label: 'Home', icon: Compass },
            { id: 'search', label: 'Search', icon: Search },
            { id: 'watchlist', label: 'Watchlist', icon: Bookmark },
            { id: 'alerts', label: 'Alerts', icon: Bell },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive =
            tab.id === 'search'
              ? isSearchingView
              : !isSearchingView && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === 'search') {
                  focusSearch();
                } else {
                  setSearchQuery('');
                  setActiveTab(tab.id);
                }
              }}
              className={`relative flex min-h-[44px] flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? 'text-[#E11D48]' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
              {tab.id === 'alerts' && unreadNotificationsCount > 0 && (
                <span className="sr-only">{unreadNotificationsCount} unread</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Title Detail Sheet / Modal */}
      {selectedItem && (
        <MediaDetailModal
          item={selectedItem}
          inWatchlist={watchlistIds.has(selectedItem.id)}
          notifyEnabled={watchlistNotifyMap.get(selectedItem.id) ?? true}
          onClose={() => setSelectedItem(null)}
          onPlay={(item, ep) => handlePlay(item, ep)}
          onToggleWatchlist={handleToggleWatchlist}
          onToggleNotify={handleToggleNotify}
        />
      )}

      {/* Notifications Drawer */}
      {showAlertsDrawer && (
        <NotificationsPanel
          notifications={userState?.notifications || []}
          onClose={() => setShowAlertsDrawer(false)}
          onPlayMediaId={handlePlayById}
          onMarkAllRead={handleMarkNotificationsRead}
        />
      )}

      {/* Seamless Inline Theater Video Player */}
      {playbackTarget && (
        <VideoPlayerModal
          item={playbackTarget.item}
          episode={playbackTarget.episode}
          initialTimeSeconds={playbackTarget.initialTime}
          onClose={() => setPlaybackTarget(null)}
          onSwitchEpisode={(ep) =>
            setPlaybackTarget((prev) =>
              prev ? { ...prev, episode: ep, initialTime: 0 } : null,
            )
          }
          onProgressSaved={refreshRecommendationsAfterWatch}
        />
      )}
    </div>
  );
}
