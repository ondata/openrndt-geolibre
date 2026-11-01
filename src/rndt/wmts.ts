import { capabilitiesUrl, childElements, descendants, firstChild, href, parseXml, text } from "./ogc";
import type { Bbox } from "./query";

/**
 * WMTS GetCapabilities and tile templates, framework-free. GeoLibre's
 * `addWmtsLayer` (3.3.0) hands MapLibre a `{z}/{x}/{y}` template, so only a
 * layer offered in a Web Mercator tile matrix set can be drawn: 256 px tiles
 * from the world's top-left corner, one matrix per zoom level.
 */

export interface WmtsMatrix {
  id: string;
  scale: number;
  topLeft: [number, number];
  tileWidth: number;
  tileHeight: number;
}

export interface WmtsMatrixSet {
  id: string;
  crs: string;
  wellKnown: string;
  matrices: WmtsMatrix[];
}

export interface WmtsLayer {
  name: string;
  title: string;
  bbox: Bbox | null;
  /** The default style, else the first; "" when the layer lists an empty one. */
  style: string;
  formats: string[];
  /** Tile matrix sets the layer is offered in; `limits` lists the matrices it covers, null for all. */
  links: { set: string; limits: string[] | null }[];
  /** RESTful tile templates by format. */
  templates: { format: string; template: string }[];
}

export interface WmtsCapabilities {
  /** The KVP GetTile endpoint, without a trailing `?`; null when the service declares none. */
  getTileUrl: string | null;
  sets: Map<string, WmtsMatrixSet>;
  layers: WmtsLayer[];
}

/** Why a layer cannot be drawn by `addWmtsLayer`. */
export type WmtsReason = "no-web-mercator" | "matrix-ids" | "template";

export type WmtsPlan =
  | { ok: true; set: string; template: string; minzoom: number; maxzoom: number; format: string }
  | { ok: false; reason: WmtsReason; systems: string[] };

/** A static capabilities document (`…/WMTSCapabilities.xml`) is fetched as it is, an endpoint with KVP. */
export function wmtsCapabilitiesUrl(url: string): string {
  try {
    if (/\.xml$/i.test(new URL(url).pathname)) return url;
  } catch {
    // Not a URL: capabilitiesUrl throws the same.
  }
  return capabilitiesUrl(url, "WMTS");
}

function numbers(value: string): number[] {
  return value.split(/\s+/).filter(Boolean).map(Number);
}

function layerBbox(layer: Element): Bbox | null {
  const box = firstChild(layer, "WGS84BoundingBox");
  const lower = numbers(text(firstChild(box, "LowerCorner")));
  const upper = numbers(text(firstChild(box, "UpperCorner")));
  const bbox = [lower[0], lower[1], upper[0], upper[1]];
  return bbox.every((v) => Number.isFinite(v)) ? (bbox as Bbox) : null;
}

function parseLayer(layer: Element): WmtsLayer | null {
  const name = text(firstChild(layer, "Identifier"));
  if (!name) return null;
  const styles = childElements(layer, "Style");
  const style = styles.find((s) => s.getAttribute("isDefault") === "true") ?? styles[0];
  return {
    name,
    title: text(firstChild(layer, "Title")) || name,
    bbox: layerBbox(layer),
    style: style ? text(firstChild(style, "Identifier")) : "default",
    formats: childElements(layer, "Format").map(text).filter(Boolean),
    links: childElements(layer, "TileMatrixSetLink").map((link) => {
      const limits = firstChild(link, "TileMatrixSetLimits");
      return {
        set: text(firstChild(link, "TileMatrixSet")),
        limits: limits ? childElements(limits, "TileMatrixLimits").map((l) => text(firstChild(l, "TileMatrix"))) : null,
      };
    }),
    templates: childElements(layer, "ResourceURL")
      .filter((r) => (r.getAttribute("resourceType") ?? "tile") === "tile" && r.getAttribute("template"))
      .map((r) => ({ format: r.getAttribute("format") ?? "", template: r.getAttribute("template")! })),
  };
}

