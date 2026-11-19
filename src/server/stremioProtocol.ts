import type {
  AddonProviderEntry,
  EpisodeItem,
  MediaItem,
  StreamSource,
  StremioCatalogDef,
} from '../types.ts';
import { loadPlatformConfig } from './adminStore.ts';

export interface StremioStreamObject {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    notWebReady?: boolean;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
  };
}

interface RawStremioResourceObj {
  name: string;
  types?: string[];
  idPrefixes?: string[];
}

interface RawStremioCatalogObj {
  type: string;
  id: string;
  name?: string;
  extra?: Array<{ name: string; isRequired?: boolean }>;
  extraSupported?: string[];
}

interface RawStremioManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  types?: string[];
  idPrefixes?: string[];
  resources?: Array<string | RawStremioResourceObj>;
  catalogs?: RawStremioCatalogObj[];
}

interface RawStremioMeta {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  year?: string | number;
  imdbRating?: string | number;
  runtime?: string;
  genres?: string[];
  director?: string[];
  cast?: string[];
  videos?: Array<{
    id?: string;
    title?: string;
    season?: number;
    episode?: number;
    released?: string;
    overview?: string;
    thumbnail?: string;
  }>;
}

const DEFAULT_OPEN_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'wss://tracker.openwebtorrent.com',
];

const ADDON_FETCH_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'KinoStream/1.0 (Stremio-Compatible Client)',
};

// Registry of external stream URLs returned by connected add-ons so /api/proxy-stream
// can safely relay them (including custom proxyHeaders) without exposing an open SSRF proxy.
interface StreamRelayEntry {
  url: string;
  headers?: Record<string, string>;
  expiresAt: number;
}

const streamRelayRegistry = new Map<string, StreamRelayEntry>();
const RELAY_TTL_MS = 6 * 60 * 60 * 1000;

export function registerStreamRelay(url: string, headers?: Record<string, string>): void {
  const now = Date.now();
  if (streamRelayRegistry.size > 500) {
    for (const [k, v] of streamRelayRegistry.entries()) {
      if (v.expiresAt < now) streamRelayRegistry.delete(k);
    }
  }
  streamRelayRegistry.set(url, {
    url,
    headers,
    expiresAt: now + RELAY_TTL_MS,
  });
}

export function getRegisteredStreamRelay(url: string): StreamRelayEntry | null {
  const entry = streamRelayRegistry.get(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    streamRelayRegistry.delete(url);
    return null;
  }
  return entry;
}

/**
 * Rewrites self-hosted `/stremio/...` URLs (like Cloud Run preview origins or localhost)
 * to `http://127.0.0.1:3000/stremio/...` for server-side internal calls so reverse-proxy
 * auth barriers never block the local Stremio endpoint.
 */
function resolveInternalFetchUrl(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.pathname.startsWith('/stremio/')) {
      const host = parsed.hostname.toLowerCase();
      const appUrlHost = (() => {
        try {
          return process.env.APP_URL ? new URL(process.env.APP_URL).hostname.toLowerCase() : '';
        } catch {
          return '';
        }
      })();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        (appUrlHost && host === appUrlHost) ||
        host.endsWith('.run.app')
      ) {
        return `http://127.0.0.1:3000${parsed.pathname}${parsed.search}`;
      }
    }
  } catch {
    // Keep original URL
  }
  return targetUrl;
}

function buildAddonEndpointUrl(addon: Pick<AddonProviderEntry, 'baseUrl' | 'manifestUrl'>, resourcePath: string): string {
  let query = '';
  try {
    const parsedManifest = new URL(addon.manifestUrl);
    if (parsedManifest.search) query = parsedManifest.search;
  } catch {
    // Ignore
  }
  const cleanBase = addon.baseUrl.replace(/\/+$/, '');
  const cleanPath = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  return resolveInternalFetchUrl(`${cleanBase}${cleanPath}${query}`);
}

