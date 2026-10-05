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
  /** System the tiles are requested in, redrawn into Web Mercator by GeoLibre Desktop (3.2.0). */
  crs?: string;
  attribution?: string;
  bounds?: Bbox;
  /** False for a layer that answers no GetFeatureInfo: identify skips it (GeoLibre 3.3.0). */
  queryable?: false;
}

export interface RndtHostExtras {
  /** Leave `sourcePath` unset for remote data: GeoLibre treats it as a local file to watch and restore. */
  addGeoJsonLayer?: (name: string, data: FeatureCollection, sourcePath?: string) => string;
  addWmsLayer?: (name: string, options: WmsLayerOptions) => string;
  /**
   * A raster layer from a tile URL template, handed to MapLibre as it is:
   * `{z}/{x}/{y}` or `{bbox-epsg-3857}`. The webview fetches the tiles, so
   * the server must send CORS headers (ArcGIS Server does by default).
   */
  addTileLayer?: (name: string, url: string, options?: { attribution?: string; bounds?: Bbox }) => string;
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>;
  /**
   * Desktop-native downloader of GeoLibre's Add Vector Layer, with a 180 s
   * budget instead of the 8 s tile budget of `fetchArrayBuffer`. Resolves to
   * null when no loader could serve the URL, which in a browser is the answer
   * for most URLs.
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
  /**
   * Applies an SLD, QML or Mapbox GL style to a vector layer, as "Import
   * style" of the Layers panel does (GeoLibre 3.2.0). Its presence also tells
   * a host whose `addWmsLayer` takes `crs`, which an older one drops in silence.
   */
  importLayerStyle?: (layerId: string, text: string) => { ok: boolean; warnings: string[]; reason?: string };
  /** Ids of the layers in the project, top to bottom (GeoLibre 3.1.0). */
  getLayers?: () => string[];
  /** The project as it would be saved: its layers carry their source (a WMS: `url` and `layers`). */
  getProjectSnapshot?: () => { layers?: unknown[] };
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
  const budget = options.download ? DOWNLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  if (options.download && host.fetchVectorUrl) {
    // Null is "read it yourself": GeoLibre in a browser serves only zipped
    // shapefiles and GitHub raw files this way (3.2.0), so go on below.
    const file = await withTimeout(host.fetchVectorUrl(url), budget);
    if (file) return file.text();
  }
  if (host.fetchArrayBuffer) {
    const buffer = await withTimeout(host.fetchArrayBuffer(url), budget);
    return new TextDecoder().decode(buffer);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(budget) });
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
  // In a browser a server without CORS headers fails like one that is down
  // (a TypeError, "Failed to fetch" or "NetworkError"), but it is fine: an
  // opaque request tells them apart. Not a fault to report to its owner.
  if (!isDesktop() && lastError instanceof Error && lastError.name === "TypeError" && (await answersOpaque(candidates[0]))) {
    throw new Error(`${hostname} answers, ${BROWSER_BLOCK_NOTE}`);
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  const tried = candidates.length > 1 ? " (tried HTTPS and HTTP)" : "";
  throw new Error(`cannot reach ${new URL(url).host}${tried}: ${reason}`);
}

/** GeoLibre Desktop (Tauri), whose native client reads services without CORS. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** End of the error for a service the web version cannot read; no error report is offered for it. */
export const BROWSER_BLOCK_NOTE =
  "but a web page cannot read it: the server sends no CORS headers. The service works in GeoLibre Desktop";

/** True when the browser gets an answer it may not read (a request without CORS). */
async function answersOpaque(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(BROWSER_PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The address to send requests to: the one the capabilities declare, unless
 * it is on a host no one outside can reach (tms.comune.fi.it declares its
 * GetMap at sr-vm490-sitgfn.comune.intranet:8084, 2026-10-02: a GeoServer
 * without a proxy base URL). Then the capabilities' own address, which did
 * answer. `note` says so, for the panel.
 */
export async function reachableEndpoint(
  host: RndtHost,
  declared: string,
  capabilitiesUrl: string,
  serviceBase: (url: string) => string,
): Promise<{ url: string; note: string | null }> {
  const name = new URL(declared).hostname;
  const own = new URL(capabilitiesUrl).hostname;
  if (name === own || !(isPrivateName(name) || (await nameIsMissing(host, name)))) return { url: declared, note: null };
  return {
    url: serviceBase(capabilitiesUrl),
    note: `Requests go to ${own}: the capabilities declare ${name}, a name only the publisher's network knows.`,
  };
}

/** A host name of a private network: no dot, a private suffix, or a private IPv4 range. */
export function isPrivateName(name: string): boolean {
  if (/^(localhost|[^.]+|.*\.(local|localdomain|intranet|internal|lan|corp|home))$/i.test(name)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(name);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
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

/** Time allowed to the one-tile test of a WMS in EPSG:3857. */
const IMAGE_PROBE_TIMEOUT_MS = 8000;

async function probeBytes(host: RndtHost, url: string): Promise<ArrayBuffer> {
  if (host.fetchArrayBuffer) return withTimeout(host.fetchArrayBuffer(url), IMAGE_PROBE_TIMEOUT_MS);
  const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_PROBE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * True when the URL answers with an image (PNG, JPEG, GIF or WebP by their
 * first bytes), false on an error document, an HTTP error or no answer.
 */
export async function answersWithImage(host: RndtHost, url: string): Promise<boolean> {
  try {
    return isImage(await probeBytes(host, url));
  } catch {
    return false;
  }
}

/** What a test GetMap answered: a tile of the size asked, a picture of another size, or no image. */
export type TileAnswer = "tile" | "other-size" | "none";

/**
 * Asks one test tile of `size` pixels. A server may answer any request with
 * the same picture (the 500×500 map of Italy of the cadastral WMS group layer
 * `Cartografia_Catastale`, 2026-10-02): a PNG of another size is not a tile.
 */
export async function testTile(host: RndtHost, url: string, size: number): Promise<TileAnswer> {
  try {
    const buffer = await probeBytes(host, url);
    if (!isImage(buffer)) return "none";
    // A PNG has its width and height at bytes 16-23 (IHDR); other formats are taken as they come.
    const b = new Uint8Array(buffer);
    if (b[0] !== 0x89 || buffer.byteLength < 24) return "tile";
    const view = new DataView(buffer);
    return view.getUint32(16) === size && view.getUint32(20) === size ? "tile" : "other-size";
  } catch {
    return "none";
  }
}

/** PNG, JPEG, GIF or WebP, by their first bytes. */
function isImage(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer.slice(0, 12));
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpeg = b[0] === 0xff && b[1] === 0xd8;
  const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  const webp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return png || jpeg || gif || webp;
}

/**
 * True when the browser itself gets an image from the URL. Tiles of a plugin
 * tile layer are fetched by the webview, unlike WMS tiles, so a server
 * without CORS headers draws nothing although it answers.
 */
export async function browserGetsImage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_PROBE_TIMEOUT_MS) });
    return response.ok && isImage(await response.arrayBuffer());
  } catch {
    return false;
  }
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
