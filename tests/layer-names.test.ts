import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RNDT_BASE_URL } from "../src/rndt/constants";
import type { RndtHost } from "../src/rndt/host";
import {
  findTitle,
  isReadableTitle,
  layerCodeUrl,
  layerTitlesUrl,
  lookupLayerTitleByCode,
  lookupLayerTitles,
  lookupOneLayerTitle,
  parseLayerTitles,
  readableTitle,
  serviceKey,
} from "../src/rndt/layer-names";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

function host(fetchArrayBuffer: (url: string) => Promise<ArrayBuffer>): RndtHost {
  return { addMapControl: () => true, removeMapControl: () => undefined, fetchArrayBuffer };
}

describe("readable titles", () => {
  it.each([
    ["RIFIUTI:TDLD8", "TDLD8", false],
    ["Legenda:Parchi_naturali", "Parchi_naturali", false],
    ["decsiraogc:IndicaEmissAtmoM01", "IndicaEmissAtmoM01", false],
    ["GRIGLIEGEO:QU_AGEA2020", "QU_AGEA2020", false],
    ["M2185:L7015", "Ciclovie", true],
    ["CP:CadastralParcel", "Particelle", true],
    ["PPR:v_alberi", "Alberi monumentali e notevoli", true],
    ["x:y", "", false],
  ])("%s / %s → %s", (name, title, expected) => {
    expect(isReadableTitle(name, title)).toBe(expected);
  });

  it("gives the capabilities title only when it reads as a name", () => {
    expect(readableTitle("M2185:L7015", "Ciclovie")).toBe("Ciclovie");
    expect(readableTitle("RIFIUTI:ADM", "ADM")).toBeNull();
  });
});

describe("RNDT lookup query", () => {
  it("matches every link to the same workspace", () => {
    expect(serviceKey("https://serviziogc.regione.fvg.it/geoserver/RIFIUTI/wfs?request=GetCapabilities")).toBe(
      "serviziogc.regione.fvg.it/geoserver/RIFIUTI",
    );
  });

  it("escapes / (unescaped the catalogue answers 400) and asks for CSW", () => {
    const url = new URL(layerTitlesUrl(RNDT_BASE_URL, "https://serviziogc.regione.fvg.it/geoserver/RIFIUTI/wfs"));
    expect(url.searchParams.get("q")).toBe("links_s:*serviziogc.regione.fvg.it\\/geoserver\\/RIFIUTI*");
    expect(url.searchParams.get("f")).toBe("csw");
    expect(url.searchParams.get("num")).toBe("1000");
  });

  it("targets one layer for large services", () => {
    const url = new URL(layerTitlesUrl(RNDT_BASE_URL, "https://serviziogc.regione.fvg.it/geoserver/RIFIUTI/wfs", 20, "RIFIUTI:TDLD8"));
    expect(url.searchParams.get("q")).toBe("links_s:*serviziogc.regione.fvg.it\\/geoserver\\/RIFIUTI*TDLD8*");
  });
});

describe("lookup by layer name in the whole record", () => {
  const service = "https://servizigis.regione.emilia-romagna.it/wms/metadati_raster";
  const one = (title: string) =>
    `<csw:GetRecordsResponse xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:dc="http://purl.org/dc/elements/1.1/"><csw:SearchResults numberOfRecordsMatched="2"><csw:Record><dc:title>${title}</dc:title></csw:Record></csw:SearchResults></csw:GetRecordsResponse>`;

  it("asks for the records of the service that mention the name, best first", () => {
    const url = new URL(layerCodeUrl(RNDT_BASE_URL, service, "QU_USR_PTPR_1993"));
    expect(url.searchParams.get("q")).toBe(
      "links_s:*servizigis.regione.emilia\\-romagna.it\\/wms* AND QU_USR_PTPR_1993",
    );
    expect(url.searchParams.get("num")).toBe("1");
    expect(url.searchParams.get("f")).toBe("csw");
  });

  it("takes the title of the first record, null when there is none or on error", async () => {
    const title = "Quadro di unione PTPR93 - Uso Reale del Suolo";
    expect(await lookupLayerTitleByCode(host(async () => encode(one(title))), RNDT_BASE_URL, service, "QU_USR_PTPR_1993")).toBe(title);
    const empty = one("x").replace(/<csw:Record>.*<\/csw:Record>/, "");
    expect(await lookupLayerTitleByCode(host(async () => encode(empty)), RNDT_BASE_URL, service, "QU_X")).toBeNull();
    expect(await lookupLayerTitleByCode(host(async () => { throw new Error("down"); }), RNDT_BASE_URL, service, "QU_X")).toBeNull();
  });
});

