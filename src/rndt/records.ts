import type { Feature, FeatureCollection } from "geojson";
import type { Bbox } from "./query";

/** Kind of a resource attached to a record. */
export type ServiceKind = "WMS" | "WFS" | "WCS" | "WMTS" | "download" | string;

export interface RndtService {
  kind: ServiceKind;
  url: string;
}

export interface RndtRecord {
  id: string;
  title: string;
  abstract: string;
  /** dataset, series or service. */
  type: string;
  organisation: string;
  /** Point of contact of the resource (`PuntoDiContattoEmail_s`), valid addresses only. */
  contactEmails: string[];
  /** Metadata date (`apiso_Modified_dt`), yyyy-mm-dd. */
  modified: string;
  bbox: Bbox | null;
  services: RndtService[];
  /** Web links the plugin cannot open (a GitHub folder, a project page). */
  otherLinks: string[];
  htmlUrl: string;
  xmlUrl: string;
}

export interface SearchPage {
  total: number;
  start: number;
  records: RndtRecord[];
}

type Json = Record<string, unknown>;

// Same rules as openrndt's resources.py.
const NON_RESOURCE_RELS = new Set(["alternate", "icon", "self"]);
const DOWNLOAD_EXTENSIONS = [
  ".csv", ".geojson", ".gpkg", ".gz", ".json", ".jsonl", ".kml", ".kmz",
  ".pdf", ".shp", ".tif", ".tiff", ".tsv", ".xml", ".zip",
];

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join("; ");
  return "";
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * The addresses in a contact field. Placeholders such as "ad@min" (2 records
 * out of 400 sampled on 2026-09-30) are dropped: no domain, no mail.
 */
export function parseEmails(value: unknown): string[] {
  const found = asStringList(value).flatMap((v) => v.split(/[\s,;]+/));
  return Array.from(new Set(found.filter((v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v))));
}

/** Guess a resource kind from its URL (SERVICE parameter, path, extension). */
export function inferKind(url: string): ServiceKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "link";
  }
  for (const [key, value] of parsed.searchParams) {
    if (key.toLowerCase() === "service" && value) return normalizeKind(value);
  }
  const path = parsed.pathname.toLowerCase();
  // A capabilities document saved as a file (Piemonte's WEBCAT/CAPABILITIES/
  // wms_*.xml) describes a service: its GetMap URL is inside.
  if (path.endsWith(".xml") && path.includes("capabilities")) {
    if (path.includes("wmts")) return "WMTS";
    if (path.includes("wms")) return "WMS";
    if (path.includes("wfs")) return "WFS";
  }
  if (DOWNLOAD_EXTENSIONS.some((ext) => path.endsWith(ext))) return "download";
  if (path.includes("wmts")) return "WMTS";
  if (path.includes("wms")) return "WMS";
  if (path.includes("wfs")) return "WFS";
  if (path.includes("wcs")) return "WCS";
  return "link";
}

export function normalizeKind(kind: string): ServiceKind {
  const raw = kind.trim();
  if (!raw) return "link";
  const up = raw.toUpperCase();
  if (up === "WMS" || up === "WFS" || up === "WCS" || up === "WMTS") return up;
  if (up === "DOWNLOAD") return "download";
  if (up === "LINK") return "link";
  return raw;
}

/**
 * Usable resources of a search result, deduplicated by URL. Sources in order of
 * reliability (as in openrndt): `resources_nst` (types assigned by the
 * catalogue), `links` (declared dctype), then bare URLs in `webServices_s` and
 * `links_s` with the kind inferred from the URL. Plain web links are dropped.
 */
