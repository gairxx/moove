import os from 'os';
import path from 'path';
import torrentStream from 'torrent-stream';
import type { ActiveSwarmInfo } from '../types.ts';
import { loadPlatformConfig } from './adminStore.ts';

type EngineInstance = TorrentStream.TorrentEngine;
type EngineFile = TorrentStream.TorrentFile;

const CACHE_DIR = path.join(os.tmpdir(), 'kinostream-torrents');

interface ManagedEngine {
  engine: EngineInstance;
  ready: boolean;
  lastUsed: number;
  selectedFileName?: string;
  selectedFileLength?: number;
}

const engines = new Map<string, ManagedEngine>();

// Periodically evict idle engines (>10 min unused) to keep disk and sockets bounded
setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of engines.entries()) {
    if (now - entry.lastUsed > 10 * 60 * 1000) {
      try {
        entry.engine.remove(false, () => {
          entry.engine.destroy(() => {});
        });
      } catch {
        // Ignore cleanup errors
      }
      engines.delete(hash);
    }
  }
}, 120_000).unref();

const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mkv|mov|avi)$/i;

function pickVideoFile(files: EngineFile[], fileIdx?: number): EngineFile | null {
  if (!files || files.length === 0) return null;

  if (typeof fileIdx === 'number' && files[fileIdx]) {
    return files[fileIdx];
  }

  const videoFiles = files
    .filter((f) => VIDEO_EXT_RE.test(f.name))
    .sort((a, b) => b.length - a.length);

  return videoFiles[0] || files.slice().sort((a, b) => b.length - a.length)[0] || null;
}

function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  return 'application/octet-stream';
}

export async function resolveTorrentFile(params: {
  infoHash: string;
  fileIdx?: number;
  trackers?: string[];
}): Promise<{ file: EngineFile; mimeType: string; seedersHint: number }> {
  const config = loadPlatformConfig();
  const hash = params.infoHash.toLowerCase();
  const combinedTrackers = [...(params.trackers || []), ...(config.customTrackers || [])]
    .filter((t, idx, arr) => t && arr.indexOf(t) === idx)
    .slice(0, 10);
  const trackerSuffix = combinedTrackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  const magnetUri = `magnet:?xt=urn:btih:${hash}${trackerSuffix}`;

  let managed = engines.get(hash);
  if (!managed) {
    const engine = torrentStream(magnetUri, {
      tmp: CACHE_DIR,
      connections: Math.max(10, Math.min(150, config.p2pMaxConnections || 55)),
      uploads: 4,
      verify: false,
      trackers: combinedTrackers,
    });
    (engine as unknown as NodeJS.EventEmitter).on('error', () => {
      // Prevent unhandled error crashes; readiness timeout handles recovery
    });
    managed = { engine, ready: false, lastUsed: Date.now() };
    engines.set(hash, managed);
  } else {
    managed.lastUsed = Date.now();
  }

  const current = managed;
  try {
    await new Promise<void>((resolve, reject) => {
      if (current.ready && current.engine.files.length > 0) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for torrent metadata'));
      }, 25_000);

      (current.engine as unknown as NodeJS.EventEmitter).once('ready', () => {
        clearTimeout(timeout);
        current.ready = true;
        resolve();
      });
    });
  } catch (err) {
    if (!current.ready) {
      evictSwarm(hash);
    }
    throw err;
  }

  const file = pickVideoFile(current.engine.files, params.fileIdx);
  if (!file) {
    throw new Error('No playable video file found in torrent');
  }

  current.selectedFileName = file.name;
  current.selectedFileLength = file.length;

  // Prioritize sequential downloading for the requested file
  for (const f of current.engine.files) {
    if (f !== file) f.deselect();
  }
  file.select();

  return {
    file,
    mimeType: getMimeType(file.name),
    seedersHint: (current.engine.swarm as unknown as { wires?: unknown[] })?.wires?.length || 1,
  };
}

export function listActiveSwarms(): ActiveSwarmInfo[] {
  const list: ActiveSwarmInfo[] = [];
  for (const [infoHash, entry] of engines.entries()) {
    const swarm = entry.engine.swarm as unknown as {
      wires?: unknown[];
      downloaded?: number;
      downloadSpeed?: () => number;
    };
    list.push({
      infoHash,
      fileName: entry.selectedFileName || 'Resolving metadata...',
      peers: swarm?.wires?.length || 0,
      downloadedBytes: swarm?.downloaded || 0,
      totalBytes: entry.selectedFileLength || 0,
      downloadSpeedBps: typeof swarm?.downloadSpeed === 'function' ? swarm.downloadSpeed() : 0,
      lastUsedAt: new Date(entry.lastUsed).toISOString(),
    });
  }
  return list;
}

export function evictSwarm(infoHash: string): boolean {
  const hash = infoHash.toLowerCase();
  const entry = engines.get(hash);
  if (!entry) return false;
  try {
    entry.engine.remove(false, () => {
      entry.engine.destroy(() => {});
    });
  } catch {
    // Ignore
  }
  engines.delete(hash);
  return true;
}
