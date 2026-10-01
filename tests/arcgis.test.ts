import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arcgisExportUrl,
  arcgisQueryUrl,
  arcgisRestFromWmts,
  parseArcgisCount,
  parseArcgisLayer,
  parseArcgisService,
  parseArcgisUrl,
  scaleNote,
} from "../src/rndt/arcgis";
import { buildQuery, emptyForm } from "../src/rndt/query";
import { extractOtherLinks, extractServices, inferKind } from "../src/rndt/records";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const ARPAE = "https://servizi-gis.arpae.it/server/rest/services/Geoportal/ACQUEPressioni/MapServer";

describe("ArcGIS REST links", () => {
  it("reads service, type and layer from a link", () => {
    expect(parseArcgisUrl(ARPAE)).toEqual({ serviceUrl: ARPAE, type: "MapServer", layerId: null });
    expect(parseArcgisUrl(`${ARPAE}/3?f=json`)).toEqual({ serviceUrl: ARPAE, type: "MapServer", layerId: "3" });
    expect(parseArcgisUrl("http://x.it/arcgis/rest/services/A/B/imageserver/")).toEqual({
      serviceUrl: "http://x.it/arcgis/rest/services/A/B/ImageServer",
      type: "ImageServer",
      layerId: null,
    });
    expect(parseArcgisUrl("https://x.it/arcgis/rest/services/A/FeatureServer/0")?.type).toBe("FeatureServer");
  });

  it("leaves out the OGC services under it and the SOAP endpoint", () => {
    expect(parseArcgisUrl(`${ARPAE}/WMTS/1.0.0/WMTSCapabilities.xml`)).toBeNull();
    expect(parseArcgisUrl("https://x.it/arcgis/services/A/MapServer/WMSServer?")).toBeNull();
    expect(parseArcgisUrl("https://map.sitr.regione.sicilia.it/gis/services/modelli_digitali/slope_2008/MapServer")).toBeNull();
    expect(parseArcgisUrl(`${ARPAE}/info/thumbnail`)).toBeNull();
  });

  it("finds the REST service of an ArcGIS WMTS", () => {
    expect(arcgisRestFromWmts(`${ARPAE}/WMTS/1.0.0/WMTSCapabilities.xml`)).toBe(ARPAE);
    expect(arcgisRestFromWmts("https://x.it/geoserver/gwc/service/wmts")).toBeNull();
  });

  it("gives ArcGIS links their own kind, also when the catalogue says MapServer", () => {
    expect(inferKind(`${ARPAE}/1`)).toBe("ArcGIS REST");
    expect(inferKind(`${ARPAE}/WMTS/1.0.0/WMTSCapabilities.xml`)).toBe("WMTS");
    const result = {
      _source: {
        resources_nst: [
          { url_type_s: "MapServer", url_s: ARPAE },
          { url_type_s: "MapServer", url_s: `${ARPAE}/WMTS/1.0.0/WMTSCapabilities.xml` },
          { url_type_s: "MapServer", url_s: "https://map.sitr.regione.sicilia.it/gis/services/a/MapServer" },
        ],
      },
    };
    const services = extractServices(result);
    expect(services.map((s) => s.kind)).toEqual(["ArcGIS REST", "WMTS", "MapServer"]);
    expect(extractOtherLinks(result, services)).toEqual([]);
  });
});

describe("ArcGIS REST service description", () => {
  it("lists the layers and what the service offers", () => {
    const service = parseArcgisService(fixture("arcgis-arpae-mapserver.json"), "MapServer");
    expect(service.layers).toHaveLength(16);
    expect(service.layers[1]).toEqual({ name: "1", title: "Depuratori - ed.2023", minScale: 0, maxScale: 0, hasFeatures: true });
    expect(service).toMatchObject({ drawsImage: true, hasQuery: true, hasGeoJson: true, copyright: "" });
  });

  it("leaves out group layers, which draw their children", () => {
    const service = parseArcgisService(
      { capabilities: "Map", layers: [{ id: 0, name: "Fasce", subLayerIds: [1, 2] }, { id: 1, name: "A" }, { id: 2, name: "B", minScale: 50000 }] },
      "MapServer",
    );
    expect(service.layers.map((l) => l.name)).toEqual(["1", "2"]);
    const raster = parseArcgisService({ layers: [{ id: 0, name: "Radiazione", type: "Raster Layer" }] }, "MapServer");
    expect(raster.layers[0].hasFeatures).toBe(false);
    expect(service).toMatchObject({ hasQuery: false, hasGeoJson: false });
  });

  it("knows ArcGIS before 10.4 has no GeoJSON", () => {
    const service = parseArcgisService({ capabilities: "Map,Query,Data", supportedQueryFormats: "JSON, AMF", layers: [] }, "MapServer");
    expect(service).toMatchObject({ hasQuery: true, hasGeoJson: false });
  });

  it("turns an error answered with HTTP 200 into an error", () => {
    expect(() => parseArcgisService({ error: { code: 499, message: "Token Required", details: [] } }, "MapServer")).toThrow(
      'the server answers 499, "Token Required" (the service needs a login)',
    );
    expect(() => parseArcgisService({ error: { code: 500, message: "Service x/MapServer not found " } }, "MapServer")).toThrow(
      'the server answers 500, "Service x/MapServer not found"',
    );
  });

  it("says at which scales a layer is drawn", () => {
    expect(scaleNote({ minScale: 0, maxScale: 0 })).toBeNull();
    expect(scaleNote({ minScale: 50000, maxScale: 0 })).toBe("Drawn only at 1:50,000 and closer: zoom in to see it.");
    expect(scaleNote({ minScale: 100000, maxScale: 1000 })).toBe("Drawn only between 1:100,000 and 1:1,000.");
  });
});

