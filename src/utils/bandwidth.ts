let cachedMbps: number | null = null;
let cachedAt = 0;

/**
 * Silently measures client downlink bandwidth using Network Information API
 * supplemented by a quick 64KB probe against /api/speed-probe.
 */
export async function measureClientBandwidthMbps(): Promise<number> {
  if (cachedMbps !== null && Date.now() - cachedAt < 60_000) {
    return cachedMbps;
  }

  const nav = navigator as Navigator & {
    connection?: { downlink?: number; effectiveType?: string };
  };
  const apiDownlink = nav.connection?.downlink;

  try {
    const start = performance.now();
    const res = await fetch('/api/speed-probe', { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    const elapsedSec = Math.max(0.015, (performance.now() - start) / 1000);
    const measuredMbps = (buf.byteLength * 8) / elapsedSec / 1_000_000;

    // Blend probe measurement with Network Information hint if available
    const finalMbps = apiDownlink && apiDownlink > 0
      ? Math.min(measuredMbps, apiDownlink * 1.4)
      : measuredMbps;

    cachedMbps = Math.max(1.5, Math.min(100, Number(finalMbps.toFixed(1))));
    cachedAt = Date.now();
    return cachedMbps;
  } catch {
    return apiDownlink && apiDownlink > 0 ? apiDownlink : 10;
  }
}