export function normalizeManifestUrl(inputUrl: string): { manifestUrl: string; baseUrl: string } {
  let clean = inputUrl.trim();
  if (clean.startsWith('/')) {
    clean = `http://127.0.0.1:3000${clean}`;
  } else if (clean.startsWith('stremio://')) {
    clean = 'https://' + clean.slice('stremio://'.length);
  } else if (!/^https?:\/\//i.test(clean)) {
    clean = 'https://' + clean;
  }

  const parsed = new URL(clean);
  parsed.hash = '';

  if (/\/configure\/?$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/configure\/?$/i, '/manifest.json');
  } else if (!parsed.pathname.endsWith('/manifest.json')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/manifest.json';
  }

  const manifestUrl = parsed.toString();
  const basePath = parsed.pathname.replace(/\/manifest\.json$/, '');
  const baseUrl = `${parsed.origin}${basePath}`;
  return { manifestUrl, baseUrl };
}

export async function fetchAddonManifest(rawUrl: string): Promise<AddonProviderEntry> {
  const { manifestUrl, baseUrl } = normalizeManifestUrl(rawUrl);
  const fetchUrl = resolveInternalFetchUrl(manifestUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const res = await fetch(fetchUrl, {
    signal: controller.signal,
    headers: ADDON_FETCH_HEADERS,
  });
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`Add-on manifest responded with status ${res.status}`);
  }

  const raw = (await res.json()) as RawStremioManifest;
  if (!raw.id || !raw.name) {
    throw new Error('Invalid Stremio add-on manifest (missing id or name)');
  }

  const resourcesSet = new Set<string>();
  const typesSet = new Set<string>(Array.isArray(raw.types) ? raw.types : []);
  const idPrefixSet = new Set<string>(Array.isArray(raw.idPrefixes) ? raw.idPrefixes : []);

  if (Array.isArray(raw.resources)) {
    for (const r of raw.resources) {
      if (typeof r === 'string') {
        resourcesSet.add(r);
      } else if (r && typeof r === 'object' && r.name) {
        resourcesSet.add(r.name);
        if (Array.isArray(r.types)) {
          for (const t of r.types) typesSet.add(t);
        }
        if (Array.isArray(r.idPrefixes)) {
          for (const p of r.idPrefixes) idPrefixSet.add(p);
        }
      }
    }
  }
  if (resourcesSet.size === 0) {
    resourcesSet.add('stream');
  }

  const catalogs: StremioCatalogDef[] = Array.isArray(raw.catalogs)
    ? raw.catalogs
        .filter((c) => c && c.type && c.id)
        .map((c) => {
          const supportsSearch =
            Boolean(c.extra?.some((e) => e.name === 'search')) ||
            Boolean(c.extraSupported?.includes('search'));
          return {
            type: c.type,
            id: c.id,
            name: c.name || c.id,
            supportsSearch,
          };
        })
    : [];

  if (typesSet.size === 0) {
    for (const c of catalogs) typesSet.add(c.type);
  }
  if (typesSet.size === 0) {
    typesSet.add('movie');
    typesSet.add('series');
  }

  return {
    id: raw.id,
    name: raw.name,
    version: raw.version || '1.0.0',
    description: raw.description || 'Stremio-compatible stream provider',
    manifestUrl,
    baseUrl,
    types: Array.from(typesSet),
    resources: Array.from(resourcesSet),
    idPrefixes: idPrefixSet.size > 0 ? Array.from(idPrefixSet) : undefined,
    catalogs: catalogs.length > 0 ? catalogs : undefined,
    enabled: true,
    addedAt: new Date().toISOString(),
  };
}

function base32ToHex(base32: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]{32}$/.test(clean)) return null;
  let bits = '';
  for (const ch of clean) {
    const val = alphabet.indexOf(ch);
    if (val < 0) return null;
    bits += val.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.length === 40 ? hex.toLowerCase() : null;
}

function normalizeInfoHash(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[a-f0-9]{40}$/i.test(trimmed)) return trimmed.toLowerCase();
  return base32ToHex(trimmed);
}

function parseResolution(text: string): StreamSource['resolution'] {
  const lower = text.toLowerCase();
  if (lower.includes('2160p') || lower.includes('4k') || lower.includes('uhd')) return '2160p';
  if (lower.includes('1080p') || lower.includes('fhd')) return '1080p';
  if (lower.includes('720p') || lower.includes('hd')) return '720p';
  return '480p';
}

