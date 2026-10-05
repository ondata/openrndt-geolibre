import type { FeatureCollection } from "geojson";
import { describe, expect, it, vi } from "vitest";
import { declaredEpsg, toWgs84 as convert } from "../src/rndt/crs";

// GeoLibre resolves its proj4 module namespace (callable as `default`); here the same, from the dev dependencies.
const hostProj4 = () => import("proj4");
const toWgs84 = (fc: FeatureCollection) => convert(fc, hostProj4);

const collection = (crsName: string | null, coordinates: number[]): FeatureCollection =>
  ({
    type: "FeatureCollection",
    ...(crsName ? { crs: { type: "name", properties: { name: crsName } } } : {}),
    features: [{ type: "Feature", properties: { a: 1 }, geometry: { type: "Point", coordinates } }],
  }) as FeatureCollection;

const point = (fc: FeatureCollection) => (fc.features[0].geometry as { coordinates: number[] }).coordinates;

describe("GeoJSON in a projected system", () => {
  it("reads the EPSG code from the crs member, in its urn and plain forms", () => {
    expect(declaredEpsg(collection("urn:ogc:def:crs:EPSG::3003", [0, 0]))).toBe(3003);
    expect(declaredEpsg(collection("EPSG:25832", [0, 0]))).toBe(25832);
    expect(declaredEpsg(collection("urn:ogc:def:crs:OGC:1.3:CRS84", [0, 0]))).toBe(0);
    expect(declaredEpsg(collection(null, [0, 0]))).toBeNull();
  });

  it("converts Gauss-Boaga (EPSG:3003) to longitude/latitude: a Florence tram site (datigis.comune.fi.it)", async () => {
    const { fc, from } = await toWgs84(collection("urn:ogc:def:crs:EPSG::3003", [1684025.02199723, 4847704.06671932]));
    expect(from).toBe(3003);
    const [lon, lat] = point(fc);
    expect(lon).toBeCloseTo(11.2857, 3);
    expect(lat).toBeCloseTo(43.7594, 3);
    expect((fc as { crs?: unknown }).crs).toBeUndefined();
    expect(fc.features[0].properties).toEqual({ a: 1 });
  });

  it("converts UTM 32N (EPSG:25832 and 32632) too", async () => {
    expect(point((await toWgs84(collection("EPSG:25832", [500000, 4649776.22]))).fc)[0]).toBeCloseTo(9, 4);
    expect(point((await toWgs84(collection("EPSG:32632", [500000, 4649776.22]))).fc)[1]).toBeCloseTo(42, 2);
  });

  it("leaves WGS84, ETRS89 and CRS84 files as they are, without asking for proj4", async () => {
    const getProj4 = vi.fn(hostProj4);
    for (const name of ["urn:ogc:def:crs:EPSG::4326", "EPSG:4258", "urn:ogc:def:crs:OGC:1.3:CRS84", null]) {
      const { fc, from } = await convert(collection(name, [12.5, 41.9]), getProj4);
      expect(from).toBeNull();
      expect(point(fc)).toEqual([12.5, 41.9]);
    }
    expect(getProj4).not.toHaveBeenCalled();
  });

  it("refuses a system it has no definition of, and projected coordinates with no crs", async () => {
    await expect(toWgs84(collection("EPSG:2154", [700000, 6600000]))).rejects.toThrow(
      "the coordinates are in EPSG:2154, a system the plugin cannot convert",
    );
    await expect(toWgs84(collection(null, [1684025, 4847704]))).rejects.toThrow(
      "the coordinates are not longitude/latitude (first position 1684025, 4847704) and the file declares no system",
    );
  });

  it("says so when the host gives plugins no proj4", async () => {
    await expect(convert(collection("EPSG:3003", [1684025, 4847704]), undefined)).rejects.toThrow(
      "the coordinates are in EPSG:3003, and this GeoLibre gives plugins no proj4 to convert them",
    );
  });
});
