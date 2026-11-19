import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Link2,
  Pin,
  Plus,
  Power,
  RefreshCw,
  Search,
  Server,
  Sliders,
  Trash2,
} from 'lucide-react';
import type {
  AddonProviderEntry,
  AdminOverviewResponse,
  PlatformConfig,
  PlatformSource,
} from '../types.ts';

type AdminSection = 'controls' | 'addons' | 'catalog' | 'swarms';

interface AdminPanelProps {
  onCatalogChanged: () => void;
  onUserStateChanged: () => void;
}

interface AddonProbeStatus {
  loading: boolean;
  ok?: boolean;
  latencyMs?: number;
  detail?: string;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function AdminPanel({ onCatalogChanged, onUserStateChanged }: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>('addons');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Add-on installer state
  const [manifestInput, setManifestInput] = useState('');
  const [installingAddon, setInstallingAddon] = useState(false);
  const [addonProbes, setAddonProbes] = useState<Record<string, AddonProbeStatus>>({});

  // Catalog filter & publisher state
  const [catalogFilter, setCatalogFilter] = useState('');
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [pubTitle, setPubTitle] = useState('');
  const [pubType, setPubType] = useState<'movie' | 'series'>('movie');
  const [pubYear, setPubYear] = useState(String(new Date().getFullYear()));
  const [pubGenres, setPubGenres] = useState('Sci-Fi, Thriller');
  const [pubPlatform, setPubPlatform] = useState<PlatformSource>('Open Cinema');
  const [pubStreamUrl, setPubStreamUrl] = useState('');
  const [pubPosterUrl, setPubPosterUrl] = useState('');
  const [pubSynopsis, setPubSynopsis] = useState('');

  // Custom trackers editor
  const [trackersDraft, setTrackersDraft] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview');
      if (!res.ok) throw new Error('Unable to load admin overview');
      const data = (await res.json()) as AdminOverviewResponse;
      setOverview(data);
      setTrackersDraft((data.config.customTrackers || []).join('\n'));
    } catch {
      setFeedback('Failed to load platform administration state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const patchConfig = async (patch: Partial<PlatformConfig>, successNote?: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        await loadOverview();
        onCatalogChanged();
        if (successNote) setFeedback(successNote);
      }
    } catch {
      setFeedback('Unable to save platform settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleInstallAddon = async (urlToInstall: string) => {
    const trimmed = urlToInstall.trim();
    if (!trimmed) return;
    setInstallingAddon(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/addons/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: trimmed }),
      });
      const data = (await res.json()) as { addon?: AddonProviderEntry; error?: string };
      if (!res.ok) {
        setFeedback(data.error || 'Failed to install add-on manifest.');
      } else {
        setManifestInput('');
        setFeedback(`Installed add-on "${data.addon?.name || 'Provider'}".`);
        await loadOverview();
        onUserStateChanged();
        onCatalogChanged();
      }
    } catch {
      setFeedback('Network error while installing add-on.');
    } finally {
      setInstallingAddon(false);
    }
  };

  const handleToggleAddon = async (addonId: string) => {
    await fetch('/api/addons/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addonId }),
    });
    await loadOverview();
    onUserStateChanged();
    onCatalogChanged();
  };

  const handleUninstallAddon = async (addonId: string) => {
    await fetch(`/api/addons/${encodeURIComponent(addonId)}`, { method: 'DELETE' });
    await loadOverview();
    onUserStateChanged();
    onCatalogChanged();
  };

  const handleTestAddon = async (addon: AddonProviderEntry) => {
    setAddonProbes((prev) => ({ ...prev, [addon.id]: { loading: true } }));
    try {
      const res = await fetch('/api/admin/addons/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: addon.manifestUrl }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        latencyMs: number;
        detail?: string;
        error?: string;
      };
      setAddonProbes((prev) => ({
        ...prev,
        [addon.id]: {
          loading: false,
          ok: data.ok,
          latencyMs: data.latencyMs,
          detail: data.detail,
          error: data.error,
        },
      }));
    } catch {
      setAddonProbes((prev) => ({
        ...prev,
        [addon.id]: { loading: false, ok: false, error: 'Request failed' },
      }));
    }
  };

  const handleToggleVisibility = async (mediaId: string) => {
    await fetch('/api/admin/catalog/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId }),
    });
    await loadOverview();
    onCatalogChanged();
  };

  const handlePublishCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pubTitle.trim() || !pubStreamUrl.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/catalog/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pubTitle,
          type: pubType,
          year: Number(pubYear) || new Date().getFullYear(),
          genres: pubGenres.split(',').map((s) => s.trim()).filter(Boolean),
          platform: pubPlatform,
          posterUrl: pubPosterUrl,
          synopsis: pubSynopsis,
          streamOrMagnetUrl: pubStreamUrl,
        }),
      });
      if (res.ok) {
        setPubTitle('');
        setPubStreamUrl('');
        setPubPosterUrl('');
        setPubSynopsis('');
        setShowPublishForm(false);
        setFeedback('Custom title published to catalog.');
        await loadOverview();
        onCatalogChanged();
      } else {
        const err = (await res.json()) as { error?: string };
        setFeedback(err.error || 'Unable to publish custom title.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustom = async (mediaId: string) => {
    await fetch(`/api/admin/catalog/custom/${encodeURIComponent(mediaId)}`, {
      method: 'DELETE',
    });
    await loadOverview();
    onCatalogChanged();
  };

  const handleEvictSwarm = async (infoHash: string) => {
    await fetch('/api/admin/swarms/evict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ infoHash }),
    });
    await loadOverview();
  };

  const handleClearCaches = async () => {
    await fetch('/api/admin/cache/clear', { method: 'POST' });
    setFeedback('Catalog and stream health caches cleared.');
    await loadOverview();
    onCatalogChanged();
  };

  const filteredCatalog = useMemo(() => {
    const items = overview?.catalog || [];
    const q = catalogFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.platform.toLowerCase().includes(q) ||
        i.genres.some((g) => g.toLowerCase().includes(q)),
    );
  }, [overview, catalogFilter]);

  const sectionTitleMap: Record<AdminSection, string> = {
    addons: 'Add-ons & Stream Providers',
    controls: 'Platform & Playback Policy',
    catalog: 'Catalog Manager',
    swarms: 'Swarms & Cache',
  };

  if (loading && !overview) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-[#13151C]" />
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[#13151C]" />
          ))}
        </div>
      </div>
    );
  }

  const config = overview?.config;
  const hiddenSet = new Set(config?.hiddenMediaIds || []);
  const builtInManifestUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/stremio/manifest.json` : '/stremio/manifest.json';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10">
      {/* Top Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs text-zinc-400">
            Admin <span aria-hidden="true">/</span>{' '}
            <span className="text-zinc-200">{sectionTitleMap[section]}</span>
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-white">
            Platform Control Console
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadOverview}
            className="flex min-h-[40px] items-center gap-2 rounded-lg border border-white/10 bg-[#13151C] px-3.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleClearCaches}
            className="flex min-h-[40px] items-center gap-2 rounded-lg bg-[#E11D48] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C] whitespace-nowrap shrink-0"
          >
            <Database className="h-3.5 w-3.5" />
            <span>Flush Caches</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
          <p className="text-xs text-zinc-400">Indexed Titles</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">
            {overview?.stats.totalTitles ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
          <p className="text-xs text-zinc-400">Active Add-ons</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">
            {overview?.stats.enabledAddons ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
          <p className="text-xs text-zinc-400">Watchlist Saves</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">
            {overview?.stats.watchlistCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
          <p className="text-xs text-zinc-400">Active P2P Swarms</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">
            {overview?.stats.activeSwarms ?? 0}
          </p>
        </div>
      </div>

      {feedback && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-[#161922] px-4 py-3 text-xs text-zinc-100">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-zinc-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace Layout: Sidebar + Main Console */}
      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Sidebar Navigation (Desktop) & Segmented Tabs (Mobile/Tablet) */}
        <aside className="lg:w-60 lg:shrink-0">
          <nav
            aria-label="Admin sections"
            className="no-scrollbar flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1"
          >
            {(
              [
                { id: 'addons', label: 'Add-on Installer', icon: Link2 },
                { id: 'controls', label: 'Platform Controls', icon: Sliders },
                { id: 'catalog', label: 'Catalog Manager', icon: Server },
                { id: 'swarms', label: 'Swarms & Cache', icon: Activity },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = section === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSection(tab.id)}
                  className={`flex min-h-[42px] items-center gap-2.5 rounded-xl px-3.5 py-2 text-left text-xs font-medium whitespace-nowrap shrink-0 transition-colors sm:text-sm ${
                    active
                      ? 'bg-white/10 text-white ring-1 ring-white/15'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? 'text-[#E11D48]' : 'text-zinc-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Console Surface */}
        <div className="min-w-0 flex-1 space-y-6">
          {/* SECTION 1: ADD-ON INSTALLER */}
          {section === 'addons' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-[#111319] p-5 sm:p-6">
                <h2 className="font-display text-lg font-semibold text-white">
                  Install Stremio-Compatible Add-on
                </h2>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  Enter any compatible <code className="text-zinc-200">manifest.json</code> or{' '}
                  <code className="text-zinc-200">stremio://</code> URL. Installed stream providers are automatically queried in parallel during playback resolution.
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleInstallAddon(manifestInput);
                  }}
                  className="mt-4 flex flex-col gap-2.5 sm:flex-row"
                >
                  <input
                    type="text"
                    value={manifestInput}
                    onChange={(e) => setManifestInput(e.target.value)}
                    placeholder="https://example.com/manifest.json or stremio://..."
                    aria-label="Add-on manifest URL"
                    className="h-11 flex-1 rounded-xl border border-white/10 bg-[#161922] px-4 text-sm text-white placeholder:text-zinc-500 focus:border-[#E11D48] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={installingAddon || !manifestInput.trim()}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#E11D48] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C] disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{installingAddon ? 'Installing...' : 'Install Add-on'}</span>
                  </button>
                </form>

                {/* Quick-Install Verified Open Catalog Presets */}
                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-xs font-medium text-zinc-300">
                    Quick-Install Open Protocol Presets
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleInstallAddon('https://v3-cinemeta.strem.io/manifest.json')}
                      disabled={installingAddon}
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#161922] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                    >
                      <Plus className="h-3.5 w-3.5 text-[#E11D48]" />
                      <span>Cinemeta Open Metadata</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInstallAddon(builtInManifestUrl)}
                      disabled={installingAddon}
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#161922] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                    >
                      <Plus className="h-3.5 w-3.5 text-[#E11D48]" />
                      <span>KinoStream Open Cinema</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Installed Add-ons Table */}
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111319]">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <h3 className="font-display text-base font-semibold text-white">
                    Installed Add-ons ({overview?.addons.length || 0})
                  </h3>
                </div>

                {(overview?.addons || []).length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-zinc-400">
                    No external add-ons installed yet. Built-in Open Cinema, Internet Archive, and TVMaze feeds are active by default.
                  </div>
                ) : (
                  <div className="divide-y divide-white/10">
                    {(overview?.addons || []).map((addon) => {
                      const probe = addonProbes[addon.id];
                      return (
                        <div
                          key={addon.id}
                          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                              <span className="font-display text-sm font-semibold text-white">
                                {addon.name}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-zinc-400">
                                v{addon.version}
                              </span>
                              <span
                                className={`text-xs font-medium ${
                                  addon.enabled ? 'text-emerald-400' : 'text-zinc-500'
                                }`}
                              >
                                {addon.enabled ? 'Active' : 'Disabled'}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">
                              {addon.resources.join(', ')} · {addon.types.join(' / ')} · {addon.manifestUrl}
                            </p>
                            {probe && !probe.loading && (
                              <p
                                className={`mt-1 font-mono text-xs tabular-nums ${
                                  probe.ok ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {probe.ok
                                  ? `Reachable (${probe.latencyMs} ms)${probe.detail ? ` · ${probe.detail}` : ''}`
                                  : `Unreachable: ${probe.error || 'Error'}`}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleTestAddon(addon)}
                              disabled={probe?.loading}
                              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#161922] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{probe?.loading ? 'Testing...' : 'Test'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleAddon(addon.id)}
                              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#161922] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                            >
                              <Power className="h-3.5 w-3.5" />
                              <span>{addon.enabled ? 'Disable' : 'Enable'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUninstallAddon(addon.id)}
                              aria-label={`Uninstall ${addon.name}`}
                              className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 2: PLATFORM & PLAYBACK POLICY */}
          {section === 'controls' && config && (
            <div className="space-y-6">
              {/* Feed Sources & Hero Spotlight */}
              <div className="rounded-2xl border border-white/10 bg-[#111319] p-5 sm:p-6">
                <h2 className="font-display text-lg font-semibold text-white">
                  Discovery Feeds & Featured Spotlight
                </h2>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  Control which catalog indexes populate the home feed and unified search results.
                </p>

                <div className="mt-5 divide-y divide-white/10 border-t border-white/10">
                  {(
                    [
                      {
                        key: 'openCinemaCatalogEnabled',
                        title: 'Open Cinema Catalog',
                        desc: 'Curated open-licensed feature films and original spotlight titles.',
                      },
                      {
                        key: 'tvmazeFeedEnabled',
                        title: 'Multi-Platform Series Index (TVMaze)',
                        desc: 'Live trending shows and episode air dates across major networks.',
                      },
                      {
                        key: 'internetArchiveSearchEnabled',
                        title: 'Internet Archive Decentralized Search',
                        desc: 'On-demand scraping of public-domain movies and torrent webseeds.',
                      },
                    ] as const
                  ).map((row) => {
                    const enabled = config[row.key];
                    return (
                      <div
                        key={row.key}
                        className="flex items-center justify-between gap-4 py-4"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{row.title}</p>
                          <p className="text-xs text-zinc-400">{row.desc}</p>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            patchConfig({ [row.key]: !enabled }, `${row.title} ${!enabled ? 'enabled' : 'disabled'}.`)
                          }
                          className={`min-h-[38px] rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            enabled
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                              : 'border-white/10 bg-[#161922] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <label
                    htmlFor="hero-select"
                    className="block text-sm font-medium text-white"
                  >
                    Pinned Hero Spotlight
                  </label>
                  <select
                    id="hero-select"
                    value={config.heroMediaId}
                    onChange={(e) =>
                      patchConfig({ heroMediaId: e.target.value }, 'Hero spotlight updated.')
                    }
                    className="mt-2 h-11 w-full max-w-md rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-white focus:border-[#E11D48] focus:outline-none"
                  >
                    <option value="auto">Automatic (Top Featured)</option>
                    {(overview?.catalog || []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} ({item.platform})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Bandwidth & Seed Auto-Selection Policy */}
              <div className="rounded-2xl border border-white/10 bg-[#111319] p-5 sm:p-6">
                <h2 className="font-display text-lg font-semibold text-white">
                  Auto-Selection & BitTorrent Engine Policy
                </h2>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  Governs how the automatic source selector ranks stream quality, web-readiness, and P2P connections without user configuration.
                </p>

                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="max-res-cap"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Maximum Auto-Selected Resolution
                    </label>
                    <select
                      id="max-res-cap"
                      value={config.maxResolutionCap}
                      onChange={(e) =>
                        patchConfig(
                          { maxResolutionCap: e.target.value as PlatformConfig['maxResolutionCap'] },
                          'Maximum resolution cap updated.',
                        )
                      }
                      className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-white focus:border-[#E11D48] focus:outline-none"
                    >
                      <option value="2160p">2160p (4K UHD)</option>
                      <option value="1080p">1080p (Full HD)</option>
                      <option value="720p">720p (HD)</option>
                      <option value="480p">480p (Data Saver)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="headroom-select"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Bandwidth Headroom Safety Margin
                    </label>
                    <select
                      id="headroom-select"
                      value={String(config.bandwidthHeadroomFactor)}
                      onChange={(e) =>
                        patchConfig(
                          { bandwidthHeadroomFactor: Number(e.target.value) },
                          'Bandwidth safety margin updated.',
                        )
                      }
                      className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-white focus:border-[#E11D48] focus:outline-none"
                    >
                      <option value="0.7">70% (Conservative · Zero Buffering)</option>
                      <option value="0.85">85% (Balanced Default)</option>
                      <option value="0.95">95% (Maximum Bitrate)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="p2p-conns"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Max P2P Peer Connections per Swarm
                    </label>
                    <input
                      id="p2p-conns"
                      type="number"
                      min={10}
                      max={150}
                      value={config.p2pMaxConnections}
                      onChange={(e) =>
                        patchConfig({ p2pMaxConnections: Number(e.target.value) || 55 })
                      }
                      className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 font-mono text-sm tabular-nums text-white focus:border-[#E11D48] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        patchConfig(
                          { preferWebReadyStreams: !config.preferWebReadyStreams },
                          'Web-ready container preference updated.',
                        )
                      }
                      className={`h-11 w-full rounded-xl border px-4 text-xs font-semibold transition-colors ${
                        config.preferWebReadyStreams
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-white/10 bg-[#161922] text-zinc-300'
                      }`}
                    >
                      {config.preferWebReadyStreams
                        ? 'Prefer Browser-Ready MP4 / WebM: On'
                        : 'Prefer Browser-Ready MP4 / WebM: Off'}
                    </button>
                  </div>
                </div>

                {/* Open Tracker List */}
                <div className="mt-5 border-t border-white/10 pt-4">
                  <label
                    htmlFor="custom-trackers"
                    className="block text-xs font-medium text-zinc-300"
                  >
                    Default Open Announce Trackers (one per line)
                  </label>
                  <textarea
                    id="custom-trackers"
                    rows={4}
                    value={trackersDraft}
                    onChange={(e) => setTrackersDraft(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#161922] p-3 font-mono text-xs text-zinc-200 focus:border-[#E11D48] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      patchConfig(
                        {
                          customTrackers: trackersDraft
                            .split('\n')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                        'Default tracker list saved.',
                      )
                    }
                    className="mt-2.5 min-h-[38px] rounded-lg bg-white/10 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
                  >
                    Save Tracker List
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: CATALOG MANAGER */}
          {section === 'catalog' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative min-w-[220px] flex-1 max-w-md">
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={catalogFilter}
                    onChange={(e) => setCatalogFilter(e.target.value)}
                    placeholder="Filter catalog titles..."
                    aria-label="Filter catalog titles"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#111319] pr-3 pl-10 text-sm text-white placeholder:text-zinc-500 focus:border-[#E11D48] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowPublishForm((v) => !v)}
                  className="flex min-h-[40px] items-center gap-2 rounded-xl bg-[#E11D48] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C] whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  <span>{showPublishForm ? 'Close Form' : 'Publish Title / Magnet'}</span>
                </button>
              </div>

              {showPublishForm && (
                <form
                  onSubmit={handlePublishCustom}
                  className="rounded-2xl border border-white/10 bg-[#111319] p-5 space-y-4"
                >
                  <h3 className="font-display text-base font-semibold text-white">
                    Publish Custom Title or Magnet Stream
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <input
                      type="text"
                      required
                      value={pubTitle}
                      onChange={(e) => setPubTitle(e.target.value)}
                      placeholder="Title"
                      className="h-10 rounded-lg border border-white/10 bg-[#161922] px-3 text-sm text-white sm:col-span-2"
                    />
                    <select
                      value={pubType}
                      onChange={(e) => setPubType(e.target.value as 'movie' | 'series')}
                      className="h-10 rounded-lg border border-white/10 bg-[#161922] px-3 text-sm text-white"
                    >
                      <option value="movie">Movie</option>
                      <option value="series">Series</option>
                    </select>
                    <input
                      type="number"
                      value={pubYear}
                      onChange={(e) => setPubYear(e.target.value)}
                      placeholder="Year"
                      className="h-10 rounded-lg border border-white/10 bg-[#161922] px-3 font-mono text-sm tabular-nums text-white"
                    />
                    <input
                      type="text"
                      value={pubGenres}
                      onChange={(e) => setPubGenres(e.target.value)}
                      placeholder="Genres (comma separated)"
                      className="h-10 rounded-lg border border-white/10 bg-[#161922] px-3 text-sm text-white"
                    />
                    <select
                      value={pubPlatform}
                      onChange={(e) => setPubPlatform(e.target.value as PlatformSource)}
                      className="h-10 rounded-lg border border-white/10 bg-[#161922] px-3 text-sm text-white"
                    >
                      <option value="Open Cinema">Open Cinema</option>
                      <option value="Internet Archive">Internet Archive</option>
                      <option value="Magnet Index">Magnet Index</option>
                      <option value="Netflix">Netflix</option>
                      <option value="Hulu">Hulu</option>
                      <option value="Max">Max</option>
                      <option value="Apple TV+">Apple TV+</option>
                      <option value="Prime Video">Prime Video</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    required
                    value={pubStreamUrl}
                    onChange={(e) => setPubStreamUrl(e.target.value)}
                    placeholder="Direct MP4/WebM URL or magnet:?xt=urn:btih:..."
                    className="h-10 w-full rounded-lg border border-white/10 bg-[#161922] px-3 text-sm text-white"
                  />
                  <input
                    type="text"
                    value={pubPosterUrl}
                    onChange={(e) => setPubPosterUrl(e.target.value)}
                    placeholder="Poster image URL (optional)"
                    className="h-10 w-full rounded-lg border border-white/10 bg-[#161922] px-3 text-sm text-white"
                  />
                  <textarea
                    rows={2}
                    value={pubSynopsis}
                    onChange={(e) => setPubSynopsis(e.target.value)}
                    placeholder="Synopsis (optional)"
                    className="w-full rounded-lg border border-white/10 bg-[#161922] p-3 text-sm text-white"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-[40px] rounded-lg bg-[#E11D48] px-5 py-2 text-xs font-semibold text-white hover:bg-[#BE123C]"
                  >
                    {saving ? 'Publishing...' : 'Publish to Catalog'}
                  </button>
                </form>
              )}

              {/* High-Density Catalog Table */}
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111319]">
                <table className="w-full border-collapse text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs text-zinc-400">
                      <th className="px-4 py-3 font-medium">Title</th>
                      <th className="px-4 py-3 font-medium">Platform</th>
                      <th className="px-4 py-3 text-right font-medium">Year</th>
                      <th className="px-4 py-3 text-right font-medium">Sources</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredCatalog.map((item) => {
                      const isHidden = hiddenSet.has(item.id);
                      const isHero = config?.heroMediaId === item.id;
                      const isCustom = item.id.startsWith('custom-');
                      return (
                        <tr key={item.id} className="transition-colors hover:bg-white/[0.03]">
                          <td className="px-4 py-3 font-medium text-white">
                            <span className="line-clamp-1">{item.title}</span>
                          </td>
                          <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                            {item.platform}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-400">
                            {item.year}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-400">
                            {item.sources.length}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={isHidden ? 'text-zinc-500' : 'text-emerald-400'}>
                              {isHidden ? 'Hidden' : isHero ? 'Pinned Hero' : 'Visible'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  patchConfig(
                                    { heroMediaId: isHero ? 'auto' : item.id },
                                    isHero ? 'Hero reset to automatic.' : `Pinned "${item.title}" to Hero.`,
                                  )
                                }
                                title="Pin as Hero Spotlight"
                                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                                  isHero
                                    ? 'border-[#E11D48]/50 bg-[#E11D48]/20 text-[#E11D48]'
                                    : 'border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <Pin className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleVisibility(item.id)}
                                title={isHidden ? 'Show in catalog' : 'Hide from catalog'}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                              {isCustom && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustom(item.id)}
                                  title="Delete custom title"
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTION 4: SWARMS & CACHE */}
          {section === 'swarms' && (
            <div className="space-y-5">
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111319]">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <div>
                    <h2 className="font-display text-base font-semibold text-white">
                      Active BitTorrent Swarms
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Live P2P streams currently open in the server-side torrent engine
                    </p>
                  </div>
                </div>

                {(overview?.swarms || []).length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-zinc-400">
                    No active P2P swarms running right now. Swarms start automatically when a magnet or infoHash stream is played.
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs text-zinc-400">
                        <th className="px-4 py-3 font-medium">File / InfoHash</th>
                        <th className="px-4 py-3 text-right font-medium">Peers</th>
                        <th className="px-4 py-3 text-right font-medium">Downloaded</th>
                        <th className="px-4 py-3 text-right font-medium">Speed</th>
                        <th className="px-4 py-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {(overview?.swarms || []).map((swarm) => (
                        <tr key={swarm.infoHash}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-white line-clamp-1">{swarm.fileName}</p>
                            <p className="font-mono text-[11px] text-zinc-500">
                              {swarm.infoHash}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-300">
                            {swarm.peers}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-300">
                            {formatBytes(swarm.downloadedBytes)} / {formatBytes(swarm.totalBytes)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-300">
                            {formatBytes(swarm.downloadSpeedBps)}/s
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleEvictSwarm(swarm.infoHash)}
                              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-red-500/15 hover:text-red-400"
                            >
                              Evict
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