function parseSeeders(text: string): number {
  const match =
    text.match(/👤\s*(\d+)/) ||
    text.match(/(?:seeds?|seeders?|S)\s*[:=]?\s*(\d+)/i);
  if (match) return Number(match[1]) || 0;
  return 24;
}

function parseSizeBytes(text: string, hintBytes?: number): number {
  if (typeof hintBytes === 'number' && hintBytes > 0) return hintBytes;
  const gb = text.match(/(\d+(?:\.\d+)?)\s*GB/i);
  if (gb) return Math.round(Number(gb[1]) * 1024 * 1024 * 1024);
  const mb = text.match(/(\d+(?:\.\d+)?)\s*MB/i);
  if (mb) return Math.round(Number(mb[1]) * 1024 * 1024);
  return 1_200_000_000;
}

function estimateBitrateMbps(sizeBytes: number, runtimeMinutes: number, res: StreamSource['resolution']): number {
  if (sizeBytes > 0 && runtimeMinutes > 0) {
    const computed = (sizeBytes * 8) / (runtimeMinutes * 60) / 1_000_000;
    if (computed > 0.3 && computed < 45) return Number(computed.toFixed(2));
  }
  switch (res) {
    case '2160p':
      return 14.5;
    case '1080p':
      return 5.5;
    case '720p':
      return 2.6;
    case '480p':
    default:
      return 1.2;
  }
}

export function convertStremioStreams(
  addon: AddonProviderEntry,
  rawStreams: StremioStreamObject[],
  runtimeMinutes: number,
): StreamSource[] {
  const config = loadPlatformConfig();
  const defaultTrackers = config.customTrackers?.length ? config.customTrackers : DEFAULT_OPEN_TRACKERS;
  const converted: StreamSource[] = [];

  rawStreams.forEach((s, idx) => {
    const combinedText = `${s.name || ''} ${s.title || ''} ${s.description || ''} ${s.behaviorHints?.filename || ''}`;
    const resolution = parseResolution(combinedText);
    const seeders = parseSeeders(combinedText);
    const sizeBytes = parseSizeBytes(combinedText, s.behaviorHints?.videoSize);
    const bitrateMbps = estimateBitrateMbps(sizeBytes, runtimeMinutes, resolution);

    const trackers = (s.sources || [])
      .filter((src) => src.startsWith('tracker:'))
      .map((src) => src.slice('tracker:'.length));

    const effectiveTrackers = trackers.length > 0 ? trackers : defaultTrackers;

    if (s.url && /^https?:\/\//i.test(s.url)) {
      const requestHeaders = s.behaviorHints?.proxyHeaders?.request;
      registerStreamRelay(s.url, requestHeaders);
      const playbackUrl = requestHeaders
        ? `/api/proxy-stream?url=${encodeURIComponent(s.url)}`
        : s.url;

      const normalizedHash = normalizeInfoHash(s.infoHash);
      converted.push({
        id: `addon-${addon.id}-${idx}`,
        label: `${addon.name} · ${resolution}`,
        resolution,
        bitrateMbps,
        seeders: Math.max(seeders, 120),
        leechers: 8,
        webSeedUrl: playbackUrl,
        magnetUri: normalizedHash
          ? `magnet:?xt=urn:btih:${normalizedHash}&dn=${encodeURIComponent(s.behaviorHints?.filename || 'Stream')}`
          : '',
        infoHash: normalizedHash || `http-${idx}`,
        fileIdx: s.fileIdx,
        trackers: effectiveTrackers,
        sizeBytes,
        notWebReady: s.behaviorHints?.notWebReady,
        proxyHeaders: requestHeaders,
        fromAddon: true,
        addonName: addon.name,
      });
      return;
    }

    // Check for magnet:? inside url or externalUrl or infoHash
    const magnetCandidate =
      (s.url && s.url.startsWith('magnet:?') ? s.url : null) ||
      (s.externalUrl && s.externalUrl.startsWith('magnet:?') ? s.externalUrl : null);

    let normalizedHash = normalizeInfoHash(s.infoHash);
    let parsedTrackers = effectiveTrackers;
    if (!normalizedHash && magnetCandidate) {
      try {
        const params = new URLSearchParams(magnetCandidate.slice(8));
        const xt = params.get('xt') || '';
        normalizedHash = normalizeInfoHash(xt.replace('urn:btih:', ''));
        const trs = params.getAll('tr');
        if (trs.length > 0) parsedTrackers = trs;
      } catch {
        // Ignore
      }
    }

    if (normalizedHash) {
      const trackerQuery = parsedTrackers
        .slice(0, 6)
        .map((t) => `tr=${encodeURIComponent(t)}`)
        .join('&');
      const fileSegment = typeof s.fileIdx === 'number' ? String(s.fileIdx) : 'auto';
      const streamUrl = `/api/torrent-stream/${normalizedHash}/${fileSegment}?${trackerQuery}`;
      const magnetUri =
        magnetCandidate ||
        `magnet:?xt=urn:btih:${normalizedHash}` +
          `&dn=${encodeURIComponent(s.behaviorHints?.filename || s.title?.split('\n')[0] || normalizedHash)}` +
          parsedTrackers.slice(0, 6).map((t) => `&tr=${encodeURIComponent(t)}`).join('');

      converted.push({
        id: `addon-${addon.id}-${normalizedHash.slice(0, 8)}-${idx}`,
        label: `${addon.name} · ${resolution} P2P`,
        resolution,
        bitrateMbps,
        seeders,
        leechers: Math.max(1, Math.round(seeders * 0.15)),
        webSeedUrl: streamUrl,
        magnetUri,
        infoHash: normalizedHash,
        fileIdx: s.fileIdx,
        trackers: parsedTrackers,
        sizeBytes,
        notWebReady: s.behaviorHints?.notWebReady,
        fromAddon: true,
        addonName: addon.name,
      });
    }
  });

  return converted;
}