function parseSet(set: Element): WmtsMatrixSet {
  return {
    id: text(firstChild(set, "Identifier")),
    crs: text(firstChild(set, "SupportedCRS")),
    wellKnown: text(firstChild(set, "WellKnownScaleSet")),
    matrices: childElements(set, "TileMatrix").map((m) => {
      const corner = numbers(text(firstChild(m, "TopLeftCorner")));
      return {
        id: text(firstChild(m, "Identifier")),
        scale: Number(text(firstChild(m, "ScaleDenominator"))),
        topLeft: [corner[0], corner[1]] as [number, number],
        tileWidth: Number(text(firstChild(m, "TileWidth"))),
        tileHeight: Number(text(firstChild(m, "TileHeight"))),
      };
    }),
  };
}

export function parseWmtsCapabilities(xml: string): WmtsCapabilities {
  const doc = parseXml(xml);
  const contents = descendants(doc, "Contents")[0];
  const sets = new Map<string, WmtsMatrixSet>();
  // The matrix sets are children of Contents; a layer's links name them.
  for (const el of contents ? childElements(contents, "TileMatrixSet") : []) {
    const set = parseSet(el);
    if (set.id) sets.set(set.id, set);
  }
  const layers = (contents ? childElements(contents, "Layer") : []).map(parseLayer).filter((l): l is WmtsLayer => !!l);
  const getTile = descendants(doc, "Operation").find((op) => op.getAttribute("name") === "GetTile");
  const getTileUrl = href(getTile ? descendants(getTile, "Get")[0] : null).replace(/[?&]+$/, "") || null;
  return { getTileUrl, sets, layers };
}

/** Scale denominator of zoom 0 of Web Mercator's 256 px tiles (OGC's 0.28 mm pixel). */
const ZOOM0_SCALE = 559082264.0287178;
const WORLD = 20037508.342789244;

/** Web Mercator under its codes, plain or as an OGC URN (`urn:ogc:def:crs:EPSG:6.18.3:3857`). */
function isWebMercator(crs: string): boolean {
  return /(?:^|[:/])(3857|900913|102100|102113|3785)$/.test(crs.trim());
}

/**
 * The zoom level of each matrix of a Web Mercator set, and the part of the
 * matrix ids before the zoom (`EPSG:900913:` in GeoWebCache, "" in ArcGIS).
 * Null when the set is not Web Mercator; `matrix-ids` when it is, but its
 * ids are not "prefix + zoom" (zero-padded, or named).
 */
export function webMercatorZooms(set: WmtsMatrixSet): { prefix: string; zooms: Map<string, number> } | "matrix-ids" | null {
  if (!isWebMercator(set.crs) || !set.matrices.length) return null;
  const zooms = new Map<string, number>();
  for (const m of set.matrices) {
    if (m.tileWidth !== 256 || m.tileHeight !== 256) return null;
    // Servers round the corner differently (GeoWebCache: -2.003750834E7 2.0037508E7).
    if (Math.abs(m.topLeft[0] + WORLD) > 1 || Math.abs(m.topLeft[1] - WORLD) > 1) return null;
    const z = Math.round(Math.log2(ZOOM0_SCALE / m.scale));
    if (!(z >= 0 && z <= 30) || Math.abs((m.scale * 2 ** z) / ZOOM0_SCALE - 1) > 0.01) return null;
    zooms.set(m.id, z);
  }
  const [first, firstZoom] = zooms.entries().next().value!;
  if (!first.endsWith(String(firstZoom))) return "matrix-ids";
  const prefix = first.slice(0, first.length - String(firstZoom).length);
  // Zero-padded ids ("02", "03") would read as prefix "0": wrong from zoom 10.
  if (/\d$/.test(prefix)) return "matrix-ids";
  for (const [id, z] of zooms) if (id !== `${prefix}${z}`) return "matrix-ids";
  return { prefix, zooms };
}

function pickFormat(formats: string[]): string {
  return formats.find((f) => /png/i.test(f)) ?? formats.find((f) => /jpe?g/i.test(f)) ?? formats[0] ?? "image/png";
}

/**
 * How a layer is added: the Web Mercator set it is offered in (GoogleMapsCompatible
 * first), its `{z}/{x}/{y}` template (RESTful when the service gives one,
 * else KVP GetTile) and the zoom range it covers. Otherwise the reason and the
 * systems the layer is offered in.
 */
