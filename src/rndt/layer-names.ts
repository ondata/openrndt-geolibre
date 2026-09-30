import { fetchText, withTimeout, type RndtHost } from "./host";
import { parseXml, preselectedName } from "./ogc";
import { escapeTerm } from "./query";

/**
 * Readable names for WMS/WFS layers whose capabilities give only codes (#7).
 *
 * Survey of 64 services (2026-09-27): 88% of WMS layer titles are readable,
 * but only 50% of WFS ones; 34% of WFS titles are words joined by `_` or
 * CamelCase (`Parchi_naturali`), 16% opaque codes (`TDLD8`). The layer name
 * always stays visible as the service gives it; a readable name comes from the
 * capabilities title when it is one, or from RNDT records that link to the same
 * service with the layer name in the link (`typeName`, `LAYERS`); FVG and
 * Veneto publish one record per layer.
 */

/**
 * Budget for the RNDT lookup: 0.15-0.6 s usually, 3.6 s at most measured, but
 * the bulk download of a large service (2.5 MB for Emilia-Romagna) failed at
 * the 8 s native budget on 2026-09-27. The lookup runs in the background and
 * never blocks the layer menu, so it can wait longer.
 */
export const LOOKUP_TIMEOUT_MS = 30000;
/**
 * Up to this many records the lookup downloads them all in one request
 * (Veneto, 668 records: 1.2 MB, about 1 s); above it, it looks up only the
 * layer the user selects. The largest service in the survey had 909.
 */
export const BULK_LOOKUP_MAX = 1000;

export function localName(name: string): string {
  return name.split(":").pop() ?? name;
}

/** True when the capabilities title reads as a name, not as a code. */
export function isReadableTitle(name: string, title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (lower === name.toLowerCase() || lower === localName(name).toLowerCase()) return false;
  if (/\s/.test(t)) return true;
  // A single real word ("Ciclovie", "Particelle") is readable; a token with
  // digits, `_`, `.` or `:` is a code.
  return /^[\p{L}'’-]{3,}$/u.test(t);
}

/** The capabilities title when it reads as a name, else null. */
export function readableTitle(name: string, title: string): string | null {
  return isReadableTitle(name, title) ? title.trim() : null;
}

/**
 * Key that matches every link to the same service: host and path without the
 * last segment (`…/geoserver/RIFIUTI/wfs` → `…/geoserver/RIFIUTI`), so WMS,
 * WFS and OWS links of one workspace all count.
 */
export function serviceKey(serviceUrl: string): string {
  const url = new URL(serviceUrl);
  const path = url.pathname.replace(/\/+$/, "");
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;
  return `${url.host}${parent}`;
}

/** Lucene clause for the records that link to the service. */
function serviceClause(serviceUrl: string): string {
  // `/` must be escaped: unescaped the catalogue answers 400 "Failed to parse query".
  return `links_s:*${escapeTerm(serviceKey(serviceUrl))}*`;
}

/** RNDT search for records linking to the service, in the light CSW format. */
export function layerTitlesUrl(baseUrl: string, serviceUrl: string, num = BULK_LOOKUP_MAX, layerName?: string): string {
  const q = layerName
    ? `${serviceClause(serviceUrl).slice(0, -1)}*${escapeTerm(localName(layerName))}*`
    : serviceClause(serviceUrl);
  const params = new URLSearchParams({ q, start: "1", num: String(num), f: "csw" });
  return `${baseUrl.replace(/\/+$/, "")}/rest/metadata/search?${params.toString()}`;
}

/**
 * RNDT search for the records linking to the service that mention the layer
 * name anywhere in their metadata. Emilia-Romagna names the layer only in the
 * `gmd:name` of the online resource, which the CSW format leaves out, and
 * links a bare GetCapabilities: on 2026-09-30 this found 28 of the 43 layers
 * of `wms/metadati_raster`, the link rules none.
 */
export function layerCodeUrl(baseUrl: string, serviceUrl: string, layerName: string): string {
  const q = `${serviceClause(serviceUrl)} AND ${escapeTerm(localName(layerName))}`;
  const params = new URLSearchParams({ q, start: "1", num: "1", f: "csw" });
  return `${baseUrl.replace(/\/+$/, "")}/rest/metadata/search?${params.toString()}`;
}

function childText(el: Element, local: string): string {
  const node = Array.from(el.getElementsByTagName("*")).find((c) => c.localName === local);
  return (node?.textContent ?? "").trim();
}

export interface LayerTitles {
  /** From links naming the layer (`typeName`, `LAYERS`): the reliable match. */
  titles: Map<string, string>;
  /** From a code in brackets at the end of the title, "Recupero RAEE R3 (RAEER3)": the fallback. */
  codes: Map<string, string>;
}

const TRAILING_CODE = /\(([\p{L}\p{N}_.-]+)\)\s*$/u;

/**
 * Layer titles from a CSW search response. Keys are lower-cased, both the full
 * name (`rifiuti:tdld8`) and the local one (`tdld8`); the first record wins.
 * Some records (FVG service records) link only to GetCapabilities but end their
 * title with the layer code in brackets: those go in `codes`.
 */
export function parseLayerTitles(xml: string): LayerTitles & { total: number } {
  const doc = parseXml(xml);
  const titles = new Map<string, string>();
  const codes = new Map<string, string>();
  const results = Array.from(doc.getElementsByTagName("*")).find((e) => e.localName === "SearchResults");
  const total = Number(results?.getAttribute("numberOfRecordsMatched")) || 0;
  for (const record of Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "Record")) {
    const title = childText(record, "title");
    if (!title) continue;
    const code = TRAILING_CODE.exec(title)?.[1]?.toLowerCase();
    if (code && !codes.has(code)) codes.set(code, title);
    for (const ref of Array.from(record.getElementsByTagName("*")).filter((e) => e.localName === "references")) {
      const name = preselectedName((ref.textContent ?? "").trim());
      if (!name) continue;
      for (const key of [name.toLowerCase(), localName(name).toLowerCase()]) {
        if (!titles.has(key)) titles.set(key, title);
      }
    }
  }
  return { total, titles, codes };
}