const imdbCache = new Map<string, { value: string | null; expiresAt: number }>();

export async function resolveImdbIdForMedia(item: MediaItem): Promise<string | null> {
  if (item.imdbId && item.imdbId.startsWith('tt')) return item.imdbId;
  if (item.id.startsWith('tt')) return item.id.split(':')[0];

  const cacheKey = `${item.type}:${item.title.toLowerCase()}:${item.year}`;
  const hit = imdbCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const catalogType = item.type === 'series' ? 'series' : 'movie';
    const res = await fetch(
      `https://v3-cinemeta.strem.io/catalog/${catalogType}/top/search=${encodeURIComponent(item.title)}.json`,
      { signal: controller.signal, headers: ADDON_FETCH_HEADERS },
    );
    clearTimeout(timer);
    if (!res.ok) {
      imdbCache.set(cacheKey, { value: null, expiresAt: Date.now() + 30_000 });
      return null;
    }
    const json = (await res.json()) as {
      metas?: Array<{ id?: string; imdb_id?: string; name?: string; releaseInfo?: string }>;
    };
    const metas = json.metas || [];
    const exact =
      metas.find((m) => (m.name || '').toLowerCase() === item.title.toLowerCase()) || metas[0];
    const resolved = exact?.imdb_id || (exact?.id?.startsWith('tt') ? exact.id : null) || null;
    imdbCache.set(cacheKey, {
      value: resolved,
      expiresAt: Date.now() + (resolved ? 15 * 60_000 : 30_000),
    });
    return resolved;
  } catch {
    imdbCache.set(cacheKey, { value: null, expiresAt: Date.now() + 30_000 });
    return null;
  }
}

