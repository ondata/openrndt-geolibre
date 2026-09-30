import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { GeoLibreAppAPI } from "../lib/geolibre/host-api";
import type { Bbox } from "./query";

/**
 * Host methods this plugin uses beyond the template's `host-api.ts`. Signatures
 * copied from opengeos/GeoLibre `packages/plugins/src/types.ts` (2026-09-26).
 * All optional: the plugin checks each one and degrades when it is missing.
 */
export interface WmsLayerOptions {
  url: string;
  layers: string;
  styles?: string;
  format?: string;
  transparent?: boolean;
  version?: string;
  attribution?: string;
  bounds?: Bbox;
}

export interface RndtHostExtras {
  /** Leave `sourcePath` unset for remote data: GeoLibre treats it as a local file to watch and restore. */
  addGeoJsonLayer?: (name: string, data: FeatureCollection, sourcePath?: string) => string;
  addWmsLayer?: (name: string, options: WmsLayerOptions) => string;
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>;
  /**
   * Desktop-native downloader of GeoLibre's Add Vector Layer, with a 180 s
   * budget instead of the 8 s tile budget of `fetchArrayBuffer`. Resolves to
   * null when no loader could serve the URL; unset on the web.
   */
  fetchVectorUrl?: (url: string) => Promise<File | null>;
  fitBounds?: (bounds: Bbox) => void;
  getViewBounds?: () => Bbox | null;
  getDrawnFeatures?: () => Feature<Geometry | null>[];
  getMap?: () => MapLibreMap | null;
  activatePlugin?: (pluginId: string, state?: unknown) => Promise<boolean>;
  /**
   * Open an http(s) URL in the system browser. The desktop webview keeps
   * target="_blank" links in an in-app window, and accepts no other scheme
   * (no mailto:).
   */
  openExternalUrl?: (url: string) => void;
  /** Save a text file through the system "Save as" dialog (GeoLibre 3.1.0). */
  exportTextFile?: (
    filename: string,
    content: string,
    options?: { description?: string; extensions?: string[]; mimeType?: string },
  ) => void;
}

/** Id of GeoLibre's built-in GeoEditor plugin, whose sketches `getDrawnFeatures` reads. */
export const GEO_EDITOR_PLUGIN_ID = "maplibre-gl-geo-editor";

export type RndtHost = GeoLibreAppAPI & RndtHostExtras;

/** Give up on a request after this long: some public servers never answer. */
export const REQUEST_TIMEOUT_MS = 25000;

/**
 * Budget for data downloads (WFS features, GeoJSON files): a whole-region WFS
 * layer can take 15 s and 20 MB (FVG `RIFIUTI:TDLD8`, 2026-09-27), well past
 * the native client's 8 s default behind `fetchArrayBuffer`.
 */
export const DOWNLOAD_TIMEOUT_MS = 180000;