export function extractServices(result: Json): RndtService[] {
  const source = asObject(result._source);
  const services: RndtService[] = [];
  const seen = new Set<string>();
  const push = (kind: ServiceKind, url: string) => {
    // Records are third-party metadata: keep web links only (no javascript:, data:, ...).
    if (!/^https?:\/\//i.test(url) || seen.has(url) || kind === "link") return;
    seen.add(url);
    services.push({ kind, url });
  };

  const nested = Array.isArray(source.resources_nst) ? source.resources_nst : [];
  for (const entry of nested) {
    const item = asObject(entry);
    const url = typeof item.url_s === "string" ? item.url_s : "";
    let kind = typeof item.url_type_s === "string" ? normalizeKind(item.url_type_s) : "link";
    if (kind === "link") kind = inferKind(url);
    push(kind, url);
  }

  const links = Array.isArray(result.links) ? result.links : [];
  for (const entry of links) {
    const link = asObject(entry);
    const href = typeof link.href === "string" ? link.href : "";
    if (!href || NON_RESOURCE_RELS.has(String(link.rel))) continue;
    const kind = typeof link.dctype === "string" ? normalizeKind(link.dctype) : inferKind(href);
    push(kind, href);
  }

  for (const key of ["webServices_s", "links_s"]) {
    for (const url of asStringList(source[key])) push(inferKind(url), url);
  }
  return services;
}

/**
 * The record's web links that are neither services nor recognised downloads,
 * deduplicated. Bare home pages (no path, no query) are left out: they are the
 * publisher's site, repeated in most records. MaGIC records keep their data in
 * a GitHub folder this way (756 records link to github.com, 2026-09-27).
 */
export function extractOtherLinks(result: Json, services: RndtService[]): string[] {
  const source = asObject(result._source);
  const taken = new Set(services.map((s) => linkKey(s.url)));
  const links: string[] = [];
  const candidates = [
    ...(Array.isArray(result.links) ? result.links : [])
      .map(asObject)
      .filter((link) => !NON_RESOURCE_RELS.has(String(link.rel)))
      .map((link) => asString(link.href)),
    ...asStringList(source.links_s),
  ];
  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url) || inferKind(url) !== "link") continue;
    const parsed = new URL(url);
    if ((parsed.pathname === "/" || parsed.pathname === "") && !parsed.search) continue;
    const key = linkKey(url);
    if (taken.has(key)) continue;
    taken.add(key);
    links.push(url);
  }
  return links;
}

/** Same link whatever the scheme, case or trailing slash. */
function linkKey(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function parseBbox(value: unknown): Bbox | null {
  const b = asObject(value);
  const box = [b.xmin, b.ymin, b.xmax, b.ymax].map(Number) as Bbox;
  return box.every((v) => Number.isFinite(v)) ? box : null;
}

export function parseRecord(result: Json, baseUrl: string): RndtRecord {
  const source = asObject(result._source);
  const id = asString(result.id) || asString(source.fileid);
  const itemUrl = `${baseUrl.replace(/\/+$/, "")}/rest/metadata/item/${encodeURIComponent(id)}`;
  const services = extractServices(result);
  return {
    id,
    title: asString(result.title) || asString(source.title) || id,
    abstract: asString(result.description) || asString(source.apiso_Abstract_txt),
    type: asString(source.apiso_Type_s),
    organisation: asString(source.EnteResponsabile_s),
    contactEmails: parseEmails(source.PuntoDiContattoEmail_s),
    modified: asString(source.apiso_Modified_dt).slice(0, 10),
    bbox: parseBbox(result.bbox),
    services,
    otherLinks: extractOtherLinks(result, services),
    htmlUrl: `${itemUrl}/html`,
    xmlUrl: `${itemUrl}/xml`,
  };
}

export function parseSearchResponse(payload: unknown, baseUrl: string): SearchPage {
  const data = asObject(payload);
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    total: Number(data.total) || 0,
    start: Number(data.start) || 1,
    records: results.map((r) => parseRecord(asObject(r), baseUrl)),
  };
}

/** Footprints of the records as a GeoJSON FeatureCollection (one polygon each). */
export function footprints(records: RndtRecord[]): FeatureCollection {
  const features: Feature[] = [];
  for (const record of records) {
    if (!record.bbox) continue;
    const [w, s, e, n] = record.bbox;
    features.push({
      type: "Feature",
      id: features.length,
      properties: { id: record.id, title: record.title, type: record.type, organisation: record.organisation },
      geometry: {
        type: "Polygon",
        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
      },
    });
  }
  return { type: "FeatureCollection", features };
}