export async function queryConnectedAddons(params: {
  addons: AddonProviderEntry[];
  item: MediaItem;
  episode?: EpisodeItem;
}): Promise<StreamSource[]> {
  const { addons, item, episode } = params;
  const enabled = addons.filter((a) => a.enabled && a.resources.includes('stream'));
  if (enabled.length === 0) return [];

  const imdbId = await resolveImdbIdForMedia(item);
  const stremioType = item.type === 'series' ? 'series' : 'movie';

  const candidateIds: string[] = [];
  if (imdbId) {
    if (stremioType === 'series' && episode) {
      candidateIds.push(`${imdbId}:${episode.season}:${episode.number}`);
    } else if (stremioType === 'series') {
      candidateIds.push(`${imdbId}:1:1`);
    } else {
      candidateIds.push(imdbId);
    }
  }
  if (item.addonMetaId) {
    if (stremioType === 'series' && episode && !item.addonMetaId.includes(':')) {
      candidateIds.push(`${item.addonMetaId}:${episode.season}:${episode.number}`);
    } else {
      candidateIds.push(item.addonMetaId);
    }
  }
  if (item.archiveIdentifier) {
    candidateIds.push(`ia:${item.archiveIdentifier}`);
  }
  candidateIds.push(item.id);

  const uniqueCandidates = candidateIds.filter((id, idx, arr) => id && arr.indexOf(id) === idx);
  if (uniqueCandidates.length === 0) return [];

  const runtime = episode?.runtimeMinutes || item.runtimeMinutes || 60;

  const fetches = enabled
    .filter((addon) => addon.types.length === 0 || addon.types.includes(stremioType))
    .map(async (addon) => {
      // Pick the candidate IDs that match the add-on's declared idPrefixes (if any)
      const prefixes = addon.idPrefixes;
      const orderedIds =
        prefixes && prefixes.length > 0
          ? uniqueCandidates.filter((cid) => prefixes.some((p) => cid.startsWith(p)))
          : uniqueCandidates;

      const idsToTry = orderedIds.length > 0 ? orderedIds : [uniqueCandidates[0]];

      for (const targetId of idsToTry.slice(0, 2)) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const url = buildAddonEndpointUrl(
            addon,
            `/stream/${stremioType}/${encodeURIComponent(targetId)}.json`,
          );
          const res = await fetch(url, {
            signal: controller.signal,
            headers: ADDON_FETCH_HEADERS,
          });
          clearTimeout(timer);
          if (!res.ok) continue;
          const json = (await res.json()) as { streams?: StremioStreamObject[] };
          const streams = convertStremioStreams(addon, json.streams || [], runtime);
          if (streams.length > 0) return streams;
        } catch {
          // Try next candidate ID
        }
      }
      return [];
    });

  const results = await Promise.allSettled(fetches);
  const aggregated: StreamSource[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      aggregated.push(...r.value);
    }
  }
  return aggregated;
}

function mapStremioMetaToMediaItem(meta: RawStremioMeta, addon: AddonProviderEntry): MediaItem | null {
  if (!meta.id || !meta.name) return null;
  const mediaType = meta.type === 'series' ? 'series' : 'movie';
  const yearMatch = String(meta.year || meta.releaseInfo || '2024').match(/\d{4}/);
  const year = yearMatch ? Number(yearMatch[0]) : 2024;
  const runtimeMatch = String(meta.runtime || '').match(/\d+/);
  const runtimeMinutes = runtimeMatch ? Number(runtimeMatch[0]) : mediaType === 'series' ? 45 : 100;
  const imdbId = meta.imdb_id || (meta.id.startsWith('tt') ? meta.id.split(':')[0] : undefined);
  const rating = Number(meta.imdbRating) || 7.8;

  const episodes: EpisodeItem[] | undefined =
    mediaType === 'series' && Array.isArray(meta.videos) && meta.videos.length > 0
      ? meta.videos
          .filter((v) => typeof v.season === 'number' && typeof v.episode === 'number')
          .slice(0, 48)
          .map((v) => ({
            id: v.id || `${meta.id}:${v.season}:${v.episode}`,
            season: v.season || 1,
            number: v.episode || 1,
            title: v.title || `Episode ${v.episode || 1}`,
            airDate: v.released ? String(v.released).slice(0, 10) : `${year}-01-01`,
            runtimeMinutes,
            summary: v.overview || 'Ready to stream via connected add-on providers.',
            stillUrl: v.thumbnail,
          }))
      : undefined;

  return {
    id: `stremio-${addon.id}-${meta.id}`,
    addonId: addon.id,
    addonMetaId: meta.id,
    imdbId,
    title: meta.name,
    type: mediaType,
    year,
    runtimeMinutes,
    rating: Number(rating.toFixed(1)),
    genres: Array.isArray(meta.genres) && meta.genres.length > 0 ? meta.genres.slice(0, 3) : ['Cinema'],
    platform: 'Open Cinema',
    synopsis: meta.description || `Indexed via ${addon.name}.`,
    directorOrCreator: Array.isArray(meta.director) && meta.director.length > 0
      ? meta.director.slice(0, 2).join(', ')
      : addon.name,
    cast: Array.isArray(meta.cast) ? meta.cast.slice(0, 6) : [],
    posterUrl: meta.poster || '/src/assets/images/poster_orbital_drift_1795043578495.jpg',
    backdropUrl: meta.background || meta.poster || '/src/assets/images/hero_solaris_odyssey_1795043578962.jpg',
    releaseDate: `${year}-01-01`,
    isNewRelease: year >= 2024,
    isTrending: rating >= 7.5,
    popularityScore: Math.min(95, Math.max(72, Math.round(rating * 10))),
    playable: true,
    sources: [],
    episodes,
  };
}

