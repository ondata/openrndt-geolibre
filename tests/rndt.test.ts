import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RNDT_BASE_URL } from "../src/rndt/constants";
import {
  buildGetFeatureUrl,
  capabilitiesUrl,
  fixAxisOrder,
  parseWfsCapabilities,
  parseWmsCapabilities,
  pickJsonFormat,
  preselectedName,
  supportsWebMercator,
} from "../src/rndt/ogc";
import { buildCurlCommand, buildQuery, buildSearchUrl, clampBbox, emptyForm, type Bbox, type SearchForm } from "../src/rndt/query";
import { extractServices, footprints, inferKind, parseSearchResponse } from "../src/rndt/records";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

interface QueryCase {
  name: string;
  form: Partial<SearchForm>;
  expected: Record<string, unknown>;
}
const queries = JSON.parse(fixture("queries.json")) as {
  cases: QueryCase[];
  errors: { name: string; form: Partial<SearchForm>; message: string }[];
};

describe("buildQuery (shared fixtures)", () => {
  for (const c of queries.cases) {
    it(c.name, () => {
      expect(buildQuery({ ...emptyForm(), ...c.form })).toEqual(c.expected);
    });
  }
  for (const c of queries.errors) {
    it(`rejects: ${c.name}`, () => {
      expect(() => buildQuery({ ...emptyForm(), ...c.form })).toThrow(c.message);
    });
  }
});

describe("buildSearchUrl", () => {
  it("encodes q, paging and JSON format", () => {
    const url = new URL(buildSearchUrl(`${RNDT_BASE_URL}/`, { ...emptyForm(), text: "alberi" }, 21, 20));
    expect(url.pathname).toBe("/RNDT/rest/metadata/search");
    expect(url.searchParams.get("q")).toBe("(alberi)");
    expect(url.searchParams.get("start")).toBe("21");
    expect(url.searchParams.get("num")).toBe("20");
    expect(url.searchParams.get("f")).toBe("json");
  });

  it("omits q for an empty form", () => {
    expect(new URL(buildSearchUrl(RNDT_BASE_URL, emptyForm(), 1, 20)).searchParams.has("q")).toBe(false);
  });

  it("builds a curl command with the same parameters", () => {
    const form = { ...emptyForm(), text: "l'acqua", bbox: [12.95, 37.6, 14.3, 38.3] as Bbox, sort: "title:asc" };
    const command = buildCurlCommand(RNDT_BASE_URL, form, 21, 20);
    // Undo the shell quoting and compare with the URL the panel requests.
    const pairs = [...command.matchAll(/--data-urlencode '((?:[^']|'\\'')*)'/g)].map((m) =>
      m[1].replaceAll("'\\''", "'"),
    );
    const url = new URL(buildSearchUrl(RNDT_BASE_URL, form, 21, 20));
    expect(pairs).toEqual([...url.searchParams].map(([k, v]) => `${k}=${v}`));
    expect(command.startsWith(`curl -sG '${RNDT_BASE_URL}/rest/metadata/search'`)).toBe(true);
    expect(command).toContain("'q=(l'\\''acqua)'");
  });

  it("clamps a zoomed-out view box", () => {
    expect(clampBbox([-250, -95, 250, 95])).toEqual([-180, -90, 180, 90]);
  });
});

