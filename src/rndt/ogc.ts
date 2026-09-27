import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { Bbox } from "./query";

/** Parsing of WMS/WFS GetCapabilities and URL building, framework-free. */

export interface WmsLayer {
  name: string;
  title: string;
  /** CRS/SRS codes, inherited from parent layers. */
  crs: string[];
  bbox: Bbox | null;
}

export interface WmsCapabilities {
  version: string;
  getMapUrl: string;
  layers: WmsLayer[];
}

export interface WfsFeatureType {
  name: string;
  title: string;
  bbox: Bbox | null;
}

export interface WfsCapabilities {
  version: string;
  getFeatureUrl: string;
  outputFormats: string[];
  featureTypes: WfsFeatureType[];
}

const OPERATION_PARAMS = new Set([
  "service", "request", "version", "acceptversions", "layers", "layer", "typename",
  "typenames", "outputformat", "srs", "crs", "srsname", "bbox", "width", "height",
  "format", "styles", "count", "maxfeatures", "startindex",
]);

function localName(el: Element): string {
  return el.localName || el.tagName.split(":").pop() || "";
}

function childElements(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((c) => !name || localName(c) === name);
}

function firstChild(el: Element | null | undefined, name: string): Element | null {
  return el ? (childElements(el, name)[0] ?? null) : null;
}

function descendants(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagName("*")).filter((c) => localName(c) === name);
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").trim();
}

function href(el: Element | null | undefined): string {
  if (!el) return "";
  return (
    el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
    el.getAttribute("xlink:href") ??
    el.getAttribute("onlineResource") ??
    ""
  ).trim();
}

function parse(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

/**
 * Repair the two faults seen in real capabilities documents: a DOCTYPE with an
 * internal subset, and namespace prefixes used without a declaration (e.g.
 * `inspire_vs:` in some MapServer WMS 1.1.1). Undeclared prefixes get a
 * placeholder namespace on the root element.
 */
export function repairXml(xml: string): string {
  const withoutDoctype = xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i, "");
  const declared = new Set(Array.from(withoutDoctype.matchAll(/xmlns:([\w.-]+)\s*=/g), (m) => m[1]));
  const used = new Set(
    Array.from(withoutDoctype.matchAll(/<\/?([\w.-]+):[\w.-]+|\s([\w.-]+):[\w.-]+\s*=/g), (m) => m[1] ?? m[2]),
  );
  const missing = Array.from(used).filter((p) => p && p !== "xml" && p !== "xmlns" && !declared.has(p));
  if (!missing.length) return withoutDoctype;
  const decls = missing.map((p) => ` xmlns:${p}="urn:x-undeclared:${p}"`).join("");
  return withoutDoctype.replace(/<([A-Za-z_][\w.:-]*)/, (m) => `${m}${decls}`);
}

/** Parse XML, turning OGC exception reports into errors. */
export function parseXml(xml: string): Document {
  const doc = parse(xml) ?? parse(repairXml(xml));
  if (!doc) {
    throw new Error("The service did not return valid XML.");
  }
  const root = doc.documentElement;
  const rootName = root ? localName(root) : "";
  if (rootName === "ServiceExceptionReport" || rootName === "ExceptionReport") {
    throw new Error(`Service error: ${text(root).slice(0, 300)}`);
  }
  return doc;
}

/** Name of a layer/feature type preselected by the resource URL, if any. */
export function preselectedName(url: string): string | null {
  try {
    const params = new URL(url).searchParams;
    for (const [key, value] of params) {
      if (["layers", "layer", "typename", "typenames"].includes(key.toLowerCase()) && value) {
        return value.split(",")[0];
      }
    }
  } catch {
    // Not a URL: nothing preselected.
  }
  return null;
}

/** Base endpoint of an OGC URL: the same URL without operation parameters. */
export function serviceBaseUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (OPERATION_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  return parsed.toString().replace(/\?$/, "");
}

/**
 * When the capabilities document was fetched over HTTPS, an operation URL it
 * declares as `http://` on the same host is upgraded too: servers that moved to
 * HTTPS often keep old `OnlineResource` values.
 */
export function upgradeToHttps(target: string, fetchedFrom: string): string {
  try {
    const t = new URL(target);
    const f = new URL(fetchedFrom);
    if (f.protocol === "https:" && t.protocol === "http:" && t.hostname === f.hostname) {
      t.protocol = "https:";
      return t.toString();
    }
  } catch {
    // Leave unparseable URLs alone.
  }
  return target;
}

export function capabilitiesUrl(url: string, service: "WMS" | "WFS"): string {
  const parsed = new URL(serviceBaseUrl(url));
  parsed.searchParams.set("SERVICE", service);
  parsed.searchParams.set("REQUEST", "GetCapabilities");
  return parsed.toString();
}

function parseBoxNumbers(values: (string | null)[]): Bbox | null {
  const box = values.map((v) => Number(v)) as Bbox;
  return values.every((v) => v !== null && v !== "") && box.every((v) => Number.isFinite(v)) ? box : null;
}