describe("ArcGIS REST requests", () => {
  it("asks images in EPSG:3857, with MapLibre's bbox placeholder kept as it is", () => {
    const url = arcgisExportUrl({ serviceUrl: ARPAE, type: "MapServer", layerId: null }, "1", "{bbox-epsg-3857}", 256);
    expect(url.startsWith(`${ARPAE}/export?bbox={bbox-epsg-3857}&`)).toBe(true);
    const params = new URL(url.replace("{bbox-epsg-3857}", "0,0,1,1")).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ bboxSR: "3857", imageSR: "3857", size: "256,256", format: "png32", transparent: "true", layers: "show:1", f: "image" });
  });

  it("asks an ImageServer with exportImage, without layers", () => {
    const url = arcgisExportUrl({ serviceUrl: "https://x.it/rest/services/O/ImageServer", type: "ImageServer", layerId: null }, null, "1,2,3,4", 64);
    expect(url).toBe("https://x.it/rest/services/O/ImageServer/exportImage?bbox=1,2,3,4&bboxSR=3857&imageSR=3857&size=64%2C64&format=png32&transparent=true&f=image");
  });

  it("counts and downloads features in WGS84, page by page", () => {
    const count = new URL(arcgisQueryUrl(`${ARPAE}/1`, { count: true, bbox: [9, 44, 10, 45] }));
    expect(count.pathname.endsWith("/MapServer/1/query")).toBe(true);
    expect(Object.fromEntries(count.searchParams)).toEqual({
      where: "1=1",
      geometry: "9,44,10,45",
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      returnCountOnly: "true",
      f: "json",
    });
    const page = new URL(arcgisQueryUrl(`${ARPAE}/1`, { offset: 1000, limit: 1000 }));
    expect(Object.fromEntries(page.searchParams)).toEqual({
      where: "1=1",
      outFields: "*",
      outSR: "4326",
      resultOffset: "1000",
      resultRecordCount: "1000",
      f: "geojson",
    });
    expect(parseArcgisCount({ count: 2006 })).toBe(2006);
    expect(parseArcgisLayer(fixture("arcgis-arpae-layer.json"))).toEqual({ pageSize: 1000, paginates: true, geoJson: true });
  });
});

describe("Available as ArcGIS REST", () => {
  it("looks for REST services with a regular expression", () => {
    const { q } = buildQuery({ ...emptyForm(), availableAs: ["ArcGIS REST"] });
    expect(q).toBe("links_s:(/http.*\\/rest\\/services\\/.*(Map|Image|Feature)Server(\\/[0-9]+)?\\/?(\\?.*)?/)");
    const regex = new RegExp(`^${q!.slice("links_s:(/".length, -2)}$`);
    expect(regex.test(ARPAE)).toBe(true);
    expect(regex.test(`${ARPAE}/1?f=json`)).toBe(true);
    expect(regex.test(`${ARPAE}/WMTS/1.0.0/WMTSCapabilities.xml`)).toBe(false);
    expect(regex.test("https://x.it/arcgis/services/A/MapServer/WMSServer")).toBe(false);
  });

  it("joins the other kinds with OR", () => {
    const { q } = buildQuery({ ...emptyForm(), availableAs: ["WMS", "ArcGIS REST"] });
    expect(q).toMatch(/^links_s:\(http\*wms\* OR http\*WMS\* OR http\*Wms\* OR \/http/);
  });
});
