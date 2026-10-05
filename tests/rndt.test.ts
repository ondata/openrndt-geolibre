import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RNDT_BASE_URL } from "../src/rndt/constants";
import {
  buildGetFeatureUrl,
  buildHitsUrl,
  capabilitiesUrl,
  fixAxisOrder,
  parseHitsCount,
  parseWfsCapabilities,
  parseWmsCapabilities,
  pickWmsCrs,
  pickJsonFormat,
  preselectedName,
  supportsWebMercator,
} from "../src/rndt/ogc";
import { buildCurlCommand, buildQuery, buildSearchUrl, clampBbox, emptyForm, idForm, recordIdIn, type Bbox, type SearchForm } from "../src/rndt/query";
import { extractOtherLinks, extractServices, footprints, inferKind, parseSearchResponse, provenance } from "../src/rndt/records";

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
    // A capabilities document saved as a file is the service, not a download.
    expect(inferKind("https://geomap.reteunitaria.piemonte.it/WEBCAT/CAPABILITIES/wms_coto_ortofoto_2016.xml")).toBe("WMS");
    expect(inferKind("https://x.it/data/metadata.xml")).toBe("download");
    expect(inferKind("https://x.it/page.html")).toBe("link");
    // The page of a layer on a GeoNode is a web page, whatever words its address holds (#22).
    const page = "https://geoportale.regione.lazio.it/layers/httpsgeoserver-terrigregionelazioitgeoserverwebsitwms:pericolositap3p4(mg)";
    expect(inferKind(page)).toBe("link");
    expect(inferKind("https://geoportale.regione.lazio.it/layers/geodbgt:geonode:wms_diga_a")).toBe("link");
    // A service word inside another word of the path still tells a service (Piemonte).
    expect(inferKind("https://geomap.reteunitaria.piemonte.it/ws/taims/rp-01/taimswms/bdtre_veg?")).toBe("WMS");
    const wms = "https://geoserver-terrig.regione.lazio.it/geoserver/websit/ows?SERVICE=WMS&";
    const result = { _source: { resources_nst: [{ url_s: wms, url_type_s: "WMS" }], links_s: [page, wms] } };
    const services = extractServices(result);
    expect(services).toEqual([{ kind: "WMS", url: wms }]);
    expect(extractOtherLinks(result, services)).toEqual([page]);
    expect(extractServices({ _source: { links_s: ["https://x.it/page.html"] } })).toEqual([]);
  });

  it("gives a record's provenance for the layers added from it, without empty fields", () => {
    const record = parseSearchResponse(JSON.parse(fixture("search-alberi.json")), RNDT_BASE_URL).records[0];
    expect(provenance(record)).toEqual({
      catalogue: "RNDT",
      recordId: record.id,
      recordTitle: record.title,
      organisation: record.organisation,
      recordUrl: record.htmlUrl,
    });
    expect(record.htmlUrl).toMatch(/\/rest\/metadata\/item\/.+\/html$/);
    expect(provenance({ ...record, organisation: "" })).not.toHaveProperty("organisation");
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

describe("extractOtherLinks", () => {
  it("keeps web links that are not services, without home pages or duplicates", () => {
    // links_s of PCM:MaGIC1_06_40:20160630:145000 (MaGIC Foglio 40 Cirò), plus a WMS.
    const result = {
      _source: {
        links_s: [
          "http://www.protezionecivile.gov.it",
          "http://www.protezionecivile.gov.it",
          "http://www.magicproject.it/index.php/it/",
          "www.protezionecivile.gov.it",
          "https://github.com/pcm-dpc/MaGIC/tree/master/MaGIC-1/fogli/dati/40-Ciro/grid",
          "https://x.it/geoserver/ows?service=WMS",
        ],
      },
    };
    const services = extractServices(result);
    expect(services.map((s) => s.kind)).toEqual(["WMS"]);
    expect(extractOtherLinks(result, services)).toEqual([
      "http://www.magicproject.it/index.php/it/",
      "https://github.com/pcm-dpc/MaGIC/tree/master/MaGIC-1/fogli/dati/40-Ciro/grid",
    ]);
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
    expect(caps.layers.filter((l) => l.group).map((l) => l.name)).toEqual(["Cartografia_Catastale", "vestizioni"]);
  });

  it("reads queryable, inherited from the nearest ancestor that sets it", () => {
    const q = Object.fromEntries(
      parseWmsCapabilities(fixture("wms-ade-130.xml"), "https://x.it/wms").layers.map((l) => [l.name, l.queryable]),
    );
    expect(q.fabbricati).toBe(false);
    expect(q["CP.CadastralParcel"]).toBe(true);
    // `vestizioni` sets none: it takes the group's queryable="1"; its children set "0".
    expect(q.vestizioni).toBe(true);
    expect(q.codice_plla).toBe(false);

    const wms = (attrs: string) => `<WMS_Capabilities version="1.3.0"><Capability><Layer ${attrs}><Name>top</Name>
      <Layer><Name>child</Name></Layer><Layer queryable="1"><Name>own</Name></Layer></Layer></Capability></WMS_Capabilities>`;
    const inherited = parseWmsCapabilities(wms('queryable="0"'), "https://x.it/wms").layers;
    expect(inherited.map((l) => l.queryable)).toEqual([false, false, true]);
    // No attribute anywhere: unknown, not false.
    const none = parseWmsCapabilities(wms(""), "https://x.it/wms").layers;
    expect(none.map((l) => l.queryable)).toEqual([undefined, undefined, true]);
    expect(none[0]).not.toHaveProperty("queryable");
  });

  it("picks the system to ask a layer in when it has no EPSG:3857", () => {
    const layer = (crs: string[]) => ({ name: "a", title: "a", crs, bbox: null, group: false });
    const cadastre = parseWmsCapabilities(fixture("wms-ade-130.xml"), "https://x.it/wms").layers[0];
    expect(pickWmsCrs(cadastre, "1.3.0")).toBe("EPSG:6706");
    // Lombardy's ArcGIS orthophotos.
    expect(pickWmsCrs(layer(["CRS:84", "EPSG:3003", "EPSG:4326"]), "1.3.0")).toBe("CRS:84");
    expect(pickWmsCrs(layer(["CRS:84", "EPSG:3003", "EPSG:4326"]), "1.1.1")).toBe("EPSG:4326");
    // Projected only: the first EPSG code.
    expect(pickWmsCrs(layer(["EPSG:25833", "EPSG:3004"]), "1.1.1")).toBe("EPSG:25833");
    expect(pickWmsCrs(layer(["AUTO:42001"]), "1.3.0")).toBeNull();
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

  it("builds a hits request with the same type and box, and no count or format", () => {
    const url = new URL(buildHitsUrl(caps, "PPR:x", [13, 45.5, 13.5, 46])!);
    expect(url.searchParams.get("RESULTTYPE")).toBe("hits");
    expect(url.searchParams.get("TYPENAMES")).toBe("PPR:x");
    expect(url.searchParams.get("BBOX")).toBe("45.5,13,46,13.5,urn:ogc:def:crs:EPSG::4326");
    expect(url.searchParams.has("COUNT")).toBe(false);
    expect(url.searchParams.has("OUTPUTFORMAT")).toBe(false);
    expect(buildHitsUrl({ ...caps, version: "1.0.0" }, "PPR:x")).toBeNull();
  });

  it("reads the count of a hits answer, WFS 2.0 and 1.1", () => {
    // Shapes of the FVG RIFIUTI:TDLD8 answers, 2026-09-27.
    expect(parseHitsCount('<wfs:FeatureCollection next="https://x.it/wfs?COUNT=10" numberMatched="22521" numberReturned="0"/>')).toBe(22521);
    expect(parseHitsCount('<wfs:FeatureCollection numberOfFeatures="22521" timeStamp="2026-09-27"/>')).toBe(22521);
    expect(parseHitsCount('<wfs:FeatureCollection numberMatched="unknown"/>')).toBeNull();
    expect(parseHitsCount("<ows:ExceptionReport/>")).toBeNull();
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

  it("reads a download itself when the vector downloader answers null (GeoLibre in a browser)", async () => {
    const { fetchJson } = await import("../src/rndt/host");
    const host = {
      ...base,
      fetchVectorUrl: async () => null,
      fetchArrayBuffer: async () => new TextEncoder().encode('{"a":1}').buffer as ArrayBuffer,
    };
    expect(await fetchJson(host, "https://x.it/search", { download: true })).toEqual({ a: 1 });
  });

  it("reports a download the host could not serve", async () => {
    const { fetchJson } = await import("../src/rndt/host");
    // The DNS check after the failure goes through the host too, and fails here.
    const host = {
      ...base,
      fetchVectorUrl: async () => null,
      fetchArrayBuffer: async (): Promise<ArrayBuffer> => {
        throw new Error("offline");
      },
    };
    await expect(fetchJson(host, "https://x.it/wfs", { download: true })).rejects.toThrow(
      /cannot reach x\.it: offline/,
    );
  });
});

describe("browserNeedsHttp", () => {
  it("is true only when https fails in the browser and http answers", async () => {
    const { browserNeedsHttp } = await import("../src/rndt/host");
    const cases: [boolean, boolean, boolean][] = [
      [true, true, false],
      [true, false, false],
      [false, true, true],
      [false, false, false],
    ];
    for (const [httpsOk, httpOk, expected] of cases) {
      vi.stubGlobal("fetch", async (url: string) => {
        const ok = url.startsWith("https:") ? httpsOk : httpOk;
        if (!ok) throw new TypeError("Failed to fetch");
        return new Response("");
      });
      expect(await browserNeedsHttp("https://x.it/wms?service=WMS")).toBe(expected);
    }
    vi.unstubAllGlobals();
  });
});

describe("request address from the capabilities", () => {
  const base = { addMapControl: () => true, removeMapControl: () => undefined };
  const serviceBase = (url: string) => url.replace(/\?.*$/, "");

  it("keeps a declared address on the same host, or on a public one", async () => {
    const { reachableEndpoint } = await import("../src/rndt/host");
    const host = { ...base, fetchArrayBuffer: async () => new TextEncoder().encode('{"Status":0}').buffer as ArrayBuffer };
    expect(await reachableEndpoint(host, "https://a.it/wms", "https://a.it/wms?service=WMS", serviceBase)).toEqual({ url: "https://a.it/wms", note: null });
    expect((await reachableEndpoint(host, "https://cdn.a.it/wms", "https://a.it/wms?service=WMS", serviceBase)).url).toBe("https://cdn.a.it/wms");
  });

  it("falls back to the capabilities' address when the declared host is private or unknown to the DNS", async () => {
    const { reachableEndpoint } = await import("../src/rndt/host");
    const host = { ...base, fetchArrayBuffer: async () => new TextEncoder().encode('{"Status":3}').buffer as ArrayBuffer };
    const intranet = await reachableEndpoint(
      host,
      "http://sr-vm490-sitgfn.comune.intranet:8084/geowebcache/service/wms",
      "https://tms.comune.fi.it/tiles/service/wms?request=GetCapabilities&service=WMS",
      serviceBase,
    );
    expect(intranet.url).toBe("https://tms.comune.fi.it/tiles/service/wms");
    expect(intranet.note).toBe("Requests go to tms.comune.fi.it: the capabilities declare sr-vm490-sitgfn.comune.intranet, a name only the publisher's network knows.");
    expect((await reachableEndpoint(host, "http://192.168.1.5/wms", "https://a.it/wms?x=1", serviceBase)).url).toBe("https://a.it/wms");
    expect((await reachableEndpoint(host, "http://gone.example.org/wms", "https://a.it/wms?x=1", serviceBase)).url).toBe("https://a.it/wms");
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

  describe("a server the browser may not read", () => {
    const host = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      fetchArrayBuffer: async (): Promise<ArrayBuffer> => {
        throw new TypeError("Failed to fetch");
      },
    };
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it("says so when the server answers a request without CORS", async () => {
      const { fetchTextFrom } = await import("../src/rndt/host");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
      await expect(fetchTextFrom(host, "https://x.it/wms")).rejects.toThrow(
        "x.it answers, but a web page cannot read it: the server sends no CORS headers. The service works in GeoLibre Desktop",
      );
    });

    it("keeps the plain error when the server does not answer at all", async () => {
      const { fetchTextFrom } = await import("../src/rndt/host");
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
      await expect(fetchTextFrom(host, "https://x.it/wms")).rejects.toThrow("cannot reach x.it: Failed to fetch");
    });

    it("does not ask in GeoLibre Desktop, where the native client needs no CORS", async () => {
      const { fetchTextFrom } = await import("../src/rndt/host");
      const fetchMock = vi.fn(async () => new Response(null));
      vi.stubGlobal("fetch", fetchMock);
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      await expect(fetchTextFrom(host, "https://x.it/wms")).rejects.toThrow("cannot reach x.it: Failed to fetch");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("says a server is gone when the DNS does not know its name", async () => {
    const { fetchTextFrom } = await import("../src/rndt/host");
    const asked: string[] = [];
    const host = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      fetchArrayBuffer: async (url: string) => {
        asked.push(url);
        if (url.startsWith("https://dns.google/")) {
          return new TextEncoder().encode(JSON.stringify({ Status: 3 })).buffer as ArrayBuffer;
        }
        throw new TypeError("Failed to fetch");
      },
    };
    await expect(fetchTextFrom(host, "https://geoportale.comune.milano.it/wms")).rejects.toThrow(
      "server geoportale.comune.milano.it does not exist: its name is not in the DNS",
    );
    expect(asked.at(-1)).toBe("https://dns.google/resolve?name=geoportale.comune.milano.it&type=A");
  });

  it("keeps the fetch error when the name exists or the DNS check fails", async () => {
    const { fetchTextFrom } = await import("../src/rndt/host");
    for (const answer of [JSON.stringify({ Status: 0 }), "not json"]) {
      const host = {
        addMapControl: () => true,
        removeMapControl: () => undefined,
        fetchArrayBuffer: async (url: string) => {
          if (url.startsWith("https://dns.google/")) return new TextEncoder().encode(answer).buffer as ArrayBuffer;
          throw new Error("HTTP 400");
        },
      };
      await expect(fetchTextFrom(host, "https://x.it/wms")).rejects.toThrow("cannot reach x.it: HTTP 400");
    }
  });

  it("upgrades same-host operation URLs when capabilities came over https", async () => {
    const { upgradeToHttps } = await import("../src/rndt/ogc");
    expect(upgradeToHttps("http://x.it/wfs", "https://x.it/wfs?REQUEST=GetCapabilities")).toBe("https://x.it/wfs");
    expect(upgradeToHttps("http://y.it/wfs", "https://x.it/wfs")).toBe("http://y.it/wfs");
    expect(upgradeToHttps("http://x.it/wfs", "http://x.it/wfs")).toBe("http://x.it/wfs");
  });
});

describe("extent of a WMS layer added from a record", () => {
  it("is the record's when a dataset lies inside the layer's extent", async () => {
    const { wmsLayerBounds } = await import("../src/rndt/ogc");
    const italy: [number, number, number, number] = [2, 33, 19, 48];
    const camastra: [number, number, number, number] = [13.7844622, 37.2124016, 13.8278335, 37.2832807];
    expect(wmsLayerBounds(italy, camastra, "dataset")).toEqual(camastra);
    // A service record describes the whole service; a record wider than the layer keeps the layer's.
    expect(wmsLayerBounds(italy, camastra, "service")).toEqual(italy);
    expect(wmsLayerBounds(camastra, italy, "dataset")).toEqual(camastra);
    expect(wmsLayerBounds(italy, null, "dataset")).toEqual(italy);
    // No valid layer extent: none, as before.
    expect(wmsLayerBounds(null, camastra, "dataset")).toBeUndefined();
    expect(wmsLayerBounds([19, 33, 2, 48], camastra, "dataset")).toBeUndefined();
  });
});

describe("SLD of a WFS feature type", () => {
  it("asks GetStyles to the WMS of the same GeoServer", async () => {
    const { getStylesUrl } = await import("../src/rndt/ogc");
    expect(getStylesUrl("https://geoservizi.regione.liguria.it/geoserver/M5/wfs", "M5:L4")).toBe(
      "https://geoservizi.regione.liguria.it/geoserver/M5/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetStyles&LAYERS=M5%3AL4",
    );
    // `ows` serves both; operation parameters of the WFS are dropped, others kept.
    const ows = new URL(getStylesUrl("https://x.it/geoserver/ows?service=WFS&map=a", "a"));
    expect(ows.pathname).toBe("/geoserver/ows");
    expect(ows.searchParams.get("map")).toBe("a");
    expect(ows.searchParams.getAll("SERVICE").concat(ows.searchParams.getAll("service"))).toEqual(["WMS"]);
  });
});

describe("EPSG:3857 test tile", () => {
  it("builds a small GetMap in EPSG:3857 at the centre of the layer", async () => {
    const { probeGetMapUrl } = await import("../src/rndt/ogc");
    const url = new URL(probeGetMapUrl("https://x.it/wms?map=a", "1.3.0", "ortofoto", [9, 45, 10, 46]));
    expect(url.searchParams.get("map")).toBe("a");
    expect(url.searchParams.get("CRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("LAYERS")).toBe("ortofoto");
    const [x1, y1, x2, y2] = url.searchParams.get("BBOX")!.split(",").map(Number);
    expect(x2 - x1).toBe(4000);
    expect((x1 + x2) / 2).toBeCloseTo(1057535.16, 1); // 9.5° E
    expect((y1 + y2) / 2).toBeCloseTo(5700582.73, 1); // 45.5° N
    expect(new URL(probeGetMapUrl("https://x.it/wms", "1.1.1", "a", null)).searchParams.get("SRS")).toBe("EPSG:3857");
  });

  it("builds it in degrees for a geographic system, latitude first for EPSG codes in 1.3.0", async () => {
    const { probeGetMapUrl } = await import("../src/rndt/ogc");
    const bboxOf = (version: string, crs: string) =>
      new URL(probeGetMapUrl("https://x.it/wms", version, "a", [9, 45, 10, 46], crs)).searchParams.get("BBOX");
    expect(bboxOf("1.3.0", "EPSG:6706")).toBe("45.48000,9.48000,45.52000,9.52000");
    expect(bboxOf("1.3.0", "CRS:84")).toBe("9.48000,45.48000,9.52000,45.52000");
    expect(bboxOf("1.1.1", "EPSG:4326")).toBe("9.48000,45.48000,9.52000,45.52000");
    expect(new URL(probeGetMapUrl("https://x.it/wms", "1.3.0", "a", null, "EPSG:6706")).searchParams.get("CRS")).toBe("EPSG:6706");
  });

  it("takes a PNG as a tile only when it has the size asked", async () => {
    const { testTile } = await import("../src/rndt/host");
    const host = (bytes: number[]) => ({
      addMapControl: () => true,
      removeMapControl: () => undefined,
      fetchArrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer,
    });
    const png = (size: number) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, size >> 8, size & 255, 0, 0, size >> 8, size & 255];
    expect(await testTile(host(png(64)), "u", 64)).toBe("tile");
    // The cadastral group layer: the same 500×500 picture for any request.
    expect(await testTile(host(png(500)), "u", 64)).toBe("other-size");
    expect(await testTile(host([0xff, 0xd8, 0xff, 0xe0]), "u", 64)).toBe("tile");
    expect(await testTile(host([...new TextEncoder().encode("<?xml version")]), "u", 64)).toBe("none");
  });

  it("tells an image from an error document by its first bytes", async () => {
    const { answersWithImage } = await import("../src/rndt/host");
    const host = (bytes: number[]) => ({
      addMapControl: () => true,
      removeMapControl: () => undefined,
      fetchArrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer,
    });
    expect(await answersWithImage(host([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), "u")).toBe(true);
    expect(await answersWithImage(host([0xff, 0xd8, 0xff, 0xe0]), "u")).toBe(true);
    expect(await answersWithImage(host([...new TextEncoder().encode("<?xml version")]), "u")).toBe(false);
  });
});

describe("WMS of an ArcGIS service, from its WMTS", () => {
  it("maps the REST WMTS path to the WMSServer path", async () => {
    const { arcgisWmsFromWmts } = await import("../src/rndt/ogc");
    expect(arcgisWmsFromWmts("https://www.cartografia.servizirl.it/arcgis2/rest/services/BaseMap/ortofoto2003/ImageServer/WMTS?service=WMTS")).toBe(
      "https://www.cartografia.servizirl.it/arcgis2/services/BaseMap/ortofoto2003/ImageServer/WMSServer",
    );
    expect(arcgisWmsFromWmts("https://webgis.arpa.piemonte.it/ags/rest/services/geologia/Geo_Piemonte_250k/MapServer/WMTS/1.0.0/WMTSCapabilities.xml")).toBe(
      "https://webgis.arpa.piemonte.it/ags/services/geologia/Geo_Piemonte_250k/MapServer/WMSServer",
    );
    expect(arcgisWmsFromWmts("https://idt2.regione.veneto.it/gwc/service/wmts")).toBeNull();
  });
});

describe("record ids in the search box", () => {
  it.each([
    ["r_veneto:c11023040561_RovereVer", "r_veneto:c11023040561_RovereVer"],
    ["  r_basili:51db0c0e:15171e5a981:-78ae ", "r_basili:51db0c0e:15171e5a981:-78ae"],
    ["keywords_s:ortofoto", "keywords_s:ortofoto"],
    ["ortofoto", null],
    ["uso civico", null],
    ['title:"uso civico"', null],
    ["(a:b)", null],
  ])("%s → %s", (text, expected) => {
    expect(recordIdIn(text)).toBe(expected);
  });

  it("finds the record by fileid, with no other filter", () => {
    expect(buildQuery(idForm("r_veneto:c11023040561_RovereVer"))).toEqual({ q: '(fileid:"r_veneto:c11023040561_RovereVer")' });
  });
});
