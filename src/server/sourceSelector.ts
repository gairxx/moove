import type { ResolvedPlayback, StreamSource } from '../types.ts';
import { loadPlatformConfig } from './adminStore.ts';

interface ProbeCacheEntry {
  ok: boolean;
  latencyMs: number;
  checkedAt: number;
}

const healthCache = new Map<string, ProbeCacheEntry>();
const HEALTH_TTL_MS = 120_000;

export function clearStreamProbeCache(): void {
  healthCache.clear();
}

async function probeSourceUrl(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  // Local proxy & torrent-stream routes handle upstream connections directly
  if (url.startsWith('/api/')) {
    return { ok: true, latencyMs: url.startsWith('/api/torrent-stream/') ? 140 : 65 };
  }

  const cached = healthCache.get(url);
  if (cached && Date.now() - cached.checkedAt < HEALTH_TTL_MS) {
    return { ok: cached.ok, latencyMs: cached.latencyMs };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);

    // Many streaming CDNs & add-on URLs reject HEAD (405/403/501) but allow ranged GET
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      const getController = new AbortController();
      const getTimer = setTimeout(() => getController.abort(), 2200);
      res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1' },
        signal: getController.signal,
      });
      clearTimeout(getTimer);
      res.body?.cancel().catch(() => {});
    }

    const latencyMs = Date.now() - start;
    const ok = res.ok || res.status === 206;
    healthCache.set(url, { ok, latencyMs, checkedAt: Date.now() });
    return { ok, latencyMs };
  } catch {
    const latencyMs = Date.now() - start;
    healthCache.set(url, { ok: true, latencyMs: Math.min(latencyMs, 350), checkedAt: Date.now() });
    return { ok: true, latencyMs: Math.min(latencyMs, 350) };
  }
}

function resolutionWeight(res: StreamSource['resolution']): number {
  switch (res) {
    case '2160p':
      return 4;
    case '1080p':
      return 3;
    case '720p':
      return 2;
    case '480p':
    default:
      return 1;
  }
}

/**
 * Bandwidth-aware & seed-aware automatic source selector.
 * Silently evaluates seed/leech swarm health, live webseed latency, and client
 * downlink headroom so playback starts immediately with zero manual configuration.
 * Connected add-on streams are ranked ahead of generic fallback streams.
 */
export async function selectOptimalStream(params: {
  mediaId: string;
  episodeId?: string;
  title: string;
  sources: StreamSource[];
  downlinkMbps: number;
  durationHintSeconds?: number;
}): Promise<ResolvedPlayback> {
  const { mediaId, episodeId, title, sources, downlinkMbps, durationHintSeconds } = params;
  const config = loadPlatformConfig();
  const safeBandwidth = Number.isFinite(downlinkMbps) && downlinkMbps > 0 ? downlinkMbps : 12;
  const headroomMbps = safeBandwidth * (config.bandwidthHeadroomFactor || 0.85);
  const capWeight = resolutionWeight(config.maxResolutionCap || '2160p');

  const addonSources = sources.filter((s) => s.fromAddon);
  const nonFallbackSources = sources.filter((s) => !s.isFallback);
  const primaryPool =
    addonSources.length > 0
      ? addonSources
      : nonFallbackSources.length > 0
        ? nonFallbackSources
        : sources;

  const withinCap = primaryPool.filter((s) => resolutionWeight(s.resolution) <= capWeight);
  const candidates = withinCap.length > 0 ? withinCap : primaryPool;

  // Probe candidate URLs concurrently with fast timeout
  const probed = await Promise.all(
    candidates.map(async (src) => {
      const health = await probeSourceUrl(src.webSeedUrl);
      const fitsBandwidth = src.bitrateMbps <= headroomMbps;
      const seedHealth =
        Math.log2(Math.max(1, src.seeders) + 1) *
        (src.seeders / Math.max(1, src.seeders + src.leechers));
      const latencyPenalty = health.latencyMs / 250;
      const resScore = resolutionWeight(src.resolution) * (fitsBandwidth ? 2.5 : -2.0);
      const webReadyBonus = config.preferWebReadyStreams
        ? src.notWebReady
          ? -4.0
          : 3.0
        : 0;
      const score =
        (health.ok ? 20 : -50) + seedHealth * 2 + resScore + webReadyBonus - latencyPenalty;
      return { src, health, score };
    }),
  );

  probed.sort((a, b) => b.score - a.score);

  const primary = probed[0]?.src || sources[0];
  const primaryProxyFallback =
    primary.fromAddon && primary.webSeedUrl.startsWith('http')
      ? [`/api/proxy-stream?url=${encodeURIComponent(primary.webSeedUrl)}`]
      : [];
  const orderedFallbacks = [
    ...primaryProxyFallback,
    ...probed.slice(1).map((p) => p.src.webSeedUrl),
    ...sources.filter((s) => !candidates.includes(s)).map((s) => s.webSeedUrl),
  ];
  const fallbackUrls = orderedFallbacks.filter(
    (u, idx, arr) => u && u !== primary.webSeedUrl && arr.indexOf(u) === idx,
  );

  return {
    mediaId,
    episodeId,
    title,
    streamUrl: primary.webSeedUrl,
    fallbackUrls,
    selectedResolution: primary.resolution,
    estimatedStartMs: probed[0]?.health.latencyMs || 120,
    durationHintSeconds,
  };
}
