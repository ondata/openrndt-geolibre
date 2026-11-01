import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWmtsCapabilities, planWmtsLayer, webMercatorZooms, wmtsCapabilitiesUrl, wmtsProbeUrl, type WmtsMatrixSet } from "../src/rndt/wmts";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("wmtsCapabilitiesUrl", () => {
  it("keeps a static document and asks an endpoint with KVP", () => {
    const xml = "https://geomap.reteunitaria.piemonte.it/WEBCAT/CAPABILITIES/wmts_regp_basecarto10bn_2023.xml";
    expect(wmtsCapabilitiesUrl(xml)).toBe(xml);
    expect(wmtsCapabilitiesUrl("https://geoportale.agea.gov.it/image/rest/services/AgEA/Ortofoto_AgEA_2022/ImageServer/WMTS?")).toBe(
      "https://geoportale.agea.gov.it/image/rest/services/AgEA/Ortofoto_AgEA_2022/ImageServer/WMTS?SERVICE=WMTS&REQUEST=GetCapabilities",
    );
    expect(wmtsCapabilitiesUrl("https://idt2.regione.veneto.it/gwc/service/wmts?service=WMTS&request=GetCapabilities&version=1.0.0")).toBe(
      "https://idt2.regione.veneto.it/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
    );
  });
});

describe("ArcGIS ImageServer WMTS (AgEA 2022)", () => {
  const caps = parseWmtsCapabilities(fixture("wmts-agea-arcgis.xml"));
  const layer = caps.layers[0];

  it("reads the layer, its sets and its RESTful template", () => {
    expect(caps.layers).toHaveLength(1);
    expect(layer.name).toBe("AgEA_Ortofoto_AgEA_2022");
    expect(layer.style).toBe("default");
    expect(layer.bbox?.map((v) => Math.round(v))).toEqual([7, 35, 19, 45]);
    expect([...caps.sets.keys()]).toEqual(["default028mm", "GoogleMapsCompatible"]);
  });

  it("adds it from GoogleMapsCompatible, the tiles measured on 2026-11-01", () => {
    const plan = planWmtsLayer(caps, layer);
    expect(plan).toMatchObject({ ok: true, set: "GoogleMapsCompatible", minzoom: 0, maxzoom: 18 });
    if (!plan.ok) return;
    expect(plan.template).toBe(
      "https://geoportale.agea.gov.it/image/rest/services/AgEA/Ortofoto_AgEA_2022/ImageServer/WMTS/tile/1.0.0/AgEA_Ortofoto_AgEA_2022/default/GoogleMapsCompatible/{z}/{y}/{x}",
    );
  });

  it("probes a tile over the layer's extent", () => {
    const plan = planWmtsLayer(caps, layer);
    if (!plan.ok) throw new Error("not addable");
    expect(wmtsProbeUrl(plan.template, [11.3, 43.3, 11.36, 43.34], plan.minzoom, plan.maxzoom)).toMatch(/GoogleMapsCompatible\/14\/6000\/8707$/);
  });
});

describe("GeoWebCache WMTS, KVP only (Veneto)", () => {
  const caps = parseWmtsCapabilities(fixture("wmts-veneto-gwc.xml"));

  it("reads the GetTile endpoint and skips links to sets it does not list", () => {
    expect(caps.getTileUrl).toBe("http://idt2.regione.veneto.it/gwc/service/wmts");
    expect(caps.layers.map((l) => l.name)).toEqual(["rv:ctr_128_bicubic", "rv:OrthoPhoto_2015_pyramid"]);
    expect([...caps.sets.keys()].sort()).toEqual(["EPSG:32632", "EPSG:900913"]);
  });

  it("adds from EPSG:900913 with KVP, matrix ids EPSG:900913:<z>, zooms from the limits", () => {
    const plan = planWmtsLayer(caps, caps.layers[1]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.set).toBe("EPSG:900913");
    expect(plan.format).toBe("image/jpeg");
    expect(plan.template).toBe(
      "http://idt2.regione.veneto.it/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=rv%3AOrthoPhoto_2015_pyramid&STYLE=&TILEMATRIXSET=EPSG%3A900913&TILEMATRIX=EPSG%3A900913%3A{z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg",
    );
    expect(plan.minzoom).toBe(0);
    expect(plan.maxzoom).toBeGreaterThan(15);
  });
});

describe("MapProxy WMTS in UTM only (Piemonte)", () => {
  it("is not addable, with the systems it is offered in", () => {
    const caps = parseWmtsCapabilities(fixture("wmts-piemonte-mapproxy.xml"));
    expect(planWmtsLayer(caps, caps.layers[0])).toEqual({ ok: false, reason: "no-web-mercator", systems: ["EPSG:32632"] });
  });
});

describe("webMercatorZooms", () => {
  const set = (ids: string[], over: Partial<WmtsMatrixSet> = {}): WmtsMatrixSet => ({
    id: "s",
    crs: "urn:ogc:def:crs:EPSG::3857",
    wellKnown: "",
    matrices: ids.map((id, z) => ({ id, scale: 559082264.0287178 / 2 ** (z + 2), topLeft: [-20037508.34, 20037508.34], tileWidth: 256, tileHeight: 256 })),
    ...over,
  });

  it("maps ids to zooms from any starting level", () => {
    expect(webMercatorZooms(set(["2", "3", "4"]))).toEqual({ prefix: "", zooms: new Map([["2", 2], ["3", 3], ["4", 4]]) });
  });

  it("tells ids that are not prefix + zoom", () => {
    expect(webMercatorZooms(set(["02", "03"]))).toBe("matrix-ids");
  });

  it("refuses other systems and tile sizes", () => {
    expect(webMercatorZooms(set(["2"], { crs: "EPSG:32632" }))).toBeNull();
    const big = set(["2"]);
    big.matrices[0].tileWidth = 512;
    expect(webMercatorZooms(big)).toBeNull();
  });
});

describe("planWmtsLayer", () => {
  it("refuses a template with a placeholder MapLibre cannot fill", () => {
    const caps = parseWmtsCapabilities(fixture("wmts-agea-arcgis.xml"));
    const layer = { ...caps.layers[0], templates: [{ format: "image/png", template: "https://x/{Time}/{TileMatrix}/{TileRow}/{TileCol}" }] };
    expect(planWmtsLayer(caps, layer)).toMatchObject({ ok: false, reason: "template" });
  });
});
