import { afterEach, describe, expect, it, vi } from "vitest";
import { INSPIRE_THEME_CODES, INSPIRE_THEMES } from "../src/rndt/constants";
import { emptyForm, type SearchForm } from "../src/rndt/query";
import { linkHasView, linkLayersFrom, linkSearchFrom, linkViewFrom, paramsFromForm, shareUrl, URL_PARAMETER_NAMES } from "../src/rndt/url-params";

const read = (query: string) => linkSearchFrom(new URLSearchParams(query));
const form = (fields: Partial<SearchForm>): SearchForm => ({ ...emptyForm(), ...fields });

describe("linkSearchFrom", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the text, every other field at its default", () => {
    expect(read("rndt=idrografia")).toEqual({ form: form({ text: "idrografia" }) });
    expect(read("rndt=uso+del+suolo")?.form.text).toBe("uso del suolo");
  });

  it("reads the box, alone or with the text", () => {
    expect(read("rndtBbox=12.3,37.5,13.9,38.3")?.form.bbox).toEqual([12.3, 37.5, 13.9, 38.3]);
    expect(read("rndt=catastale&rndtBbox=12.3, 37.5, 13.9, 38.3")).toEqual({
      form: form({ text: "catastale", bbox: [12.3, 37.5, 13.9, 38.3] }),
    });
  });

  it("reads every filter", () => {
    const query = [
      "rndt=fiumi",
      "rndtBbox=12,37,14,39",
      "rndtWithin=1",
      "rndtKind=services",
      "rndtService=view,download",
      "rndtAs=wms,ArcGIS",
      "rndtMode=any",
      "rndtField=abstract",
      "rndtKeywords=idrografia,reticolo",
      "rndtOrg=Regione+Puglia",
      "rndtOrgNot=1",
      "rndtTheme=hy",
      "rndtOpen=true",
      "rndtDate=publication",
      "rndtFrom=2020-01-01",
      "rndtTo=2024-12-31",
      "rndtSort=newest",
    ].join("&");
    expect(read(query)?.form).toEqual(
      form({
        text: "fiumi",
        bbox: [12, 37, 14, 39],
        spatialRel: "Within",
        kind: "services",
        serviceTypes: ["view", "download"],
        availableAs: ["WMS", "ArcGIS REST"],
        textMode: "any",
        field: "description",
        keywords: "idrografia,reticolo",
        organisation: "Regione Puglia",
        invertOrganisation: true,
        inspireThemes: ["Idrografia"],
        openDataOnly: true,
        dateField: "apiso_PublicationDate_dt",
        dateFrom: "2020-01-01",
        dateTo: "2024-12-31",
        sort: "apiso_Modified_dt:desc",
      }),
    );
  });

  it("asks for a search with a filter and no text", () => {
    expect(read("rndtTheme=cp&rndtKind=services")?.form).toEqual(
      form({ inspireThemes: ["Parcelle catastali"], kind: "services" }),
    );
  });

  it("asks for no search without a value", () => {
    expect(read("rndt")).toBeNull();
    expect(read("rndt=%20&rndtBbox=")).toBeNull();
    expect(read("url=https://example.com/p.json")).toBeNull();
  });

  it("is case-sensitive on the names, as GeoLibre is", () => {
    expect(read("Rndt=idrografia&rndtbbox=12,37,13,38&RNDTKIND=data")).toBeNull();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(read("rndt=uno&rndt=due")?.form.text).toBe("uno");
  });

  it("leaves out a box that is not valid, with a warning, and keeps the text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const box of ["12,37,13", "12,37,13,abc", "12,37,200,38", "13,37,12,38"]) {
      expect(read(`rndt=ortofoto&rndtBbox=${box}`)).toEqual({ form: form({ text: "ortofoto" }) });
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("leaves out each value that is not valid, with a warning, and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const query =
      "rndt=strade&rndtKind=maps&rndtAs=WMS,WMTS&rndtTheme=zz&rndtFrom=2024-13-01&rndtSort=random&rndtOpen=maybe&rndtService=view,nope";
    expect(read(query)?.form).toEqual(form({ text: "strade", availableAs: ["WMS"], serviceTypes: ["view"] }));
    expect(warn).toHaveBeenCalledTimes(7);
  });

  it("uses the first known theme of a list", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(read("rndtTheme=hy,cp")?.form.inspireThemes).toEqual(["Idrografia"]);
    expect(read("rndtTheme=zz,cp")?.form.inspireThemes).toEqual(["Parcelle catastali"]);
  });
});

describe("paramsFromForm", () => {
  it("writes nothing for an empty form", () => {
    expect(paramsFromForm(emptyForm()).toString()).toBe("");
  });

  it("writes only the fields that differ from their default", () => {
    expect(paramsFromForm(form({ text: "idrografia", kind: "data" })).toString()).toBe(
      "rndt=idrografia&rndtKind=data",
    );
  });

  it("leaves out Within without a box and a date field without a range", () => {
    const params = paramsFromForm(form({ spatialRel: "Within", dateField: "apiso_CreationDate_dt" }));
    expect(params.toString()).toBe("");
  });

  it("gives back the same form when read again", () => {
    const forms: SearchForm[] = [
      form({ text: "catasto", bbox: [12.5, 37.6, 14.3, 38.3], spatialRel: "Within" }),
      form({
        kind: "services",
        serviceTypes: ["view"],
        availableAs: ["WFS", "ArcGIS REST"],
        textMode: "lucene",
        field: "title",
        keywords: "a, b",
        organisation: "Comune di Bari",
        invertOrganisation: true,
        inspireThemes: ["Distribuzione della popolazione — demografia"],
        openDataOnly: true,
        dateField: "sys_created_dt",
        dateFrom: "2021-05-01",
        sort: "title:desc",
      }),
    ];
    for (const original of forms) {
      expect(linkSearchFrom(paramsFromForm(original))?.form).toEqual(original);
    }
  });
});