describe("search results", () => {
  it("parses records from a real response", () => {
    const page = parseSearchResponse(JSON.parse(fixture("search-alberi.json")), RNDT_BASE_URL);
    expect(page.total).toBe(41);
    expect(page.records).toHaveLength(5);
    const first = page.records[0];
    expect(first.title).toBe("Ppr - Alberi monumentali (tav. P2)");
    expect(first.organisation).toBe("Regione Piemonte");
    expect(first.type).toBe("dataset");
    expect(first.bbox).toEqual([6.62, 44.06, 9.21, 46.459999084472656]);
    expect(first.htmlUrl).toBe(
      "https://geodati.gov.it/RNDT/rest/metadata/item/r_piemon%3A0cdd5f07-b835-4a23-92d7-c571761bf0e8/html",
    );
    // links_s: web pages are dropped, the zip is a download.
    expect(first.services).toEqual([
      {
        kind: "download",
        url: "https://www.datigeo-piem-download.it/direct/Geoportale/RegionePiemonte/PPR/alberi_monumentali.zip",
      },
    ]);
  });

  it("takes WMS links from resources_nst and dedupes them", () => {
    const page = parseSearchResponse(JSON.parse(fixture("search-services.json")), RNDT_BASE_URL);
    const withWms = page.records.find((r) => r.services.some((s) => s.kind === "WMS"));
    expect(withWms).toBeDefined();
    const urls = withWms!.services.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("infers kinds from URLs", () => {
    expect(inferKind("https://x.it/geoserver/ows?service=wfs&request=GetCapabilities")).toBe("WFS");
    expect(inferKind("https://x.it/cgi/wms?")).toBe("WMS");
    expect(inferKind("https://x.it/data/file.geojson")).toBe("download");
    expect(inferKind("https://x.it/page.html")).toBe("link");
    expect(extractServices({ _source: { links_s: ["https://x.it/page.html"] } })).toEqual([]);
  });

  it("builds one footprint polygon per record with a bbox", () => {
    const page = parseSearchResponse(JSON.parse(fixture("search-alberi.json")), RNDT_BASE_URL);
    const fc = footprints(page.records);
    expect(fc.features.length).toBe(page.records.filter((r) => r.bbox).length);
    expect(fc.features[0].geometry).toEqual({
      type: "Polygon",
      coordinates: [[[6.62, 44.06], [9.21, 44.06], [9.21, 46.459999084472656], [6.62, 46.459999084472656], [6.62, 44.06]]],
    });
  });
});

describe("WMS capabilities", () => {
  it("parses a WMS 1.1.1 with Web Mercator", () => {
    const caps = parseWmsCapabilities(fixture("wms-piemonte-111.xml"), "https://x.it/wms");
    expect(caps.version).toBe("1.1.1");
    expect(caps.getMapUrl).toBe(
      "https://geomap.reteunitaria.piemonte.it/ws/siccms/coto-01/wmsg01/wms_sicc18_microzone_censuarie?language=ita",
    );
    const names = caps.layers.map((l) => l.name);
    expect(names).toContain("Microzone");
    expect(names).not.toContain("default");
    expect(caps.layers.every(supportsWebMercator)).toBe(true);
  });

  it("flags a WMS 1.3.0 without EPSG:3857 (cadastre)", () => {
    const caps = parseWmsCapabilities(fixture("wms-ade-130.xml"), "https://x.it/wms");
    expect(caps.version).toBe("1.3.0");
    expect(caps.layers.length).toBeGreaterThan(0);
    expect(caps.layers.some(supportsWebMercator)).toBe(false);
    expect(caps.layers[0].crs).toContain("EPSG:6706");
  });

  it("builds a GetCapabilities URL from any service URL", () => {
    const url = new URL(capabilitiesUrl("https://x.it/wms?service=WMS&version=1.1.1&request=getCapabilities&map=a", "WMS"));
    expect(url.searchParams.get("map")).toBe("a");
    expect(url.searchParams.get("REQUEST")).toBe("GetCapabilities");
    expect(url.searchParams.get("request")).toBeNull();
  });
});

describe("WFS capabilities", () => {
  const caps = parseWfsCapabilities(fixture("wfs-fvg-200.xml"), "https://x.it/wfs");

  it("parses version, GetFeature URL, formats and feature types", () => {
    expect(caps.version).toBe("2.0.0");
    expect(caps.getFeatureUrl).toBe("https://serviziogc.regione.fvg.it/geoserver/PPR/wfs");
    expect(pickJsonFormat(caps.outputFormats)).toBe("application/json");
    expect(caps.featureTypes.map((f) => f.name)).toContain("PPR:v_alberi_monumentali_e_notevoli");
    expect(caps.featureTypes[0].bbox).not.toBeNull();
  });

  it("builds a WFS 2.0 GetFeature with a lat/lon box", () => {
    const url = new URL(
      buildGetFeatureUrl(caps, "PPR:x", { format: "application/json", maxFeatures: 100, bbox: [13, 45.5, 13.5, 46] }),
    );
    expect(url.searchParams.get("TYPENAMES")).toBe("PPR:x");
    expect(url.searchParams.get("COUNT")).toBe("100");
    expect(url.searchParams.get("BBOX")).toBe("45.5,13,46,13.5,urn:ogc:def:crs:EPSG::4326");
  });

  it("reads the preselected feature type from a GetFeature link", () => {
    expect(
      preselectedName(
        "https://serviziogc.regione.fvg.it/geoserver/PPR/wfs?version=2.0.0&service=wfs&request=GetFeature&typeName=PPR:v_alberi_monumentali_e_notevoli",
      ),
    ).toBe("PPR:v_alberi_monumentali_e_notevoli");
  });

  it("swaps lat/lon coordinates back to lon/lat", () => {
    const fc = fixAxisOrder({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [45.6, 13.7] } }],
    });
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [13.7, 45.6] });
    const ok = fixAxisOrder({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [13.7, 45.6] } }],
    });
    expect(ok.features[0].geometry).toEqual({ type: "Point", coordinates: [13.7, 45.6] });
  });
});

