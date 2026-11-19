import 'dotenv/config';
import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import {
  addCustomCatalogItem,
  deleteCustomCatalogItem,
  loadPlatformConfig,
  toggleMediaVisibility,
  updatePlatformConfig,
} from './src/server/adminStore.ts';
import {
  clearCatalogCache,
  findMediaById,
  getAllCatalogItems,
  getRawMergedCatalog,
  scrapeArchiveMetadata,
  unifiedSearch,
} from './src/server/catalog.ts';
import {
  clearStreamProbeCache,
  selectOptimalStream,
} from './src/server/sourceSelector.ts';
import {
  buildLocalStremioManifest,
  fetchAddonManifest,
  getRegisteredStreamRelay,
  probeAddonHealth,
  queryConnectedAddons,
} from './src/server/stremioProtocol.ts';
import {
  evictSwarm,
  listActiveSwarms,
  resolveTorrentFile,
} from './src/server/torrentEngine.ts';
import {
  buildRecommendations,
  loadUserState,
  markNotificationsRead,
  recordWatchProgress,
  removeAddonProvider,
  toggleAddonProvider,
  toggleWatchlist,
  toggleWatchlistNotify,
  updatePreferredGenres,
  upsertAddonProvider,
} from './src/server/userStore.ts';
import type {
  AdminOverviewResponse,
  EpisodeItem,
  FeedResponse,
  PlatformSource,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_PROXY_HOSTS = new Set([
  'archive.org',
  'ia600000.us.archive.org',
  'ia800000.us.archive.org',
  'commondatastorage.googleapis.com',
  'download.blender.org',
]);

function isAllowedStreamHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_PROXY_HOSTS.has(host)) return true;
    return host.endsWith('.archive.org') || host.endsWith('.blender.org');
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Lightweight 64KB bandwidth probe for automatic source selection
  const probeBuffer = Buffer.alloc(64 * 1024, 0x4b);
  app.get('/api/speed-probe', (_req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.setHeader('Content-Length', String(probeBuffer.length));
    res.send(probeBuffer);
  });

  // Main unified discovery feed
  app.get('/api/feed', async (_req, res) => {
    try {
      const catalog = await getAllCatalogItems();
      const userState = loadUserState();
      const config = loadPlatformConfig();
      const recommended = buildRecommendations(catalog, userState);

      const pinnedHero =
        config.heroMediaId !== 'auto'
          ? catalog.find((i) => i.id === config.heroMediaId)
          : undefined;
      const hero = pinnedHero || catalog[0];
      const trending = catalog
        .filter((i) => i.isTrending || i.popularityScore >= 86)
        .sort((a, b) => b.popularityScore - a.popularityScore)
        .slice(0, 12);

      const newReleases = catalog
        .filter((i) => i.isNewRelease)
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
        .slice(0, 12);

      const movies = catalog.filter((i) => i.type === 'movie');
      const series = catalog.filter((i) => i.type === 'series');

      const platformSet = new Set<PlatformSource>();
      const genreSet = new Set<string>();
      for (const item of catalog) {
        platformSet.add(item.platform);
        for (const g of item.genres) genreSet.add(g);
      }

      const payload: FeedResponse = {
        hero,
        trending,
        newReleases,
        recommended,
        movies,
        series,
        platforms: Array.from(platformSet),
        genres: Array.from(genreSet).sort(),
      };

      res.json(payload);
    } catch (error) {
      console.error('Feed error:', error);
      res.status(500).json({ error: 'Unable to load streaming feed' });
    }
  });

  // Simultaneous multi-service search (Curated + TVMaze + Internet Archive + Magnet URI)
  app.get('/api/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) {
        res.json({ results: [] });
        return;
      }
      const results = await unifiedSearch(q);
      res.json({ results });
    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // Detailed metadata + episodes endpoint
  app.get('/api/media/:id', async (req, res) => {
    try {
      const item = await findMediaById(req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Title not found' });
        return;
      }
      res.json(item);
    } catch (error) {
      console.error('Media detail error:', error);
      res.status(500).json({ error: 'Unable to fetch title details' });
    }
  });

  // Bandwidth-aware & seed-aware automatic stream resolution (zero user config)
  app.post('/api/resolve-stream', async (req, res) => {
    try {
      const { mediaId, episodeId, downlinkMbps, customMedia } = req.body as {
        mediaId: string;
        episodeId?: string;
        downlinkMbps?: number;
        customMedia?: {
          title?: string;
          sources?: Array<{
            id: string;
            label: string;
            resolution: '2160p' | '1080p' | '720p' | '480p';
            bitrateMbps: number;
            seeders: number;
            leechers: number;
            webSeedUrl: string;
            magnetUri: string;
            infoHash: string;
          }>;
        };
      };

      let item = await findMediaById(mediaId);
      if (!item && customMedia?.sources?.length) {
        item = {
          id: mediaId,
          title: customMedia.title || 'Stream',
          type: 'movie',
          year: 2026,
          runtimeMinutes: 90,
          rating: 8.0,
          genres: ['Cinema'],
          platform: 'Magnet Index',
          synopsis: '',
          directorOrCreator: '',
          cast: [],
          posterUrl: '/src/assets/images/poster_orbital_drift_1795043578495.jpg',
          releaseDate: '2026-01-01',
          popularityScore: 80,
          playable: true,
          sources: customMedia.sources,
        };
      }

      if (!item) {
        res.status(404).json({ error: 'Title not found' });
        return;
      }

      let candidateSources = [...(item.sources || [])];
      let playbackTitle = item.title;
      let durationHintSeconds = item.runtimeMinutes * 60;
      let targetEpisode: EpisodeItem | undefined;

      if (item.archiveIdentifier && candidateSources.length === 0) {
        candidateSources = await scrapeArchiveMetadata(item.archiveIdentifier);
      }

      if (episodeId && item.episodes?.length) {
        const ep = item.episodes.find((e) => e.id === episodeId);
        if (ep) {
          targetEpisode = ep;
          playbackTitle = `${item.title} · S${ep.season} E${ep.number}: ${ep.title}`;
          durationHintSeconds = ep.runtimeMinutes * 60;
          if (ep.sources && ep.sources.length > 0) {
            candidateSources = [...ep.sources];
          }
        }
      }

      // Query any connected Stremio-compatible stream add-ons in parallel
      const userState = loadUserState();
      if (userState.addons.length > 0) {
        const addonSources = await queryConnectedAddons({
          addons: userState.addons,
          item,
          episode: targetEpisode,
        });
        if (addonSources.length > 0) {
          candidateSources = [...addonSources, ...candidateSources];
        }
      }

      if (candidateSources.length === 0) {
        res.status(404).json({ error: 'No playable sources available' });
        return;
      }

      const resolved = await selectOptimalStream({
        mediaId: item.id,
        episodeId,
        title: playbackTitle,
        sources: candidateSources,
        downlinkMbps: Number(downlinkMbps) || 12,
        durationHintSeconds,
      });

      res.json(resolved);
    } catch (error) {
      console.error('Stream resolve error:', error);
      res.status(500).json({ error: 'Stream resolution failed' });
    }
  });

  // Real-time BitTorrent P2P-to-HTTP Range streaming for infoHash + fileIdx sources
  app.get('/api/torrent-stream/:infoHash/:fileIdx', async (req, res) => {
    const infoHash = req.params.infoHash.trim();
    if (!/^[a-f0-9]{40}$/i.test(infoHash)) {
      res.status(400).json({ error: 'Invalid BitTorrent infoHash' });
      return;
    }

    const rawIdx = req.params.fileIdx;
    const fileIdx = rawIdx === 'auto' ? undefined : Number(rawIdx);
    const trackersRaw = req.query.tr;
    const trackers = Array.isArray(trackersRaw)
      ? trackersRaw.map(String)
      : typeof trackersRaw === 'string'
        ? [trackersRaw]
        : [];

    try {
      const { file, mimeType } = await resolveTorrentFile({
        infoHash,
        fileIdx: Number.isFinite(fileIdx) ? fileIdx : undefined,
        trackers,
      });

      const fileSize = file.length;
      const rangeHeader = req.headers.range;

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', mimeType);

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(fileSize - 1, start + 4 * 1024 * 1024);

        if (Number.isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', String(chunkSize));

        const stream = file.createReadStream({ start, end });
        stream.on('error', () => {
          if (!res.headersSent) res.status(502).end();
          else res.end();
        });
        req.on('close', () => {
          stream.destroy();
        });
        stream.pipe(res);
      } else {
        res.status(200);
        res.setHeader('Content-Length', String(fileSize));
        const stream = file.createReadStream();
        stream.on('error', () => {
          if (!res.headersSent) res.status(502).end();
          else res.end();
        });
        req.on('close', () => {
          stream.destroy();
        });
        stream.pipe(res);
      }
    } catch (error) {
      console.error('Torrent stream error:', error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Unable to connect to swarm peers for this torrent' });
      }
    }
  });

  // Built-in Stremio-compatible add-on manifest & stream endpoints (Open Cinema + Internet Archive)
  app.get('/stremio/manifest.json', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(buildLocalStremioManifest());
  });

  app.get('/stremio/stream/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const rawId = decodeURIComponent(req.params.id);
    try {
      const catalog = await getAllCatalogItems();
      const baseImdb = rawId.split(':')[0];
      const match = catalog.find(
        (item) =>
          item.id === rawId ||
          item.imdbId === baseImdb ||
          (item.archiveIdentifier && `ia:${item.archiveIdentifier}` === rawId),
      );

      if (!match) {
        res.json({ streams: [] });
        return;
      }

      const sources =
        match.archiveIdentifier && match.sources.length === 0
          ? await scrapeArchiveMetadata(match.archiveIdentifier)
          : match.sources;

      const streams = sources.map((s) => {
        let externalUrl: string | undefined;
        if (s.webSeedUrl.startsWith('http')) {
          externalUrl = s.webSeedUrl;
        } else if (s.webSeedUrl.startsWith('/api/proxy-stream?url=')) {
          externalUrl = decodeURIComponent(s.webSeedUrl.slice('/api/proxy-stream?url='.length));
        }
        return {
          name: `KinoStream\n${s.resolution}`,
          title: `${match.title} · ${s.label}\n👤 ${s.seeders}`,
          infoHash: /^[a-f0-9]{40}$/i.test(s.infoHash) ? s.infoHash : undefined,
          url: externalUrl,
          behaviorHints: {
            videoSize: s.sizeBytes,
          },
        };
      });

      res.json({ streams });
    } catch {
      res.json({ streams: [] });
    }
  });

  // Safe HTTP Range proxy for decentralized Archive / WebSeed & registered Add-on streams
  app.get('/api/proxy-stream', async (req, res) => {
    const targetUrl = String(req.query.url || '');
    const registeredRelay = targetUrl ? getRegisteredStreamRelay(targetUrl) : null;
    if (!targetUrl || (!isAllowedStreamHost(targetUrl) && !registeredRelay)) {
      res.status(400).json({ error: 'Invalid stream source' });
      return;
    }

    try {
      const headers: Record<string, string> = {
        ...(registeredRelay?.headers || {}),
      };
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(targetUrl, { headers });
      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).end();
        return;
      }

      res.status(upstream.status);
      const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      for (const h of forwardHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      if (!upstream.headers.get('accept-ranges')) {
        res.setHeader('Accept-Ranges', 'bytes');
      }

      if (upstream.body) {
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      console.error('Proxy stream error:', error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream relay error' });
      }
    }
  });

  // User watchlist, history, preferences & notifications
  app.get('/api/user-state', (_req, res) => {
    res.json(loadUserState());
  });

  app.post('/api/watchlist/toggle', async (req, res) => {
    try {
      const { item } = req.body as { item?: Parameters<typeof toggleWatchlist>[0] };
      if (!item || !item.id) {
        res.status(400).json({ error: 'Missing item payload' });
        return;
      }
      const next = toggleWatchlist(item);
      const catalog = await getAllCatalogItems();
      res.json({
        userState: next,
        recommended: buildRecommendations(catalog, next),
      });
    } catch (error) {
      console.error('Watchlist toggle error:', error);
      res.status(500).json({ error: 'Failed to update watchlist' });
    }
  });

  app.post('/api/watchlist/notify', (req, res) => {
    const { mediaId } = req.body as { mediaId?: string };
    if (!mediaId) {
      res.status(400).json({ error: 'Missing mediaId' });
      return;
    }
    res.json({ userState: toggleWatchlistNotify(mediaId) });
  });

  app.post('/api/history', async (req, res) => {
    try {
      const entry = req.body;
      if (!entry?.mediaId) {
        res.status(400).json({ error: 'Missing mediaId' });
        return;
      }
      const next = recordWatchProgress(entry);
      const catalog = await getAllCatalogItems();
      res.json({
        userState: next,
        recommended: buildRecommendations(catalog, next),
      });
    } catch (error) {
      console.error('History error:', error);
      res.status(500).json({ error: 'Failed to record playback history' });
    }
  });

  app.post('/api/preferences', async (req, res) => {
    try {
      const { genres } = req.body as { genres?: string[] };
      const next = updatePreferredGenres(Array.isArray(genres) ? genres : []);
      const catalog = await getAllCatalogItems();
      res.json({
        userState: next,
        recommended: buildRecommendations(catalog, next),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  });

  app.post('/api/notifications/read', (req, res) => {
    const { id } = req.body as { id?: string };
    res.json({ userState: markNotificationsRead(id) });
  });

  // Connect / toggle / remove Stremio-compatible stream add-ons
  app.post('/api/addons/connect', async (req, res) => {
    try {
      const { manifestUrl } = req.body as { manifestUrl?: string };
      if (!manifestUrl || !manifestUrl.trim()) {
        res.status(400).json({ error: 'Missing manifest URL' });
        return;
      }
      const entry = await fetchAddonManifest(manifestUrl);
      const userState = upsertAddonProvider(entry);
      clearCatalogCache();
      res.json({ addon: entry, userState });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to connect add-on manifest';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/addons/toggle', (req, res) => {
    const { addonId } = req.body as { addonId?: string };
    if (!addonId) {
      res.status(400).json({ error: 'Missing addonId' });
      return;
    }
    const userState = toggleAddonProvider(addonId);
    clearCatalogCache();
    res.json({ userState });
  });

  app.delete('/api/addons/:id', (req, res) => {
    const userState = removeAddonProvider(req.params.id);
    clearCatalogCache();
    res.json({ userState });
  });

  // Admin Console API routes
  app.get('/api/admin/overview', async (_req, res) => {
    try {
      const config = loadPlatformConfig();
      const userState = loadUserState();
      const catalog = await getRawMergedCatalog();
      const swarms = listActiveSwarms();
      const payload: AdminOverviewResponse = {
        config,
        addons: userState.addons,
        catalog,
        swarms,
        stats: {
          totalTitles: catalog.length,
          enabledAddons: userState.addons.filter((a) => a.enabled).length,
          watchlistCount: userState.watchlist.length,
          activeSwarms: swarms.length,
        },
      };
      res.json(payload);
    } catch (error) {
      console.error('Admin overview error:', error);
      res.status(500).json({ error: 'Failed to load admin overview' });
    }
  });

  app.post('/api/admin/config', (req, res) => {
    try {
      const updated = updatePlatformConfig(req.body || {});
      res.json({ config: updated });
    } catch {
      res.status(400).json({ error: 'Invalid configuration payload' });
    }
  });

  app.post('/api/admin/catalog/visibility', (req, res) => {
    const { mediaId } = req.body as { mediaId?: string };
    if (!mediaId) {
      res.status(400).json({ error: 'Missing mediaId' });
      return;
    }
    res.json({ config: toggleMediaVisibility(mediaId) });
  });

  app.post('/api/admin/catalog/custom', (req, res) => {
    try {
      const body = req.body as {
        title?: string;
        type?: 'movie' | 'series';
        year?: number;
        genres?: string[];
        platform?: PlatformSource;
        synopsis?: string;
        posterUrl?: string;
        streamOrMagnetUrl?: string;
      };
      if (!body.title?.trim() || !body.streamOrMagnetUrl?.trim()) {
        res.status(400).json({ error: 'Title and stream or magnet URL are required' });
        return;
      }
      const result = addCustomCatalogItem({
        title: body.title,
        type: body.type === 'series' ? 'series' : 'movie',
        year: Number(body.year) || new Date().getFullYear(),
        genres: Array.isArray(body.genres) ? body.genres : ['Drama'],
        platform: body.platform || 'Open Cinema',
        synopsis: body.synopsis || '',
        posterUrl: body.posterUrl,
        streamOrMagnetUrl: body.streamOrMagnetUrl,
      });
      res.json(result);
    } catch {
      res.status(400).json({ error: 'Failed to publish custom title' });
    }
  });

  app.delete('/api/admin/catalog/custom/:id', (req, res) => {
    res.json({ config: deleteCustomCatalogItem(req.params.id) });
  });

  app.post('/api/admin/addons/test', async (req, res) => {
    const { manifestUrl } = req.body as { manifestUrl?: string };
    if (!manifestUrl) {
      res.status(400).json({ error: 'Missing manifestUrl' });
      return;
    }
    const result = await probeAddonHealth(manifestUrl);
    res.json(result);
  });

  app.post('/api/admin/swarms/evict', (req, res) => {
    const { infoHash } = req.body as { infoHash?: string };
    if (!infoHash) {
      res.status(400).json({ error: 'Missing infoHash' });
      return;
    }
    res.json({ evicted: evictSwarm(infoHash), swarms: listActiveSwarms() });
  });

  app.post('/api/admin/cache/clear', (_req, res) => {
    clearCatalogCache();
    clearStreamProbeCache();
    res.json({ cleared: true });
  });

  // Vite integration for dev, static dist for prod
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KinoStream server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