export async function fetchAddonCatalogItems(
  addons: AddonProviderEntry[],
  limitPerCatalog = 10,
): Promise<MediaItem[]> {
  const catalogAddons = addons.filter(
    (a) => a.enabled && a.resources.includes('catalog') && a.catalogs && a.catalogs.length > 0,
  );
  if (catalogAddons.length === 0) return [];

  const tasks: Promise<MediaItem[]>[] = [];
  for (const addon of catalogAddons) {
    // Pick up to first 2 catalogs per add-on (e.g. top movies + top series)
    const picks = (addon.catalogs || []).slice(0, 2);
    for (const cat of picks) {
      tasks.push(
        (async () => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            const url = buildAddonEndpointUrl(
              addon,
              `/catalog/${encodeURIComponent(cat.type)}/${encodeURIComponent(cat.id)}.json`,
            );
            const res = await fetch(url, {
              signal: controller.signal,
              headers: ADDON_FETCH_HEADERS,
            });
            clearTimeout(timer);
            if (!res.ok) return [];
            const json = (await res.json()) as { metas?: RawStremioMeta[] };
            return (json.metas || [])
              .slice(0, limitPerCatalog)
              .map((m) => mapStremioMetaToMediaItem({ ...m, type: m.type || cat.type }, addon))
              .filter((m): m is MediaItem => Boolean(m));
          } catch {
            return [];
          }
        })(),
      );
    }
  }

  const settled = await Promise.allSettled(tasks);
  const items: MediaItem[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') items.push(...s.value);
  }
  return items;
}

export async function searchConnectedAddonCatalogs(
  addons: AddonProviderEntry[],
  query: string,
): Promise<MediaItem[]> {
  const catalogAddons = addons.filter(
    (a) => a.enabled && a.resources.includes('catalog') && a.catalogs && a.catalogs.length > 0,
  );
  if (catalogAddons.length === 0) return [];

  const tasks: Promise<MediaItem[]>[] = [];
  for (const addon of catalogAddons) {
    const searchableCatalogs = (addon.catalogs || [])
      .filter((c) => c.supportsSearch !== false)
      .slice(0, 3);
    for (const cat of searchableCatalogs) {
      tasks.push(
        (async () => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const url = buildAddonEndpointUrl(
              addon,
              `/catalog/${encodeURIComponent(cat.type)}/${encodeURIComponent(cat.id)}/search=${encodeURIComponent(query)}.json`,
            );
            const res = await fetch(url, {
              signal: controller.signal,
              headers: ADDON_FETCH_HEADERS,
            });
            clearTimeout(timer);
            if (!res.ok) return [];
            const json = (await res.json()) as { metas?: RawStremioMeta[] };
            return (json.metas || [])
              .slice(0, 8)
              .map((m) => mapStremioMetaToMediaItem({ ...m, type: m.type || cat.type }, addon))
              .filter((m): m is MediaItem => Boolean(m));
          } catch {
            return [];
          }
        })(),
      );
    }
  }

  const settled = await Promise.allSettled(tasks);
  const items: MediaItem[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') items.push(...s.value);
  }
  return items;
}

