export type MediaType = 'movie' | 'series';

export type PlatformSource =
  | 'Open Cinema'
  | 'Internet Archive'
  | 'Netflix'
  | 'Hulu'
  | 'Max'
  | 'Apple TV+'
  | 'Prime Video'
  | 'Magnet Index';

export interface StreamSource {
  id: string;
  label: string;
  resolution: '2160p' | '1080p' | '720p' | '480p';
  bitrateMbps: number;
  seeders: number;
  leechers: number;
  webSeedUrl: string;
  magnetUri: string;
  infoHash: string;
  fileIdx?: number;
  trackers?: string[];
  sizeBytes?: number;
  verified?: boolean;
  notWebReady?: boolean;
  proxyHeaders?: Record<string, string>;
  fromAddon?: boolean;
  addonName?: string;
  isFallback?: boolean;
}

export interface EpisodeItem {
  id: string;
  season: number;
  number: number;
  title: string;
  airDate: string;
  runtimeMinutes: number;
  summary: string;
  stillUrl?: string;
  sources?: StreamSource[];
}

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  year: number;
  runtimeMinutes: number;
  rating: number;
  genres: string[];
  platform: PlatformSource;
  otherPlatforms?: PlatformSource[];
  synopsis: string;
  directorOrCreator: string;
  cast: string[];
  posterUrl: string;
  backdropUrl?: string;
  accentColor?: string;
  releaseDate: string;
  isNewRelease?: boolean;
  isTrending?: boolean;
  popularityScore: number;
  playable: boolean;
  archiveIdentifier?: string;
  tvmazeId?: number;
  imdbId?: string;
  addonMetaId?: string;
  addonId?: string;
  sources: StreamSource[];
  episodes?: EpisodeItem[];
  recommendationReason?: string;
}

export interface StremioCatalogDef {
  type: string;
  id: string;
  name?: string;
  supportsSearch?: boolean;
}

export interface AddonProviderEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  manifestUrl: string;
  baseUrl: string;
  types: string[];
  resources: string[];
  idPrefixes?: string[];
  catalogs?: StremioCatalogDef[];
  enabled: boolean;
  addedAt: string;
}

export interface WatchlistEntry {
  mediaId: string;
  title: string;
  type: MediaType;
  genres: string[];
  platform: PlatformSource;
  posterUrl: string;
  year: number;
  addedAt: string;
  notifyNewReleases: boolean;
  latestKnownDate: string;
}

export interface WatchHistoryEntry {
  mediaId: string;
  episodeId?: string;
  title: string;
  genres: string[];
  platform: PlatformSource;
  posterUrl: string;
  progressSeconds: number;
  durationSeconds: number;
  completed: boolean;
  lastWatchedAt: string;
}

export interface ReleaseNotification {
  id: string;
  mediaId: string;
  title: string;
  platform: PlatformSource;
  posterUrl: string;
  headline: string;
  detail: string;
  releaseDate: string;
  read: boolean;
}

export interface UserState {
  watchlist: WatchlistEntry[];
  history: WatchHistoryEntry[];
  preferredGenres: string[];
  notifications: ReleaseNotification[];
  addons: AddonProviderEntry[];
}

export interface ResolvedPlayback {
  mediaId: string;
  episodeId?: string;
  title: string;
  streamUrl: string;
  fallbackUrls: string[];
  selectedResolution: string;
  estimatedStartMs: number;
  durationHintSeconds?: number;
}

export interface FeedResponse {
  hero: MediaItem;
  trending: MediaItem[];
  newReleases: MediaItem[];
  recommended: MediaItem[];
  movies: MediaItem[];
  series: MediaItem[];
  platforms: PlatformSource[];
  genres: string[];
}

export interface PlatformConfig {
  heroMediaId: string | 'auto';
  tvmazeFeedEnabled: boolean;
  internetArchiveSearchEnabled: boolean;
  openCinemaCatalogEnabled: boolean;
  maxResolutionCap: '2160p' | '1080p' | '720p' | '480p';
  bandwidthHeadroomFactor: number;
  preferWebReadyStreams: boolean;
  p2pMaxConnections: number;
  hiddenMediaIds: string[];
  customItems: MediaItem[];
  customTrackers: string[];
}

export interface ActiveSwarmInfo {
  infoHash: string;
  fileName: string;
  peers: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeedBps: number;
  lastUsedAt: string;
}

export interface AdminOverviewResponse {
  config: PlatformConfig;
  addons: AddonProviderEntry[];
  catalog: MediaItem[];
  swarms: ActiveSwarmInfo[];
  stats: {
    totalTitles: number;
    enabledAddons: number;
    watchlistCount: number;
    activeSwarms: number;
  };
}

