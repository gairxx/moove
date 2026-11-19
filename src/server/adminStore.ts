import fs from 'fs';
import path from 'path';
import type { MediaItem, PlatformConfig, PlatformSource } from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const CONFIG_FILE = path.join(DATA_DIR, 'platform-config.json');

const DEFAULT_CONFIG: PlatformConfig = {
  heroMediaId: 'auto',
  tvmazeFeedEnabled: true,
  internetArchiveSearchEnabled: true,
  openCinemaCatalogEnabled: true,
  maxResolutionCap: '2160p',
  bandwidthHeadroomFactor: 0.85,
  preferWebReadyStreams: true,
  p2pMaxConnections: 55,
  hiddenMediaIds: [],
  customItems: [],
  customTrackers: [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'wss://tracker.openwebtorrent.com',
  ],
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadPlatformConfig(): PlatformConfig {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PlatformConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      hiddenMediaIds: parsed.hiddenMediaIds || [],
      customItems: parsed.customItems || [],
      customTrackers: parsed.customTrackers?.length ? parsed.customTrackers : DEFAULT_CONFIG.customTrackers,
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function savePlatformConfig(next: PlatformConfig): PlatformConfig {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function updatePlatformConfig(patch: Partial<PlatformConfig>): PlatformConfig {
  const current = loadPlatformConfig();
  const updated: PlatformConfig = {
    ...current,
    ...patch,
  };
  return savePlatformConfig(updated);
}

export function toggleMediaVisibility(mediaId: string): PlatformConfig {
  const current = loadPlatformConfig();
  const set = new Set(current.hiddenMediaIds);
  if (set.has(mediaId)) {
    set.delete(mediaId);
  } else {
    set.add(mediaId);
  }
  current.hiddenMediaIds = Array.from(set);
  return savePlatformConfig(current);
}

export function addCustomCatalogItem(input: {
  title: string;
  type: 'movie' | 'series';
  year: number;
  genres: string[];
  platform: PlatformSource;
  synopsis: string;
  posterUrl?: string;
  streamOrMagnetUrl: string;
}): { config: PlatformConfig; item: MediaItem } {
  const config = loadPlatformConfig();
  const rawLink = input.streamOrMagnetUrl.trim();
  const isMagnet = rawLink.toLowerCase().startsWith('magnet:?');

  let infoHash = 'custom0000000000000000000000000000000000';
  let webSeedUrl = rawLink;
  let trackers: string[] = [];

  if (isMagnet) {
    const params = new URLSearchParams(rawLink.slice(8));
    const xt = params.get('xt') || '';
    infoHash = xt.replace('urn:btih:', '').trim().toLowerCase() || infoHash;
    trackers = params.getAll('tr');
    const ws = params.get('ws');
    const trackerQuery = trackers.slice(0, 6).map((t) => `tr=${encodeURIComponent(t)}`).join('&');
    webSeedUrl =
      ws && /^https?:\/\//i.test(ws)
        ? `/api/proxy-stream?url=${encodeURIComponent(ws)}`
        : `/api/torrent-stream/${encodeURIComponent(infoHash)}/auto${trackerQuery ? `?${trackerQuery}` : ''}`;
  }

  const id = `custom-${Date.now().toString(36)}`;
  const item: MediaItem = {
    id,
    title: input.title.trim(),
    type: input.type,
    year: input.year || new Date().getFullYear(),
    runtimeMinutes: input.type === 'series' ? 48 : 104,
    rating: 8.4,
    genres: input.genres.length ? input.genres : ['Drama'],
    platform: input.platform || 'Open Cinema',
    synopsis: input.synopsis.trim() || 'Published via KinoStream Admin Console.',
    directorOrCreator: 'Platform Admin',
    cast: [],
    posterUrl: input.posterUrl?.trim() || '/src/assets/images/poster_orbital_drift_1795043578495.jpg',
    backdropUrl: input.posterUrl?.trim() || '/src/assets/images/hero_solaris_odyssey_1795043578962.jpg',
    releaseDate: new Date().toISOString().slice(0, 10),
    isNewRelease: true,
    isTrending: true,
    popularityScore: 91,
    playable: true,
    sources: [
      {
        id: `${id}-src`,
        label: isMagnet ? 'Admin Magnet Source' : 'Admin Direct Stream',
        resolution: '1080p',
        bitrateMbps: 5.0,
        seeders: 250,
        leechers: 12,
        webSeedUrl,
        magnetUri: isMagnet ? rawLink : '',
        infoHash,
        trackers,
      },
    ],
  };

  config.customItems.unshift(item);
  savePlatformConfig(config);
  return { config, item };
}

export function deleteCustomCatalogItem(mediaId: string): PlatformConfig {
  const config = loadPlatformConfig();
  config.customItems = config.customItems.filter((i) => i.id !== mediaId);
  if (config.heroMediaId === mediaId) {
    config.heroMediaId = 'auto';
  }
  return savePlatformConfig(config);
}