export async function fetchAddonMetaById(params: {
  addons: AddonProviderEntry[];
  addonId?: string;
  type: 'movie' | 'series';
  metaId: string;
}): Promise<MediaItem | null> {
  const { addons, addonId, type, metaId } = params;
  const metaAddons = addons.filter((a) => a.enabled && a.resources.includes('meta'));
  const targetAddon = addonId ? metaAddons.find((a) => a.id === addonId) : undefined;
  const candidates = targetAddon ? [targetAddon, ...metaAddons.filter((a) => a.id !== addonId)] : metaAddons;

  for (const addon of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = buildAddonEndpointUrl(
        addon,
        `/meta/${encodeURIComponent(type)}/${encodeURIComponent(metaId)}.json`,
      );
      const res = await fetch(url, {
        signal: controller.signal,
        headers: ADDON_FETCH_HEADERS,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = (await res.json()) as { meta?: RawStremioMeta };
      if (json.meta) {
        const mapped = mapStremioMetaToMediaItem(json.meta, addon);
        if (mapped) return mapped;
      }
    } catch {
      // Try next meta add-on
    }
  }

  // Cinemeta public metadata fallback for IMDb IDs if user's add-on only provided catalog without meta
  if (metaId.startsWith('tt')) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(
        `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(metaId)}.json`,
        { signal: controller.signal, headers: ADDON_FETCH_HEADERS },
      );
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as { meta?: RawStremioMeta };
        if (json.meta) {
          return mapStremioMetaToMediaItem(json.meta, {
            id: 'com.linvo.cinemeta',
            name: 'Cinemeta',
            version: '3.0',
            description: 'Open Metadata',
            manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json',
            baseUrl: 'https://v3-cinemeta.strem.io',
            types: ['movie', 'series'],
            resources: ['catalog', 'meta'],
            enabled: true,
            addedAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

export async function probeAddonHealth(rawUrl: string): Promise<{
  ok: boolean;
  latencyMs: number;
  name?: string;
  version?: string;
  resources?: string[];
  catalogProbeCount?: number;
  streamProbeCount?: number;
  detail?: string;
  error?: string;
}> {
  const start = Date.now();
  try {
    const entry = await fetchAddonManifest(rawUrl);
    const details: string[] = [];
    let catalogProbeCount: number | undefined;
    let streamProbeCount: number | undefined;

    if (entry.resources.includes('catalog') && entry.catalogs?.length) {
      const cat = entry.catalogs[0];
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const catUrl = buildAddonEndpointUrl(
          entry,
          `/catalog/${encodeURIComponent(cat.type)}/${encodeURIComponent(cat.id)}.json`,
        );
        const catRes = await fetch(catUrl, {
          signal: controller.signal,
          headers: ADDON_FETCH_HEADERS,
        });
        clearTimeout(timer);
        if (catRes.ok) {
          const catJson = (await catRes.json()) as { metas?: unknown[] };
          catalogProbeCount = Array.isArray(catJson.metas) ? catJson.metas.length : 0;
          details.push(`Catalog "${cat.name || cat.id}": ${catalogProbeCount} items`);
        } else {
          details.push(`Catalog returned HTTP ${catRes.status}`);
        }
      } catch {
        details.push('Catalog probe timed out');
      }
    }

    if (entry.resources.includes('stream')) {
      const probeType = entry.types.includes('movie') ? 'movie' : entry.types[0] || 'movie';
      const probeId = probeType === 'series' ? 'tt0903747:1:1' : 'tt2285752';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const streamUrl = buildAddonEndpointUrl(
          entry,
          `/stream/${probeType}/${encodeURIComponent(probeId)}.json`,
        );
        const streamRes = await fetch(streamUrl, {
          signal: controller.signal,
          headers: ADDON_FETCH_HEADERS,
        });
        clearTimeout(timer);
        if (streamRes.ok) {
          const streamJson = (await streamRes.json()) as { streams?: unknown[] };
          streamProbeCount = Array.isArray(streamJson.streams) ? streamJson.streams.length : 0;
          details.push(`Stream probe (${probeId}): ${streamProbeCount} streams`);
        } else {
          details.push(`Stream probe returned HTTP ${streamRes.status}`);
        }
      } catch {
        details.push('Stream probe timed out');
      }
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      name: entry.name,
      version: entry.version,
      resources: entry.resources,
      catalogProbeCount,
      streamProbeCount,
      detail: details.join(' · ') || 'Manifest valid',
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Probe failed',
    };
  }
}

export function buildLocalStremioManifest() {
  return {
    id: 'org.kinostream.open',
    version: '1.0.0',
    name: 'KinoStream Open Cinema',
    description:
      'Stremio-compatible open cinema and Internet Archive public-domain stream provider.',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'ia:', 'kino:'],
    catalogs: [],
  };
}