/** Title for a layer: a link naming it first, then a matching code in a title. */
export function findTitle(found: LayerTitles, name: string): string | null {
  const full = name.toLowerCase();
  const local = localName(name).toLowerCase();
  return found.titles.get(full) ?? found.titles.get(local) ?? found.codes.get(local) ?? null;
}

export type LayerTitlesLookup =
  /** All records downloaded: every layer can be looked up in `found`. */
  | { mode: "all"; found: LayerTitles }
  /** Too many records: look up each layer on demand with `lookupOneLayerTitle`. */
  | { mode: "per-layer" };

function merge(into: LayerTitles, parsed: LayerTitles): void {
  for (const [k, v] of parsed.titles) if (!into.titles.has(k)) into.titles.set(k, v);
  for (const [k, v] of parsed.codes) if (!into.codes.has(k)) into.codes.set(k, v);
}

/**
 * Titles from RNDT records that link to the service. First a count (about
 * 0.2 s): no records, nothing else to do; up to BULK_LOOKUP_MAX, all of them
 * in one request; above, `per-layer`. Never throws: on error or timeout it
 * returns what it has (possibly nothing), so opening a service never depends
 * on this lookup.
 */
export async function lookupLayerTitles(
  host: RndtHost,
  baseUrl: string,
  serviceUrl: string,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<LayerTitlesLookup> {
  const found: LayerTitles = { titles: new Map(), codes: new Map() };
  let perLayer = false;
  const work = async () => {
    const { total } = parseLayerTitles(await fetchText(host, layerTitlesUrl(baseUrl, serviceUrl, 0)));
    if (total === 0) return;
    if (total > BULK_LOOKUP_MAX) {
      perLayer = true;
      return;
    }
    // Up to 1,000 records with their ISO XML: several MB, so the long-budget path.
    merge(found, parseLayerTitles(await fetchText(host, layerTitlesUrl(baseUrl, serviceUrl), { download: true })));
  };
  try {
    await withTimeout(work(), timeoutMs);
  } catch {
    // Keep whatever arrived before the error or the timeout.
  }
  return perLayer ? { mode: "per-layer" } : { mode: "all", found };
}

/** Title for one layer, for services with too many records to download (0.15-0.2 s). */
export async function lookupOneLayerTitle(
  host: RndtHost,
  baseUrl: string,
  serviceUrl: string,
  layerName: string,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const xml = await withTimeout(fetchText(host, layerTitlesUrl(baseUrl, serviceUrl, 20, layerName)), timeoutMs);
    return findTitle(parseLayerTitles(xml), layerName);
  } catch {
    return null;
  }
}

/** Title of the best-ranked record that mentions the layer name (0.2 s); null if none or on error. */
export async function lookupLayerTitleByCode(
  host: RndtHost,
  baseUrl: string,
  serviceUrl: string,
  layerName: string,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const doc = parseXml(await withTimeout(fetchText(host, layerCodeUrl(baseUrl, serviceUrl, layerName)), timeoutMs));
    const record = Array.from(doc.getElementsByTagName("*")).find((e) => e.localName === "Record");
    return (record && childText(record, "title")) || null;
  } catch {
    return null;
  }
}