export interface FetchOptions {
  /** A data download rather than a small document: use the long-budget path. */
  download?: boolean;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchOnce(host: RndtHost, url: string, options: FetchOptions): Promise<string> {
  if (options.download && host.fetchVectorUrl) {
    const file = await withTimeout(host.fetchVectorUrl(url), DOWNLOAD_TIMEOUT_MS);
    if (!file) throw new Error("download failed, see GeoLibre Diagnostics");
    return file.text();
  }
  if (host.fetchArrayBuffer) {
    const buffer = await withTimeout(host.fetchArrayBuffer(url), REQUEST_TIMEOUT_MS);
    return new TextDecoder().decode(buffer);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.text();
}

/**
 * Fetch a URL as text and report the URL that answered. In GeoLibre Desktop
 * `fetchArrayBuffer` goes through the native HTTP client, so third-party
 * services need no CORS headers; elsewhere it falls back to `fetch`.
 *
 * Many RNDT records still declare `http://` links for servers that now answer
 * only on HTTPS (e.g. rsdi.regione.basilicata.it times out on port 80), so an
 * `http://` URL is tried as `https://` first, then as given.
 */
export async function fetchTextFrom(
  host: RndtHost,
  url: string,
  options: FetchOptions = {},
): Promise<{ text: string; url: string }> {
  const candidates = /^http:\/\//i.test(url) ? [url.replace(/^http:/i, "https:"), url] : [url];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return { text: await fetchOnce(host, candidate, options), url: candidate };
    } catch (error) {
      lastError = error;
    }
  }
  const hostname = new URL(url).hostname;
  // The webview only says "Failed to fetch" and the native client's reason
  // stays in Diagnostics: tell a server that is gone (228 RNDT records point
  // to geoportale.comune.milano.it, NXDOMAIN since 2026-09-27) from one that
  // does not answer.
  if (await nameIsMissing(host, hostname)) {
    throw new Error(`server ${hostname} does not exist: its name is not in the DNS`);
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  const tried = candidates.length > 1 ? " (tried HTTPS and HTTP)" : "";
  throw new Error(`cannot reach ${new URL(url).host}${tried}: ${reason}`);
}

/** Public DNS-over-HTTPS resolver, answers in JSON ("Status": 3 is NXDOMAIN). */
const DNS_RESOLVER = "https://dns.google/resolve";

/**
 * True only when a public DNS says the name does not exist. Any other outcome
 * (the resolver unreachable, a name with no A record) counts as "exists", so
 * the plugin never calls a server gone by mistake. IP addresses are skipped.
 */
export async function nameIsMissing(host: RndtHost, hostname: string): Promise<boolean> {
  if (/^[\d.]+$|:/.test(hostname)) return false;
  try {
    const text = await withTimeout(fetchOnce(host, `${DNS_RESOLVER}?name=${encodeURIComponent(hostname)}&type=A`, {}), 5000);
    return (JSON.parse(text) as { Status?: unknown }).Status === 3;
  } catch {
    return false;
  }
}

/** Budget of each browser reachability probe. */
export const BROWSER_PROBE_TIMEOUT_MS = 5000;

/**
 * True when the browser cannot reach `httpsUrl` but reaches its http:// twin.
 * GeoLibre draws WMS tiles through its native client (redirects followed, no
 * CORS), but its feature identify (GetFeatureInfo) uses the browser's fetch.
 * A server that answers https with a 301 to http and no CORS header
 * (wms.pcn.minambiente.it, 2026-09-27) then shows its tiles while identify
 * fails with "Failed to fetch". A manual-redirect fetch cannot tell this
 * apart (it fails the CORS check too), so both schemes are simply tried.
 */
export async function browserNeedsHttp(httpsUrl: string): Promise<boolean> {
  const reaches = async (url: string) => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(BROWSER_PROBE_TIMEOUT_MS) });
      return true;
    } catch {
      return false;
    }
  };
  if (await reaches(httpsUrl)) return false;
  return reaches(httpsUrl.replace(/^https:/i, "http:"));
}

export async function fetchText(host: RndtHost, url: string, options: FetchOptions = {}): Promise<string> {
  return (await fetchTextFrom(host, url, options)).text;
}

export async function fetchJson(host: RndtHost, url: string, options: FetchOptions = {}): Promise<unknown> {
  const body = await fetchText(host, url, options);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`The response from ${new URL(url).host} is not JSON.`);
  }
}

/** Bounding box of drawn shapes, or null when nothing is drawn. */
export function drawnBbox(host: RndtHost): Bbox | null {
  const features = host.getDrawnFeatures?.() ?? [];
  let box: Bbox | null = null;
  const visit = (coords: unknown) => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [x, y] = coords as number[];
      box = box
        ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
        : [x, y, x, y];
    } else if (Array.isArray(coords)) {
      coords.forEach(visit);
    }
  };
  for (const feature of features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "GeometryCollection") g.geometries.forEach((x) => "coordinates" in x && visit(x.coordinates));
    else visit(g.coordinates);
  }
  if (!box) return null;
  // A drawn point (or a straight line) has no area: widen it by ~100 m.
  const [w, s, e, n] = box as Bbox;
  const pad = 0.001;
  return [w === e ? w - pad : w, s === n ? s - pad : s, w === e ? e + pad : e, s === n ? n + pad : n];
}