describe("layer titles from CSW", () => {
  const parsed = parseLayerTitles(fixture("csw-fvg-rifiuti.xml"));

  it("reads the total and maps layer names from links", () => {
    expect(parsed.total).toBe(245);
    expect(findTitle(parsed, "RIFIUTI:TDLD8")).toBe("Trattamento chimico-fisico e biologico di rifiuti liquidi D8 (TDLD8)");
    expect(findTitle(parsed, "rifiuti:ucem")).toBe("Utilizzo in cementifici R5 (UCEM)");
  });

  it("falls back to the code in brackets at the end of a title", () => {
    // "Recupero RAEE R3 (RAEER3)" links only to GetCapabilities.
    expect(parsed.titles.has("raeer3")).toBe(false);
    expect(findTitle(parsed, "RIFIUTI:RAEER3")).toBe("Recupero RAEE R3 (RAEER3)");
  });

  it("returns null for an unknown layer", () => {
    expect(findTitle(parsed, "RIFIUTI:NOPE")).toBeNull();
  });
});

describe("lookupLayerTitles", () => {
  const csw = fixture("csw-fvg-rifiuti.xml");
  const withTotal = (n: number) => csw.replace('numberOfRecordsMatched="245"', `numberOfRecordsMatched="${n}"`);
  const service = "https://serviziogc.regione.fvg.it/geoserver/RIFIUTI/wfs";

  it("counts first, then downloads all records in one request", async () => {
    const urls: string[] = [];
    const lookup = await lookupLayerTitles(host(async (u) => (urls.push(u), encode(csw))), RNDT_BASE_URL, service);
    expect(urls.map((u) => new URL(u).searchParams.get("num"))).toEqual(["0", "1000"]);
    expect(lookup.mode).toBe("all");
    if (lookup.mode === "all") expect(findTitle(lookup.found, "RIFIUTI:TDLD8")).not.toBeNull();
  });

  it("stops after the count when no record links to the service", async () => {
    const urls: string[] = [];
    const lookup = await lookupLayerTitles(host(async (u) => (urls.push(u), encode(withTotal(0)))), RNDT_BASE_URL, service);
    expect(urls).toHaveLength(1);
    expect(lookup.mode === "all" && lookup.found.titles.size).toBe(0);
  });

  it("switches to per-layer lookups above the bulk limit", async () => {
    const urls: string[] = [];
    const lookup = await lookupLayerTitles(host(async (u) => (urls.push(u), encode(withTotal(1500)))), RNDT_BASE_URL, service);
    expect(urls).toHaveLength(1);
    expect(lookup.mode).toBe("per-layer");
    const title = await lookupOneLayerTitle(host(async () => encode(csw)), RNDT_BASE_URL, service, "RIFIUTI:UCEM");
    expect(title).toBe("Utilizzo in cementifici R5 (UCEM)");
  });

  it("never throws: an error gives no titles", async () => {
    const lookup = await lookupLayerTitles(
      host(async () => {
        throw new Error("down");
      }),
      RNDT_BASE_URL,
      "https://x.it/geoserver/A/wfs",
    );
    expect(lookup.mode === "all" && lookup.found.titles.size + lookup.found.codes.size).toBe(0);
    expect(await lookupOneLayerTitle(host(async () => { throw new Error("down"); }), RNDT_BASE_URL, service, "RIFIUTI:X")).toBeNull();
  });

  it("gives up after the timeout", async () => {
    const started = Date.now();
    const lookup = await lookupLayerTitles(
      host(() => new Promise(() => undefined)),
      RNDT_BASE_URL,
      "https://x.it/geoserver/A/wfs",
      50,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(lookup.mode === "all" && lookup.found.titles.size).toBe(0);
  });
});
