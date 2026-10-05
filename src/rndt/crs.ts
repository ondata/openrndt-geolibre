import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type * as Proj4 from "proj4";

/**
 * GeoLibre's own proj4 (`app.getProj4`, GeoLibre 3.3.0): the plugin carries no
 * copy. It resolves to the module namespace; the callable library is `default`.
 */
export type GetProj4 = () => Promise<typeof Proj4>;

/**
 * GeoJSON is WGS84 longitude/latitude (RFC 7946), but Italian publishers
 * still serve files with the old `crs` member and projected coordinates
 * (datigis.comune.fi.it: EPSG:3003, positions like 1684025, 4847704,
 * 2026-10-02). GeoLibre reads them as degrees and draws nothing, so the
 * plugin converts them first. Definitions from epsg.io, for the systems
 * Italian data come in.
 */
const DEFINITIONS: Record<number, string> = {
  // Monte Mario / Italy zone 1 and 2 (Gauss-Boaga)
  3003: "+proj=tmerc +lat_0=0 +lon_0=9 +k=0.9996 +x_0=1500000 +y_0=0 +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs",
  3004: "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=2520000 +y_0=0 +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs",
  // Monte Mario geographic
  4265: "+proj=longlat +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +no_defs",
  // ED50 geographic and UTM 32N/33N
  4230: "+proj=longlat +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +no_defs",
  23032: "+proj=utm +zone=32 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs",
  23033: "+proj=utm +zone=33 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs",
  // ETRS89 and RDN2008 UTM 32N/33N (the same grid under several codes)
  25832: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  25833: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  3044: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  3045: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  6707: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  6708: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  7791: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  7792: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  // WGS84 UTM 32N/33N
  32632: "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs",
  32633: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  // Web Mercator
  3857: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs",
  900913: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs",
};

/** Geographic systems that GeoLibre can take as they are (ETRS89 and WGS84 agree to the metre). */
const AS_IS = new Set([4326, 4258, 6706, 4979, 4937]);

/** The EPSG code the file declares in its `crs` member, 0 for CRS84, null when it declares none. */
export function declaredEpsg(fc: FeatureCollection): number | null {
  const crs = (fc as { crs?: { properties?: { name?: unknown; code?: unknown } } }).crs;
  const name = crs?.properties?.name;
  if (typeof name !== "string") return typeof crs?.properties?.code === "number" ? crs.properties.code : null;
  if (/CRS84$/i.test(name)) return 0;
  const m = /EPSG:(?::\d+(?:\.\d+)?:)?:?(\d+)$/i.exec(name) ?? /\bEPSG::?(\d+)\b/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * The collection in WGS84, with the code it was converted from (null when it
 * already was longitude/latitude). Throws, with the reason, for a system the
 * plugin has no definition of, for projected coordinates with no `crs`, and
 * for a host that gives plugins no proj4. proj4 is asked only to convert.
 */
export async function toWgs84(
  fc: FeatureCollection,
  getProj4: GetProj4 | undefined,
): Promise<{ fc: FeatureCollection; from: number | null }> {
  const code = declaredEpsg(fc);
  if (code === 0 || (code !== null && AS_IS.has(code))) return { fc: stripCrs(fc), from: null };
  if (code === null) {
    const first = fc.features.map((f) => firstPosition(f.geometry)).find(Boolean);
    if (first && (Math.abs(first[0]) > 180 || Math.abs(first[1]) > 90)) {
      throw new Error(
        `the coordinates are not longitude/latitude (first position ${first[0]}, ${first[1]}) and the file declares no system`,
      );
    }
    return { fc, from: null };
  }
  const definition = DEFINITIONS[code];
  if (!definition) throw new Error(`the coordinates are in EPSG:${code}, a system the plugin cannot convert`);
  if (!getProj4) throw new Error(`the coordinates are in EPSG:${code}, and this GeoLibre gives plugins no proj4 to convert them`);
  // Definitions are passed as strings, never registered: the host's registry is shared.
  const convert = (await getProj4()).default(definition, "WGS84").forward;
  const mapped: FeatureCollection = {
    ...stripCrs(fc),
    features: fc.features.map((f: Feature) => ({ ...f, geometry: mapGeometry(f.geometry, convert) as Geometry })),
  };
  return { fc: mapped, from: code };
}

function stripCrs(fc: FeatureCollection): FeatureCollection {
  const copy: FeatureCollection & { crs?: unknown } = { ...fc };
  delete copy.crs;
  return copy;
}

function mapGeometry(geometry: Geometry | null, convert: (p: [number, number]) => [number, number]): Geometry | null {
  if (!geometry) return geometry;
  if (geometry.type === "GeometryCollection") {
    return { ...geometry, geometries: geometry.geometries.map((g) => mapGeometry(g, convert) as Geometry) };
  }
  return { ...geometry, coordinates: mapPositions(geometry.coordinates, convert) } as Geometry;
}

function mapPositions(coords: unknown, convert: (p: [number, number]) => [number, number]): unknown {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    const [x, y, ...rest] = coords as number[];
    const [lon, lat] = convert([x, y]);
    return [lon, lat, ...rest];
  }
  return Array.isArray(coords) ? coords.map((c) => mapPositions(c, convert)) : coords;
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