export function planWmtsLayer(caps: WmtsCapabilities, layer: WmtsLayer): WmtsPlan {
  const linked = layer.links.map((l) => ({ link: l, set: caps.sets.get(l.set) })).filter((l) => !!l.set);
  const systems = Array.from(new Set(linked.map((l) => l.set!.crs.replace(/^urn:ogc:def:crs:EPSG:[\d.]*:/i, "EPSG:"))));
  let reason: WmtsReason = "no-web-mercator";
  const candidates = linked
    .map(({ link, set }) => ({ link, set: set!, mercator: webMercatorZooms(set!) }))
    .filter((c) => {
      if (c.mercator === "matrix-ids") reason = "matrix-ids";
      return c.mercator && c.mercator !== "matrix-ids";
    })
    .sort((a, b) => Number(isGoogleMaps(b.set)) - Number(isGoogleMaps(a.set)));
  for (const { link, set, mercator } of candidates) {
    const { prefix, zooms } = mercator as { prefix: string; zooms: Map<string, number> };
    const covered = (link.limits ?? set.matrices.map((m) => m.id)).map((id) => zooms.get(id)).filter((z): z is number => z !== undefined);
    if (!covered.length) continue;
    const format = pickFormat(layer.formats.length ? layer.formats : layer.templates.map((t) => t.format));
    const template = tileTemplate(caps, layer, set.id, prefix, format);
    if (!template) {
      reason = "template";
      continue;
    }
    return { ok: true, set: set.id, template, minzoom: Math.min(...covered), maxzoom: Math.max(...covered), format };
  }
  return { ok: false, reason, systems };
}

function isGoogleMaps(set: WmtsMatrixSet): boolean {
  return /GoogleMapsCompatible/i.test(set.wellKnown) || /GoogleMapsCompatible/i.test(set.id);
}

/** The `{z}/{x}/{y}` template of a layer in one set, or null when it keeps a placeholder MapLibre cannot fill (`{Time}`). */
function tileTemplate(caps: WmtsCapabilities, layer: WmtsLayer, set: string, prefix: string, format: string): string | null {
  const rest = layer.templates.find((t) => t.format === format) ?? layer.templates[0];
  if (rest) {
    const filled = rest.template
      .replace(/\{Style\}/gi, encodeURIComponent(layer.style))
      .replace(/\{TileMatrixSet\}/gi, encodeURIComponent(set))
      .replace(/\{TileMatrix\}/gi, `${encodeURIComponent(prefix)}{z}`)
      .replace(/\{TileRow\}/gi, "{y}")
      .replace(/\{TileCol\}/gi, "{x}");
    return /\{(?![zxy]\})[^}]*\}/.test(filled) ? null : filled;
  }
  if (!caps.getTileUrl) return null;
  const params = [
    "SERVICE=WMTS",
    "REQUEST=GetTile",
    "VERSION=1.0.0",
    `LAYER=${encodeURIComponent(layer.name)}`,
    `STYLE=${encodeURIComponent(layer.style)}`,
    `TILEMATRIXSET=${encodeURIComponent(set)}`,
    `TILEMATRIX=${encodeURIComponent(prefix)}{z}`,
    "TILEROW={y}",
    "TILECOL={x}",
    `FORMAT=${encodeURIComponent(format)}`,
  ];
  return `${caps.getTileUrl}${caps.getTileUrl.includes("?") ? "&" : "?"}${params.join("&")}`;
}

/**
 * One tile of a template to test the service with: at the centre of the
 * extent, at the zoom where the extent spans a few tiles, inside the
 * layer's zoom range.
 */
export function wmtsProbeUrl(template: string, bbox: Bbox | null, minzoom: number, maxzoom: number): string {
  const [w, s, e, n] = bbox ?? [6.6, 36.6, 18.5, 47.1];
  const lon = (w + e) / 2;
  const lat = Math.max(-85, Math.min(85, (s + n) / 2));
  const span = Math.max(e - w, n - s, 1e-6);
  const z = Math.max(minzoom, Math.min(maxzoom, Math.floor(Math.log2(360 / span)) + 2));
  const count = 2 ** z;
  const x = Math.min(count - 1, Math.floor(((lon + 180) / 360) * count));
  const rad = (lat * Math.PI) / 180;
  const y = Math.min(count - 1, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * count));
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