function wmsLayerBbox(layer: Element): Bbox | null {
  const geo = firstChild(layer, "EX_GeographicBoundingBox");
  if (geo) {
    return parseBoxNumbers(
      ["westBoundLongitude", "southBoundLatitude", "eastBoundLongitude", "northBoundLatitude"].map(
        (n) => text(firstChild(geo, n)),
      ),
    );
  }
  const ll = firstChild(layer, "LatLonBoundingBox");
  if (ll) return parseBoxNumbers(["minx", "miny", "maxx", "maxy"].map((a) => ll.getAttribute(a)));
  return null;
}

export function parseWmsCapabilities(xml: string, requestUrl: string): WmsCapabilities {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const version = root.getAttribute("version") ?? "1.3.0";
  const getMap = descendants(doc, "GetMap")[0];
  const getMapUrl =
    href(getMap ? descendants(getMap, "OnlineResource")[0] : null) || serviceBaseUrl(requestUrl);

  const layers: WmsLayer[] = [];
  const walk = (layer: Element, inheritedCrs: string[], inheritedBbox: Bbox | null) => {
    const own = [...childElements(layer, "CRS"), ...childElements(layer, "SRS")]
      .flatMap((el) => text(el).split(/\s+/))
      .filter(Boolean);
    const crs = Array.from(new Set([...inheritedCrs, ...own]));
    const bbox = wmsLayerBbox(layer) ?? inheritedBbox;
    const name = text(firstChild(layer, "Name"));
    if (name) layers.push({ name, title: text(firstChild(layer, "Title")) || name, crs, bbox });
    for (const child of childElements(layer, "Layer")) walk(child, crs, bbox);
  };
  const capability = descendants(doc, "Capability")[0];
  for (const top of capability ? childElements(capability, "Layer") : []) walk(top, [], null);
  return { version, getMapUrl: serviceBaseUrl(stripQueryEnd(getMapUrl)), layers };
}

/** GeoLibre's plugin `addWmsLayer` always requests Web Mercator tiles. */
export function supportsWebMercator(layer: WmsLayer): boolean {
  return layer.crs.some((c) => /^EPSG:(3857|900913)$/i.test(c));
}

function stripQueryEnd(url: string): string {
  return url.replace(/[?&]+$/, "");
}

