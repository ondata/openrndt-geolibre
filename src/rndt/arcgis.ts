import type { Bbox } from "./query";

/**
 * ArcGIS REST services (MapServer, ImageServer, FeatureServer). GeoLibre adds
 * them from its own Add Data dialog with a function plugins do not get; a
 * plugin gets the same result with a tile layer on the service's `export`
 * request and, for features, a GeoJSON layer from its `query` request.
 */

/** Kind of the ArcGIS REST links, as shown on the badges. */
export const ARCGIS_KIND = "ArcGIS REST";

export type ArcgisServiceType = "MapServer" | "ImageServer" | "FeatureServer";

const SERVICE_TYPES: ArcgisServiceType[] = ["MapServer", "ImageServer", "FeatureServer"];

export interface ArcgisUrl {
  /** The service root, e.g. `https://host/arcgis/rest/services/Folder/Name/MapServer`. */
  serviceUrl: string;
  type: ArcgisServiceType;
  /** Layer the link points to (`…/MapServer/3`), if any. */
  layerId: string | null;
}

/**
 * The parts of a link to an ArcGIS REST service or to one of its layers, null
 * for any other URL: `…/MapServer/WMSServer` and `…/MapServer/WMTS` are OGC
 * services, `…/services/…/MapServer` without `rest` is the SOAP endpoint.
 */
export function parseArcgisUrl(url: string): ArcgisUrl | null {
  const match =
    /^(https?:\/\/[^?#]+?\/rest\/services\/[^?#]+?)\/(MapServer|ImageServer|FeatureServer)(?:\/(\d+))?\/?(?:[?#].*)?$/i.exec(
      url.trim(),
    );
  if (!match) return null;
  const type = SERVICE_TYPES.find((t) => t.toLowerCase() === match[2].toLowerCase())!;
  return { serviceUrl: `${match[1]}/${type}`, type, layerId: match[3] ?? null };
}

/** The ArcGIS REST service a WMTS link belongs to (`…/MapServer/WMTS…`), or null. */
export function arcgisRestFromWmts(url: string): string | null {
  const match = /^(https?:\/\/[^?#]+?\/rest\/services\/[^?#]+?\/(?:MapServer|ImageServer))\/WMTS(?:[/?#]|$)/i.exec(url);
  return match ? match[1] : null;
}

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});

/**
 * ArcGIS answers its errors with HTTP 200 and `{"error": {"code", "message"}}`:
 * 499 is a service that needs a login, 404 and 500 one that is gone.
 */
export function throwArcgisError(json: unknown): void {
  const error = asObject(json).error;
  if (!error) return;
  const { code, message } = asObject(error);
  const text = typeof message === "string" && message.trim() ? message.trim() : "no message";
  throw new Error(`the server answers ${typeof code === "number" ? `${code}, ` : ""}"${text}"${code === 499 ? " (the service needs a login)" : ""}`);
}

const listed = (value: unknown): string[] =>
  typeof value === "string" ? value.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean) : [];

export interface ArcgisService {
  /**
   * Layers that hold data (group layers left out); the name is the layer id.
   * Scales are ArcGIS's: `minScale` the farthest the layer is drawn, `maxScale`
   * the closest, 0 for no limit.
   */
  layers: { name: string; title: string; minScale: number; maxScale: number; hasFeatures: boolean }[];
  /** The service draws images (`export` or `exportImage`). */
  drawsImage: boolean;
  /** The service has `query`, but GeoJSON came with ArcGIS 10.4. */
  hasQuery: boolean;
  /** Features can be asked in GeoJSON. */
  hasGeoJson: boolean;
  copyright: string;
}