describe("bestMatchingLayer", () => {
  it("picks the layer sharing most words with the record title", async () => {
    const { bestMatchingLayer } = await import("../src/rndt/ogc");
    const layers = [
      { name: "v_aggiornamenti_ppr", title: "v_aggiornamenti_ppr" },
      { name: "v_alberi_monumentali_e_notevoli", title: "v_alberi_monumentali_e_notevoli" },
    ];
    expect(bestMatchingLayer("PPR - Alberi Monumentali e Notevoli", layers)).toBe("v_alberi_monumentali_e_notevoli");
    expect(bestMatchingLayer("Carta geologica", layers)).toBeNull();
  });

  it("drops operation parameters from the advertised GetMap URL", () => {
    const xml = `<WMS_Capabilities version="1.3.0"><Capability><Request><GetMap><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://x.it/ows?SERVICE=WMS&amp;"/></Get></HTTP></DCPType></GetMap></Request><Layer><Name>a</Name><CRS>EPSG:3857</CRS></Layer></Capability></WMS_Capabilities>`;
    expect(parseWmsCapabilities(xml, "https://x.it/ows").getMapUrl).toBe("https://x.it/ows");
  });
});

describe("data downloads", () => {
  const base = { addMapControl: () => true, removeMapControl: () => undefined };

  it("uses the long-budget vector downloader for downloads when present", async () => {
    const { fetchJson } = await import("../src/rndt/host");
    const vector: string[] = [];
    const small: string[] = [];
    const host = {
      ...base,
      fetchVectorUrl: async (url: string) => {
        vector.push(url);
        return new File(['{"type":"FeatureCollection","features":[]}'], "x.json");
      },
      fetchArrayBuffer: async (url: string) => {
        small.push(url);
        return new TextEncoder().encode("{}").buffer as ArrayBuffer;
      },
    };
    await fetchJson(host, "https://x.it/wfs?a=1", { download: true });
    await fetchJson(host, "https://x.it/search");
    expect(vector).toEqual(["https://x.it/wfs?a=1"]);
    expect(small).toEqual(["https://x.it/search"]);
  });

  it("reports a download the host could not serve", async () => {
    const { fetchJson } = await import("../src/rndt/host");
    const host = { ...base, fetchVectorUrl: async () => null };
    await expect(fetchJson(host, "https://x.it/wfs", { download: true })).rejects.toThrow(
      /cannot reach x\.it: download failed/,
    );
  });
});

describe("HTTP to HTTPS", () => {
  it("tries https first for an http link, then falls back to http", async () => {
    const { fetchTextFrom } = await import("../src/rndt/host");
    const seen: string[] = [];
    const host = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      fetchArrayBuffer: async (url: string) => {
        seen.push(url);
        if (url.startsWith("https:")) throw new Error("tls");
        return new TextEncoder().encode("ok").buffer as ArrayBuffer;
      },
    };
    const result = await fetchTextFrom(host, "http://x.it/wms");
    expect(seen).toEqual(["https://x.it/wms", "http://x.it/wms"]);
    expect(result).toEqual({ text: "ok", url: "http://x.it/wms" });
  });

  it("reports both attempts when a host is unreachable", async () => {
    const { fetchTextFrom } = await import("../src/rndt/host");
    const host = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      fetchArrayBuffer: async () => {
        throw new Error("timeout");
      },
    };
    await expect(fetchTextFrom(host, "http://x.it/wms")).rejects.toThrow("cannot reach x.it (tried HTTPS and HTTP): timeout");
  });

  it("upgrades same-host operation URLs when capabilities came over https", async () => {
    const { upgradeToHttps } = await import("../src/rndt/ogc");
    expect(upgradeToHttps("http://x.it/wfs", "https://x.it/wfs?REQUEST=GetCapabilities")).toBe("https://x.it/wfs");
    expect(upgradeToHttps("http://y.it/wfs", "https://x.it/wfs")).toBe("http://y.it/wfs");
    expect(upgradeToHttps("http://x.it/wfs", "http://x.it/wfs")).toBe("http://x.it/wfs");
  });
});