describe("parameter names", () => {
  it("are all handed to GeoLibre, each once", () => {
    expect(URL_PARAMETER_NAMES).toContain("rndt");
    expect(URL_PARAMETER_NAMES).toContain("rndtTheme");
    expect(new Set(URL_PARAMETER_NAMES).size).toBe(URL_PARAMETER_NAMES.length);
  });

  it("cover every INSPIRE theme of the form with a code", () => {
    const labels = Object.values(INSPIRE_THEME_CODES);
    expect(labels.length).toBe(INSPIRE_THEMES.length);
    for (const theme of INSPIRE_THEMES) expect(labels).toContain(theme.value);
  });
});

describe("shareUrl", () => {
  it("opens GeoLibre web with the plugin and the search", () => {
    const url = new URL(shareUrl(form({ text: "fiumi", kind: "data", inspireThemes: ["Idrografia"] }), null));
    expect(url.origin + url.pathname).toBe("https://web.geolibre.app/");
    expect([...url.searchParams]).toEqual([
      ["plugin", "openrndt-geolibre"],
      ["rndt", "fiumi"],
      ["rndtKind", "data"],
      ["rndtTheme", "hy"],
    ]);
    expect(linkSearchFrom(url.searchParams)?.form).toEqual(
      form({ text: "fiumi", kind: "data", inspireThemes: ["Idrografia"] }),
    );
  });

  it("opens the record when one is open, whatever the search", () => {
    const url = new URL(shareUrl(form({ text: "fiumi", kind: "data" }), "c_l219:a883ab12"));
    expect([...url.searchParams]).toEqual([
      ["plugin", "openrndt-geolibre"],
      ["rndt", "c_l219:a883ab12"],
    ]);
  });

  it("is only the plugin for an empty search", () => {
    expect(shareUrl(emptyForm(), null)).toBe("https://web.geolibre.app/?plugin=openrndt-geolibre");
  });

  it("ends with the map view in GeoLibre's own parameters, rounded (#44)", () => {
    const url = new URL(shareUrl(form({ text: "fiumi" }), null, { lon: 15.491234567, lat: 38.071234567, zoom: 12.3456 }));
    expect([...url.searchParams]).toEqual([
      ["plugin", "openrndt-geolibre"],
      ["rndt", "fiumi"],
      ["lat", "38.07123"],
      ["lon", "15.49123"],
      ["zoom", "12.35"],
    ]);
    expect(linkHasView(url.searchParams)).toBe(true);
  });
});

describe("rndtView (#47)", () => {
  afterEach(() => vi.restoreAllMocks());
  const view = (query: string) => linkViewFrom(new URLSearchParams(query));

  it("reads a box that is not a search filter", () => {
    expect(URL_PARAMETER_NAMES).toContain("rndtView");
    expect(view("rndtView=6.62,38.86,11.66,47")).toEqual([6.62, 38.86, 11.66, 47]);
    expect(view("rndtView=6.62; 38.86 11.66,47")).toEqual([6.62, 38.86, 11.66, 47]);
    expect(read("rndtView=6.62,38.86,11.66,47")).toBeNull();
    expect(read("rndt=ortofoto&rndtView=6.62,38.86,11.66,47")).toEqual({ form: form({ text: "ortofoto" }) });
    expect(view("rndt=ortofoto")).toBeNull();
  });

  it("drops a box that is not valid with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(view("rndtView=11.66,38.86,6.62,47")).toBeNull();
    expect(view("rndtView=6,38,11")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("rndtView=11.66,38.86,6.62,47");
  });
});

describe("rndtLayer (#44)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("goes in the link bottom to top, before the view, and reads back the same", () => {
    const layers = [
      { recordId: "c_l219:a883ab12", kind: "wms" as const, name: "Microzone" },
      { recordId: "r_sicili:enna~1", kind: "arcgis" as const, name: "3" },
    ];
    const url = new URL(shareUrl(form({ text: "catasto" }), null, { lon: 15, lat: 38, zoom: 9 }, layers));
    expect([...url.searchParams].map(([name]) => name)).toEqual(["plugin", "rndt", "rndtLayer", "rndtLayer", "lat", "lon", "zoom"]);
    expect(url.searchParams.getAll("rndtLayer")).toEqual(["c_l219:a883ab12~wms~Microzone", "r_sicili:enna~1~arcgis~3"]);
    expect(linkLayersFrom(url.searchParams)).toEqual(layers);
  });

  it("keeps a ~ in the layer name, and drops values that are not valid with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const params = new URLSearchParams();
    for (const value of ["c_x:1~wms~a~b", "c_x:1~wmts~a", "c_x:1~wms~", "nothing"]) params.append("rndtLayer", value);
    expect(linkLayersFrom(params)).toEqual([{ recordId: "c_x:1", kind: "wms", name: "a~b" }]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("is a parameter GeoLibre hands to the plugin", () => {
    expect(URL_PARAMETER_NAMES).toContain("rndtLayer");
  });
});

describe("linkHasView", () => {
  it("needs both lat and lon, within range", () => {
    expect(linkHasView(new URLSearchParams("lat=38&lon=15"))).toBe(true);
    expect(linkHasView(new URLSearchParams("lat=38"))).toBe(false);
    expect(linkHasView(new URLSearchParams("lat=&lon=15"))).toBe(false);
    expect(linkHasView(new URLSearchParams("lat=95&lon=15"))).toBe(false);
    expect(linkHasView(new URLSearchParams("lat=abc&lon=15"))).toBe(false);
  });
});