/** What a service offers, from its `?f=json` description. */
export function parseArcgisService(json: unknown, type: ArcgisServiceType): ArcgisService {
  throwArcgisError(json);
  const info = asObject(json);
  const capabilities = listed(info.capabilities);
  const layers = (Array.isArray(info.layers) ? info.layers : [])
    .map(asObject)
    .filter((l) => typeof l.id === "number" && !(Array.isArray(l.subLayerIds) && l.subLayerIds.length) && l.type !== "Group Layer")
    .map((l) => ({
      name: String(l.id),
      title: typeof l.name === "string" ? l.name : "",
      minScale: typeof l.minScale === "number" ? l.minScale : 0,
      maxScale: typeof l.maxScale === "number" ? l.maxScale : 0,
      // A raster layer of a MapServer draws, but has no features to query.
      hasFeatures: typeof l.type !== "string" || l.type === "Feature Layer",
    }));
  const hasQuery = type !== "ImageServer" && capabilities.includes("query");
  return {
    layers,
    // Old servers leave `capabilities` out: a MapServer draws maps anyway.
    drawsImage: type !== "FeatureServer" && (!capabilities.length || capabilities.includes(type === "MapServer" ? "map" : "image")),
    hasQuery,
    hasGeoJson: hasQuery && listed(info.supportedQueryFormats).includes("geojson"),
    copyright: typeof info.copyrightText === "string" ? info.copyrightText.trim() : "",
  };
}

/**
 * The image request of a service: `export` (MapServer) or `exportImage`
 * (ImageServer) in EPSG:3857, as GeoLibre's own ArcGIS layers ask it. `bbox`
 * is MapLibre's `{bbox-epsg-3857}` placeholder for a tile layer, or four
 * numbers for a single request.
 */
export function arcgisExportUrl(service: ArcgisUrl, layerId: string | null, bbox: string, size: number): string {
  const image = service.type === "ImageServer";
  const params = [
    `bbox=${bbox}`,
    "bboxSR=3857",
    "imageSR=3857",
    `size=${size}%2C${size}`,
    "format=png32",
    "transparent=true",
    ...(image ? [] : ["dpi=96"]),
    ...(!image && layerId !== null ? [`layers=show%3A${layerId}`] : []),
    "f=image",
  ];
  return `${service.serviceUrl}/${image ? "exportImage" : "export"}?${params.join("&")}`;
}

export interface ArcgisLayerInfo {
  /** Features the server returns for one request. */
  pageSize: number;
  /** The layer takes `resultOffset`: its features can be read page by page. */
  paginates: boolean;
  geoJson: boolean;
}

/** What a layer's `query` can do, from its `?f=json` description. */
export function parseArcgisLayer(json: unknown): ArcgisLayerInfo {
  throwArcgisError(json);
  const info = asObject(json);
  const max = info.maxRecordCount;
  return {
    pageSize: typeof max === "number" && max > 0 ? max : 1000,
    paginates: asObject(info.advancedQueryCapabilities).supportsPagination === true,
    geoJson: listed(info.supportedQueryFormats).includes("geojson"),
  };
}

/**
 * A `query` on a layer for all its features, or those touching `bbox`
 * (WGS84): their count, or the features in GeoJSON (WGS84), one page when
 * `offset` is given.
 */
export function arcgisQueryUrl(
  layerUrl: string,
  options: { bbox?: Bbox | null; count?: boolean; offset?: number; limit?: number },
): string {
  const params = new URLSearchParams({ where: "1=1" });
  if (options.bbox) {
    params.set("geometry", options.bbox.join(","));
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }
  if (options.count) {
    params.set("returnCountOnly", "true");
    params.set("f", "json");
  } else {
    params.set("outFields", "*");
    params.set("outSR", "4326");
    if (options.offset !== undefined) params.set("resultOffset", String(options.offset));
    if (options.limit !== undefined) params.set("resultRecordCount", String(options.limit));
    params.set("f", "geojson");
  }
  return `${layerUrl}/query?${params.toString()}`;
}

/** The count of a `returnCountOnly` answer, null when it holds none. */
export function parseArcgisCount(json: unknown): number | null {
  throwArcgisError(json);
  const count = asObject(json).count;
  return typeof count === "number" ? count : null;
}

/**
 * When a layer is drawn only at some scales, say which: a layer limited to
 * 1:50,000 and closer shows nothing at regional zoom, and looks broken.
 */
export function scaleNote(layer: { minScale: number; maxScale: number }): string | null {
  const scale = (n: number) => `1:${Math.round(n).toLocaleString("en")}`;
  if (layer.minScale > 0 && layer.maxScale > 0) return `Drawn only between ${scale(layer.minScale)} and ${scale(layer.maxScale)}.`;
  if (layer.minScale > 0) return `Drawn only at ${scale(layer.minScale)} and closer: zoom in to see it.`;
  if (layer.maxScale > 0) return `Drawn only up to ${scale(layer.maxScale)}.`;
  return null;
}