export function parseWfsCapabilities(xml: string, requestUrl: string): WfsCapabilities {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const version = root.getAttribute("version") ?? "2.0.0";

  let getFeatureUrl = "";
  const outputFormats: string[] = [];
  for (const op of descendants(doc, "Operation")) {
    if (op.getAttribute("name") !== "GetFeature") continue;
    getFeatureUrl = href(descendants(op, "Get")[0]);
    for (const param of childElements(op, "Parameter")) {
      if (param.getAttribute("name")?.toLowerCase() !== "outputformat") continue;
      outputFormats.push(...descendants(param, "Value").map((v) => text(v)));
    }
  }
  if (!getFeatureUrl) {
    // WFS 1.0.0: Capability/Request/GetFeature/DCPType/HTTP/Get@onlineResource.
    const legacy = descendants(doc, "GetFeature")[0];
    if (legacy) {
      getFeatureUrl = href(descendants(legacy, "Get")[0]);
      const formats = firstChild(legacy, "ResultFormat");
      if (formats) outputFormats.push(...childElements(formats).map((f) => localName(f)));
    }
  }

  const featureTypes: WfsFeatureType[] = [];
  for (const ft of descendants(doc, "FeatureType")) {
    const name = text(firstChild(ft, "Name"));
    if (!name) continue;
    let bbox: Bbox | null = null;
    const wgs = firstChild(ft, "WGS84BoundingBox");
    if (wgs) {
      const lower = text(firstChild(wgs, "LowerCorner")).split(/\s+/);
      const upper = text(firstChild(wgs, "UpperCorner")).split(/\s+/);
      bbox = parseBoxNumbers([lower[0], lower[1], upper[0], upper[1]]);
    } else {
      const ll = firstChild(ft, "LatLongBoundingBox");
      if (ll) bbox = parseBoxNumbers(["minx", "miny", "maxx", "maxy"].map((a) => ll.getAttribute(a)));
    }
    for (const format of descendants(ft, "Format")) outputFormats.push(text(format));
    featureTypes.push({ name, title: text(firstChild(ft, "Title")) || name, bbox });
  }

  return {
    version,
    getFeatureUrl: serviceBaseUrl(stripQueryEnd(getFeatureUrl || requestUrl)),
    outputFormats: Array.from(new Set(outputFormats.filter(Boolean))),
    featureTypes,
  };
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/**
 * The layer whose name or title shares most words with the record title, used
 * to preselect a layer when the record's link does not name one. Null when no
 * layer shares at least one word.
 */
export function bestMatchingLayer(title: string, layers: { name: string; title: string }[]): string | null {
  const wanted = tokens(title);
  let best: string | null = null;
  let bestScore = 0;
  for (const layer of layers) {
    const have = tokens(`${layer.name} ${layer.title}`);
    let score = 0;
    for (const t of wanted) if (have.has(t)) score++;
    if (score > bestScore) {
      best = layer.name;
      bestScore = score;
    }
  }
  return best;
}

/** Best GeoJSON output format the WFS advertises, or null. */
export function pickJsonFormat(formats: string[]): string | null {
  const lower = formats.map((f) => f.toLowerCase());
  const exact = lower.indexOf("application/json");
  if (exact >= 0) return formats[exact];
  const geojson = lower.findIndex((f) => f.includes("geojson"));
  if (geojson >= 0) return formats[geojson];
  const json = lower.findIndex((f) => f.includes("json"));
  return json >= 0 ? formats[json] : null;
}

/**
 * GetFeature URL for GeoJSON in WGS84. With `bbox`, only features in that box
 * are requested (needed by services such as the cadastral WFS, which refuse
 * requests without one).
 */
export function buildGetFeatureUrl(
  caps: WfsCapabilities,
  typeName: string,
  options: { format: string; maxFeatures: number; bbox?: Bbox | null },
): string {
  const url = new URL(caps.getFeatureUrl);
  const set = (key: string, value: string) => url.searchParams.set(key, value);
  const v = caps.version;
  set("SERVICE", "WFS");
  set("REQUEST", "GetFeature");
  set("VERSION", v);
  set("OUTPUTFORMAT", options.format);
  if (v.startsWith("2.")) {
    set("TYPENAMES", typeName);
    set("COUNT", String(options.maxFeatures));
  } else {
    set("TYPENAME", typeName);
    set("MAXFEATURES", String(options.maxFeatures));
  }
  if (v.startsWith("1.0")) {
    set("SRSNAME", "EPSG:4326");
    if (options.bbox) set("BBOX", options.bbox.join(","));
  } else {
    // WFS 1.1/2.0 with the URN CRS: axis order is latitude, longitude.
    set("SRSNAME", "urn:ogc:def:crs:EPSG::4326");
    if (options.bbox) {
      const [w, s, e, n] = options.bbox;
      set("BBOX", `${s},${w},${n},${e},urn:ogc:def:crs:EPSG::4326`);
    }
  }
  return url.toString();
}

/**
 * GetFeature URL that asks only how many features match (`resultType=hits`),
 * or null for WFS 1.0.0, which has no such request.
 */
export function buildHitsUrl(caps: WfsCapabilities, typeName: string, bbox?: Bbox | null): string | null {
  if (caps.version.startsWith("1.0")) return null;
  const url = new URL(buildGetFeatureUrl(caps, typeName, { format: "", maxFeatures: 0, bbox }));
  for (const key of ["OUTPUTFORMAT", "COUNT", "MAXFEATURES"]) url.searchParams.delete(key);
  url.searchParams.set("RESULTTYPE", "hits");
  return url.toString();
}

/**
 * Feature count from a `resultType=hits` answer: `numberMatched` (WFS 2.0) or
 * `numberOfFeatures` (1.1). Null when missing or "unknown".
 */
export function parseHitsCount(xml: string): number | null {
  const match = /\snumberMatched="(\d+)"/.exec(xml) ?? /\snumberOfFeatures="(\d+)"/.exec(xml);
  return match ? Number(match[1]) : null;
}

function firstPosition(geometry: Geometry | null): Position | null {
  if (!geometry) return null;
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) {
      const p = firstPosition(g);
      if (p) return p;
    }
    return null;
  }
  let coords: unknown = geometry.coordinates;
  while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
  return Array.isArray(coords) && typeof coords[0] === "number" ? (coords as Position) : null;
}

function swapPositions(coords: unknown): unknown {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    const [a, b, ...rest] = coords as number[];
    return [b, a, ...rest];
  }
  return Array.isArray(coords) ? coords.map(swapPositions) : coords;
}

function swapGeometry(geometry: Geometry | null): Geometry | null {
  if (!geometry) return geometry;
  if (geometry.type === "GeometryCollection") {
    return { ...geometry, geometries: geometry.geometries.map((g) => swapGeometry(g) as Geometry) };
  }
  return { ...geometry, coordinates: swapPositions(geometry.coordinates) } as Geometry;
}

/**
 * Servers disagree on the axis order of EPSG:4326 in GeoJSON. For Italian data
 * the two orders are easy to tell apart: longitude is 6..19, latitude 35..48.
 * When the first coordinate looks like (lat, lon), swap every position.
 */
export function fixAxisOrder(fc: FeatureCollection): FeatureCollection {
  const first = fc.features.map((f) => firstPosition(f.geometry)).find(Boolean);
  if (!first) return fc;
  const [x, y] = first;
  const looksSwapped = x >= 35 && x <= 48 && y >= 6 && y <= 19;
  if (!looksSwapped) return fc;
  return {
    ...fc,
    features: fc.features.map((f: Feature) => ({ ...f, geometry: swapGeometry(f.geometry) as Geometry })),
  };
}
