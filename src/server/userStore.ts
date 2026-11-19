import fs from 'fs';
import path from 'path';
import type {
  AddonProviderEntry,
  MediaItem,
  ReleaseNotification,
  UserState,
  WatchHistoryEntry,
  WatchlistEntry,
} from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'user-state.json');

const DEFAULT_STATE: UserState = {
  watchlist: [
    {
      mediaId: 'solaris-odyssey',
      title: 'Solaris Odyssey',
      type: 'series',
      genres: ['Sci-Fi', 'Drama', 'Mystery'],
      platform: 'Open Cinema',
      posterUrl: '/src/assets/images/poster_orbital_drift_1795043578495.jpg',
      year: 2026,
      addedAt: '2026-11-10T18:00:00.000Z',
      notifyNewReleases: true,
      latestKnownDate: '2026-11-12',
    },
    {
      mediaId: 'ancient-canopy',
      title: 'Ancient Canopy',
      type: 'series',
      genres: ['Documentary', 'Nature'],
      platform: 'Apple TV+',
      posterUrl: '/src/assets/images/poster_ancient_canopy_1795043579006.jpg',
      year: 2026,
      addedAt: '2026-11-11T14:30:00.000Z',
      notifyNewReleases: true,
      latestKnownDate: '2026-11-15',
    },
  ],
  history: [
    {
      mediaId: 'orbital-drift',
      title: 'Orbital Drift',
      genres: ['Sci-Fi', 'Adventure', 'Thriller'],
      platform: 'Open Cinema',
      posterUrl: '/src/assets/images/poster_orbital_drift_1795043578495.jpg',
      progressSeconds: 1840,
      durationSeconds: 7080,
      completed: false,
      lastWatchedAt: '2026-11-17T21:15:00.000Z',
    },
  ],
  preferredGenres: ['Sci-Fi', 'Thriller', 'Documentary'],
  notifications: [
    {
      id: 'notif-solaris-s1e3',
      mediaId: 'solaris-odyssey',
      title: 'Solaris Odyssey',
      platform: 'Open Cinema',
      posterUrl: '/src/assets/images/poster_orbital_drift_1795043578495.jpg',
      headline: 'New Episode Available: S1 E3 · Ring Horizon',
      detail: 'Released Nov 12 · Ready to play instantly',
      releaseDate: '2026-11-12',
      read: false,
    },
    {
      id: 'notif-canopy-s1e2',
      mediaId: 'ancient-canopy',
      title: 'Ancient Canopy',
      platform: 'Apple TV+',
      posterUrl: '/src/assets/images/poster_ancient_canopy_1795043579006.jpg',
      headline: 'New Episode Available: S1 E2 · The Crown Architecture',
      detail: 'Released Nov 15 · Ready to play instantly',
      releaseDate: '2026-11-15',
      read: false,
    },
  ],
  addons: [],
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadUserState(): UserState {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UserState>;
    return {
      watchlist: parsed.watchlist || [],
      history: parsed.history || [],
      preferredGenres: parsed.preferredGenres || [],
      notifications: parsed.notifications || [],
      addons: parsed.addons || [],
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveUserState(state: UserState): UserState {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

export function upsertAddonProvider(entry: AddonProviderEntry): UserState {
  const state = loadUserState();
  const idx = state.addons.findIndex(
    (a) => a.id === entry.id || a.manifestUrl === entry.manifestUrl,
  );
  if (idx >= 0) {
    state.addons[idx] = entry;
  } else {
    state.addons.unshift(entry);
  }
  return saveUserState(state);
}

export function toggleAddonProvider(addonId: string): UserState {
  const state = loadUserState();
  const target = state.addons.find((a) => a.id === addonId);
  if (target) {
    target.enabled = !target.enabled;
  }
  return saveUserState(state);
}

export function removeAddonProvider(addonId: string): UserState {
  const state = loadUserState();
  state.addons = state.addons.filter((a) => a.id !== addonId);
  return saveUserState(state);
}

export function toggleWatchlist(item: MediaItem, notifyNewReleases = true): UserState {
  const state = loadUserState();
  const existsIdx = state.watchlist.findIndex((w) => w.mediaId === item.id);

  if (existsIdx >= 0) {
    state.watchlist.splice(existsIdx, 1);
  } else {
    const entry: WatchlistEntry = {
      mediaId: item.id,
      title: item.title,
      type: item.type,
      genres: item.genres,
      platform: item.platform,
      posterUrl: item.posterUrl,
      year: item.year,
      addedAt: new Date().toISOString(),
      notifyNewReleases,
      latestKnownDate: item.releaseDate,
    };
    state.watchlist.unshift(entry);

    // Emit immediate release alert if this item is a recent or new release
    if (item.isNewRelease) {
      const notifId = `notif-${item.id}-${item.releaseDate}`;
      if (!state.notifications.some((n) => n.id === notifId)) {
        const latestEp = item.episodes?.[item.episodes.length - 1];
        const newNotif: ReleaseNotification = {
          id: notifId,
          mediaId: item.id,
          title: item.title,
          platform: item.platform,
          posterUrl: item.posterUrl,
          headline: latestEp
            ? `New Episode Alert: S${latestEp.season} E${latestEp.number} · ${latestEp.title}`
            : `New Release Added: ${item.title} (${item.year})`,
          detail: `Tracking releases on ${item.platform}`,
          releaseDate: item.releaseDate,
          read: false,
        };
        state.notifications.unshift(newNotif);
      }
    }
  }

  return saveUserState(state);
}

export function toggleWatchlistNotify(mediaId: string): UserState {
  const state = loadUserState();
  const target = state.watchlist.find((w) => w.mediaId === mediaId);
  if (target) {
    target.notifyNewReleases = !target.notifyNewReleases;
  }
  return saveUserState(state);
}

export function recordWatchProgress(entry: Omit<WatchHistoryEntry, 'lastWatchedAt'>): UserState {
  const state = loadUserState();
  const idx = state.history.findIndex((h) => h.mediaId === entry.mediaId);
  const nextEntry: WatchHistoryEntry = {
    ...entry,
    lastWatchedAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    state.history.splice(idx, 1);
  }
  state.history.unshift(nextEntry);
  state.history = state.history.slice(0, 30);

  return saveUserState(state);
}

export function updatePreferredGenres(genres: string[]): UserState {
  const state = loadUserState();
  state.preferredGenres = genres;
  return saveUserState(state);
}

export function markNotificationsRead(notificationId?: string): UserState {
  const state = loadUserState();
  for (const n of state.notifications) {
    if (!notificationId || n.id === notificationId) {
      n.read = true;
    }
  }
  return saveUserState(state);
}

export function buildRecommendations(catalog: MediaItem[], state: UserState): MediaItem[] {
  const genreWeights = new Map<string, number>();

  for (const g of state.preferredGenres) {
    genreWeights.set(g.toLowerCase(), (genreWeights.get(g.toLowerCase()) || 0) + 2.0);
  }

  for (const w of state.watchlist) {
    for (const g of w.genres) {
      genreWeights.set(g.toLowerCase(), (genreWeights.get(g.toLowerCase()) || 0) + 2.5);
    }
  }

  state.history.forEach((h, idx) => {
    const recencyWeight = Math.max(0.8, 3.0 - idx * 0.25);
    const completionBoost = h.completed ? 1.5 : 1.0;
    for (const g of h.genres) {
      genreWeights.set(
        g.toLowerCase(),
        (genreWeights.get(g.toLowerCase()) || 0) + recencyWeight * completionBoost,
      );
    }
  });

  const completedIds = new Set(state.history.filter((h) => h.completed).map((h) => h.mediaId));
  const lastWatched = state.history[0];

  const scored = catalog
    .filter((item) => !completedIds.has(item.id))
    .map((item) => {
      let affinity = 0;
      const matchedGenres: string[] = [];

      for (const g of item.genres) {
        const w = genreWeights.get(g.toLowerCase()) || 0;
        if (w > 0) {
          affinity += w;
          matchedGenres.push(g);
        }
      }

      const popularityBoost = item.popularityScore / 25;
      const score = affinity * 3 + popularityBoost + item.rating;

      let reason = `Popular on ${item.platform}`;
      if (lastWatched && matchedGenres.length > 0 && item.id !== lastWatched.mediaId) {
        reason = `Matches ${matchedGenres.slice(0, 2).join(' & ')} from your viewing`;
      } else if (matchedGenres.length > 0) {
        reason = `Aligned with your ${matchedGenres[0]} preference`;
      }

      return {
        item: { ...item, recommendationReason: reason },
        score,
      };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 12).map((s) => s.item);
}
