import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureCollection } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/geolibre";
import type { GeoLibreRightPanelRegistration } from "../src/lib/geolibre/host-api";
import { ITALY_BBOX, PANEL_ID } from "../src/rndt/constants";
import type { RndtHost } from "../src/rndt/host";
import { URL_PARAMETER_NAMES } from "../src/rndt/url-params";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const searchHelpToggle = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(".ordt-footer button")).find((b) => b.textContent === "Search help")!;

/** Open a result's detail view from its title; returns the view. */
const openDetail = (card: HTMLElement) => {
  card.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
  return card.closest(".ordt-panel")!.querySelector<HTMLElement>(".ordt-detail-view")!;
};

/** Tick the first layer that can be ticked in a WMS list, if none is ticked yet. */
const tickFirstWms = (item: HTMLElement) => {
  const list = item.querySelector<HTMLElement>('[aria-label="WMS layers"]')!;
  if (list.querySelector("input:checked")) return;
  const box = list.querySelector<HTMLInputElement>("input:not(:disabled)")!;
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Unfold a layer list that opened folded (above 8 layers). */
const showAll = (item: HTMLElement) => item.querySelector<HTMLButtonElement>(".ordt-show-layers")?.click();

const chipLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".ordt-chip"), (c) => c.firstChild!.textContent);

function createHost(responses: (url: string) => string) {
  let panel: GeoLibreRightPanelRegistration | null = null;
  const requested: string[] = [];
  const host: RndtHost = {
    addMapControl: () => true,
    removeMapControl: () => undefined,
    registerRightPanel: (p) => {
      panel = p;
      return vi.fn();
    },
    openRightPanel: vi.fn(() => true),
    closeRightPanel: vi.fn(),
    fetchArrayBuffer: vi.fn(async (url: string) => {
      requested.push(url);
      return encode(responses(url));
    }),
    fitBounds: vi.fn(),
    getViewBounds: () => [12, 41, 13, 42],
    addWmsLayer: vi.fn(() => "wms-1"),
    addGeoJsonLayer: vi.fn(() => "geojson-1"),
  };
  return { host, requested, getPanel: () => panel };
}

async function mountPanel(responses: (url: string) => string) {
  const ctx = createHost(responses);
  plugin.activate(ctx.host);
  const container = document.createElement("div");
  document.body.append(container);
  const cleanup = ctx.getPanel()!.render(container);
  return { ...ctx, container, cleanup };
}

describe("plugin manifest", () => {
  it("matches plugin.json (GeoLibre refuses a mismatch)", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "geolibre-plugin", "plugin.json"), "utf8"));
    expect({ id: plugin.id, name: plugin.name, version: plugin.version }).toEqual({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
    });
  });

  it("refuses to activate without a right panel", () => {
    expect(plugin.activate({ addMapControl: () => true, removeMapControl: () => undefined })).toBe(false);
  });
});

describe("RNDT panel", () => {
  it("registers and opens the panel, and closes it on deactivate", async () => {
    const { host, getPanel, container } = await mountPanel(() => "{}");
    expect(getPanel()?.id).toBe(PANEL_ID);
    expect(host.openRightPanel).toHaveBeenCalledWith(PANEL_ID);
    expect(container.querySelector("form.ordt-form")).not.toBeNull();
    plugin.deactivate(host);
    expect(host.closeRightPanel).toHaveBeenCalledWith(PANEL_ID);
    expect(container.querySelector(".ordt-panel")).toBeNull();
  });

  it("stops watching its bars when it is turned off (no error from a late resize)", async () => {
    const observers: { run: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = vi.fn();
        constructor(run: () => void) {
          observers.push({ run, disconnect: this.disconnect });
        }
        observe() {}
      },
    );
    try {
      const { host } = await mountPanel(() => "{}");
      expect(observers).toHaveLength(1);
      plugin.deactivate(host);
      expect(observers[0].disconnect).toHaveBeenCalled();
      expect(() => observers[0].run()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("searches, lists records and adds a WMS layer", async () => {
    const { host, requested, container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-piemonte-111.xml"),
    );
    const text = container.querySelector<HTMLInputElement>('input[name="text"]')!;
    text.value = "catasto";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();

    const search = new URL(requested[0]);
    expect(search.searchParams.get("q")).toBe("(catasto)");
    expect(search.searchParams.get("f")).toBe("json");
    expect(container.querySelector(".ordt-status")!.textContent).toMatch(/^1-5 of /);
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(5);

    // Open the first record with a WMS and add its layer.
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    const item = openDetail(card);
    expect(item.hidden).toBe(false);
    // The capabilities are read as the view opens: no "Add to map…" step.
    await flush();
    expect(requested.some((u) => /REQUEST=GetCapabilities/.test(u))).toBe(true);
    tickFirstWms(item);
    const addLayer = Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Add to map (1)",
    )!;
    expect(addLayer.disabled).toBe(false);
    addLayer.click();
    expect(host.addWmsLayer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ layers: expect.any(String), version: "1.1.1", transparent: true }),
    );
  });

  for (const [httpsReachable, scheme] of [
    [false, "http:"],
    [true, "https:"],
] as const) {
    it(`keeps the ${scheme} GetMap URL when the browser ${httpsReachable ? "reaches" : "cannot reach"} https`, async () => {
      // Record and capabilities both say http; the plugin guesses https first.
      const toHttp = (text: string) => text.replaceAll("https://geomap", "http://geomap");
      const { host, container } = await mountPanel((url) =>
        toHttp(url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-piemonte-111.xml")),
      );
      const probes: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        probes.push(url);
        if (url.startsWith("https:") && !httpsReachable) throw new TypeError("Failed to fetch");
        return new Response("ok");
      });
      try {
        container.querySelector<HTMLFormElement>("form")!.requestSubmit();
        await flush();
        const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
          li.querySelector(".ordt-badge-service")?.textContent === "WMS",
        )!;
        const item = openDetail(card);
        await flush();
        tickFirstWms(item);
        Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add to map (1)")!.click();
        const options = vi.mocked(host.addWmsLayer!).mock.calls[0][1];
        expect(new URL(options.url).protocol).toBe(scheme);
        expect(probes[0]).toMatch(/^https:/);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }

  it("disables adding a WMS layer without EPSG:3857", async () => {
    const { container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-ade-130.xml"),
    );
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    const item = openDetail(card);
    await flush();
    const addLayer = item.querySelector<HTMLButtonElement>(".ordt-service .ordt-primary")!;
    expect(addLayer.disabled).toBe(true);
    expect(addLayer.textContent).toBe("Select a layer");
    expect(Array.from(item.querySelectorAll<HTMLInputElement>(".ordt-layer input")).every((i) => i.disabled)).toBe(true);
    expect(item.textContent).toContain("Not offered in EPSG:3857");
    expect(item.textContent).toContain("No layer of this WMS is offered in EPSG:3857");
  });

  it("uses the map view as search box", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLSelectElement>('select[name="where"]')!.value = "view";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const url = new URL(requested[0]);
    expect(url.searchParams.get("bbox")).toBe("12,41,13,42");
    expect(url.searchParams.get("spatialRel")).toBe("Intersects");
  });

  it("downloads search results through the long-budget path when the host has one", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    const vector: string[] = [];
    Object.assign(host, {
      fetchVectorUrl: async (url: string) => {
        vector.push(url);
        return new File([fixture("search-alberi.json")], "search.json");
      },
    });
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(vector).toHaveLength(1);
    expect(vector[0]).toContain("/rest/metadata/search");
    expect(requested).toEqual([]);
    expect(container.querySelectorAll(".ordt-result").length).toBeGreaterThan(0);
  });

  it("filters on the links a record offers, whatever its type", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLInputElement>('input[name="availableAs"][value="WMS"]')!.checked = true;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(new URL(requested[0]).searchParams.get("q")).toBe("links_s:(http*wms* OR http*WMS* OR http*Wms*)");
  });

  it("starts from the map view and offers inside the area only with an area", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    const choice = container.querySelector<HTMLElement>(".ordt-spatial-rel")!;
    const where = container.querySelector<HTMLSelectElement>('select[name="where"]')!;
    expect(where.value).toBe("view");
    expect(choice.hidden).toBe(false);
    where.value = "anywhere";
    where.dispatchEvent(new Event("change"));
    expect(choice.hidden).toBe(true);
    where.value = "view";
    where.dispatchEvent(new Event("change"));
    expect(choice.hidden).toBe(false);
    container.querySelector<HTMLInputElement>('input[name="spatialRel"][value="Within"]')!.checked = true;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(new URL(requested[0]).searchParams.get("spatialRel")).toBe("Within");
  });

  it("toggles Search help and runs a search-mode example", async () => {
    const { requested, container } = await mountPanel(() =>
      fixture("search-alberi.json"),
    );
    const toggle = searchHelpToggle(container);
    const all = container.querySelector<HTMLElement>(".ordt-help-all")!;
    const help = container.querySelector<HTMLElement>('[id="ordt-search-help"]')!;
    expect(toggle.getAttribute("aria-controls")).toBe(all.id);
    expect(all.hidden).toBe(true);
    toggle.click();
    expect(all.hidden).toBe(false);
    expect(help.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const example = Array.from(
      help.querySelectorAll<HTMLButtonElement>(".ordt-example"),
    ).find((b) => b.textContent === "catastale AND NOT comune")!;
    example.click();
    await flush();
    expect(
      container.querySelector<HTMLInputElement>('input[name="text"]')!.value,
    ).toBe("catastale AND NOT comune");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="textMode"]:checked',
      )!.value,
    ).toBe("lucene");
    expect(new URL(requested[0]).searchParams.get("q")).toBe(
      "(catastale AND NOT comune)",
    );
    // A search from the form folds the help away with the filters.
    expect(all.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("explains every Search in option and runs its example", async () => {
    const { requested, container } = await mountPanel(() =>
      fixture("search-alberi.json"),
    );
    searchHelpToggle(container).click();
    const fieldHelp = container.querySelector<HTMLElement>('[id="ordt-field-help"]')!;
    expect(fieldHelp.hidden).toBe(false);

    // One entry per option of the select.
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>(
        'select[name="field"] option',
      ),
    );
    expect(fieldHelp.querySelectorAll("li")).toHaveLength(options.length);
    for (const o of options)
      expect(fieldHelp.textContent).toContain(o.textContent!);

    Array.from(fieldHelp.querySelectorAll<HTMLButtonElement>(".ordt-example"))
      .find((b) => b.textContent === "*CC*")!
      .click();
    await flush();
    expect(
      container.querySelector<HTMLSelectElement>('select[name="field"]')!.value,
    ).toBe("apiso_AccessConstraints_s");
    expect(new URL(requested[0]).searchParams.get("q")).toBe(
      "apiso_AccessConstraints_s:(*CC*)",
    );
  });

  it("explains every Where option and searches the example box", async () => {
    const { requested, container } = await mountPanel(() =>
      fixture("search-alberi.json"),
    );
    searchHelpToggle(container).click();
    const whereHelp = container.querySelector<HTMLElement>('[id="ordt-where-help"]')!;
    expect(whereHelp.hidden).toBe(false);
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>(
        'select[name="where"] option',
      ),
    );
    expect(whereHelp.querySelectorAll("li")).toHaveLength(options.length);
    for (const o of options)
      expect(whereHelp.textContent).toContain(o.textContent!);

    whereHelp.querySelector<HTMLButtonElement>(".ordt-example")!.click();
    await flush();
    expect(
      container.querySelector<HTMLSelectElement>('select[name="where"]')!.value,
    ).toBe("box");
    expect(
      container.querySelector<HTMLInputElement>('input[name="box"]')!.hidden,
    ).toBe(false);
    expect(new URL(requested[0]).searchParams.get("bbox")).toBe("12.95,37.6,14.3,38.3");
  });

  it("copies a curl command for the search on screen", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const copy = container.querySelector<HTMLButtonElement>('[aria-label="Copy query as curl"]')!;
    expect(copy.textContent).toBe("curl");
    expect(copy.disabled).toBe(true);

    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "alberi";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(copy.disabled).toBe(false);
    copy.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("--data-urlencode 'q=(alberi)'"));
    expect(copy.textContent).toBe("✓ copied");
  });

  it("hides footprints globally and one by one", async () => {
    const order: string[] = [];
    const sources = new Set<string>();
    const map = {
      on: () => undefined,
      off: () => undefined,
      getSource: (id: string) => (sources.has(id) ? { setData: () => undefined } : undefined),
      addSource: (id: string) => sources.add(id),
      getLayer: (id: string) => (order.includes(id) ? { id } : undefined),
      addLayer: (layer: { id: string }) => order.push(layer.id),
      getLayersOrder: () => [...order],
      moveLayer: () => undefined,
      setFilter: () => undefined,
      setLayoutProperty: vi.fn(),
      getCanvas: () => ({ style: {} }),
    };
    const { host, container } = await mountPanel(() => fixture("search-alberi.json"));
    host.getMap = () => map as never;
    const global = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Hide footprints",
    )!;
    expect(global.disabled).toBe(true);

    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(global.disabled).toBe(false);
    const single = container.querySelector<HTMLButtonElement>(".ordt-footprint-toggle")!;
    expect(single.textContent).toBe("Hide footprint");

    single.click();
    expect(single.textContent).toBe("Show footprint");

    global.click();
    expect(global.textContent).toBe("Show footprints");
    expect(single.disabled).toBe(true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("openrndt-geolibre-footprints-fill", "visibility", "none");

    global.click();
    expect(global.textContent).toBe("Hide footprints");
    expect(single.disabled).toBe(false);
    expect(single.textContent).toBe("Hide footprint");
  });

  it("asks before downloading more WFS features than the limit", async () => {
    const hits = '<wfs:FeatureCollection numberMatched="22521" numberReturned="0"/>';
    const features = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [46, 13] } }] });
    const { host, requested, container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search")
        ? fixture("search-alberi.json")
        : /RESULTTYPE=hits/i.test(url)
          ? hits
          : /REQUEST=GetFeature/i.test(url)
            ? features
            : fixture("wfs-fvg-200.xml"),
    );
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    const item = openDetail(card);
    const areaButtons = () => Array.from(item.querySelectorAll<HTMLButtonElement>("button"));
    await flush();
    areaButtons().find((b) => b.textContent === "Add features")!.click();
    await flush();
    await flush();

    expect(item.textContent).toContain("22,521 features in this area");
    expect(requested.some((u) => /REQUEST=GetFeature/i.test(u) && !/RESULTTYPE=hits/i.test(u))).toBe(false);

    areaButtons().find((b) => b.textContent === "Download all")!.click();
    await flush();
    await flush();
    const getFeature = new URL(requested.find((u) => /REQUEST=GetFeature/i.test(u) && !/RESULTTYPE=hits/i.test(u))!);
    expect(getFeature.searchParams.get("COUNT")).toBe("22521");
    expect(host.addGeoJsonLayer).toHaveBeenCalled();
    expect(item.textContent).toContain("Added 1 of 22,521 features");
  });

  it("converts WFS features in a projected system with the host's proj4", async () => {
    const features = JSON.stringify({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::3003" } },
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1684025.02199723, 4847704.06671932] } }],
    });
    const { host, container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search")
        ? fixture("search-alberi.json")
        : /RESULTTYPE=hits/i.test(url)
          ? '<wfs:FeatureCollection numberMatched="1" numberReturned="0"/>'
          : /REQUEST=GetFeature/i.test(url)
            ? features
            : fixture("wfs-fvg-200.xml"),
    );
    host.getProj4 = vi.fn(() => import("proj4"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    const item = openDetail(card);
    await flush();
    Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add features")!.click();
    for (let i = 0; i < 4; i++) await flush();

    expect(host.getProj4).toHaveBeenCalledTimes(1);
    const data = vi.mocked(host.addGeoJsonLayer!).mock.calls[0][1] as FeatureCollection;
    const [lon, lat] = (data.features[0].geometry as { coordinates: number[] }).coordinates;
    expect(lon).toBeCloseTo(11.2857, 3);
    expect(lat).toBeCloseTo(43.7594, 3);
  });

  it("dresses WFS features with the server's SLD when the host can import a style", async () => {
    const features = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [46, 13] } }] });
    const sld = '<StyledLayerDescriptor version="1.0.0"><NamedLayer/></StyledLayerDescriptor>';
    let styles = sld;
    const { host, requested, container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search")
        ? fixture("search-alberi.json")
        : /RESULTTYPE=hits/i.test(url)
          ? '<wfs:FeatureCollection numberMatched="1" numberReturned="0"/>'
          : /REQUEST=GetStyles/i.test(url)
            ? styles
            : /REQUEST=GetFeature/i.test(url)
              ? features
              : fixture("wfs-fvg-200.xml"),
    );
    host.importLayerStyle = vi.fn(() => ({ ok: true, warnings: ["label placement"] }));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    const item = openDetail(card);
    await flush();
    const add = () => Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add features")!;
    add().click();
    for (let i = 0; i < 4; i++) await flush();

    const getStyles = new URL(requested.find((u) => /REQUEST=GetStyles/i.test(u))!);
    expect(getStyles.searchParams.get("SERVICE")).toBe("WMS");
    expect(getStyles.searchParams.get("LAYERS")).toBeTruthy();
    expect(host.importLayerStyle).toHaveBeenCalledWith("geojson-1", sld);
    expect(item.textContent).toContain("Added 1 features. Drawn with the server's style, except 1 part GeoLibre cannot show.");

    // A server that answers no SLD: the default style stays, without an error.
    styles = '<ServiceExceptionReport><ServiceException>no WMS here</ServiceException></ServiceExceptionReport>';
    add().click();
    for (let i = 0; i < 4; i++) await flush();
    expect(host.importLayerStyle).toHaveBeenCalledTimes(1);
    expect(item.textContent).toContain("Added 1 features.");
    expect(item.textContent).not.toContain("server's style");
    expect(item.textContent).not.toContain("WFS error");
  });

  it("filters on a record's organisation, keeping the other filters", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "alberi";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const name = container.querySelector(".ordt-org-name")!.textContent;
    const org = container.querySelector<HTMLButtonElement>(".ordt-org")!;
    expect(org.textContent).toBe("Show only this organisation");
    org.click();
    await flush();
    expect(container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value).toBe(name);
    expect(container.querySelector<HTMLDetailsElement>(".ordt-more")!.open).toBe(true);
    const q = new URL(requested.at(-1)!).searchParams.get("q")!;
    expect(q).toContain("(alberi)");
    expect(q).toContain("EnteResponsabile_s:");

    // The × empties the filter and searches again without it.
    const clear = container.querySelector<HTMLButtonElement>(".ordt-clear")!;
    expect(clear.hidden).toBe(false);
    clear.click();
    await flush();
    expect(container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value).toBe("");
    expect(clear.hidden).toBe(true);
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toBe("(alberi)");
  });

  it("hides a record's organisation from its ⋯ menu", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const name = container.querySelector(".ordt-org-name")!.textContent!;
    const hide = container.querySelector<HTMLButtonElement>(".ordt-hide-org")!;
    expect(hide.textContent).toBe(`Hide results from ${name}`);
    hide.click();
    await flush();
    const organisation = container.querySelector<HTMLInputElement>('input[name="organisation"]')!;
    const hiding = container.querySelector<HTMLInputElement>('input[name="orgMode"][value="hide"]')!;
    expect(organisation.value).toBe(name);
    expect(hiding.checked).toBe(true);
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toMatch(/^NOT EnteResponsabile_s:/);
    expect(Array.from(container.querySelectorAll(".ordt-chip"), (c) => c.firstChild!.textContent)).toEqual(["Map view", `Hiding: ${name}`]);

    // "Show only this organisation" keeps only that organisation again.
    container.querySelector<HTMLButtonElement>(".ordt-org")!.click();
    await flush();
    expect(hiding.checked).toBe(false);
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toMatch(/^EnteResponsabile_s:/);
  });

  it("opens a record from its id, whatever the filters", async () => {
    const all = JSON.parse(fixture("search-alberi.json"));
    const one = JSON.stringify({ ...all, total: 1, results: all.results.slice(0, 1) });
    const id = all.results[0].id as string;
    const { requested, container } = await mountPanel(() => one);
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = id;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(requested).toHaveLength(1);
    const url = new URL(requested[0]);
    expect(url.searchParams.get("q")).toBe(`(fileid:"${id}")`);
    expect(url.searchParams.get("bbox")).toBeNull();
    const detail = container.querySelector<HTMLElement>(".ordt-detail-view")!;
    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toContain(all.results[0].title);
    expect(chipLabels(container)).toEqual([]);
  });

  it("opens the record with exactly that id when the catalogue also finds longer ids", async () => {
    // fileid:"r_liguri:D.5" finds r_liguri:D.5, r_liguri:D.5.DS and r_liguri:D.5.VS.
    const all = JSON.parse(fixture("search-alberi.json"));
    const id = all.results[1].id as string;
    const results = [{ ...all.results[0], id: `${id}.DS` }, all.results[1], { ...all.results[2], id: `${id}.VS` }];
    const { requested, container } = await mountPanel(() => JSON.stringify({ ...all, total: 3, results }));
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = id;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(requested).toHaveLength(1);
    const detail = container.querySelector<HTMLElement>(".ordt-detail-view")!;
    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toContain(all.results[1].title);
  });

  it("searches as usual when the id-like text is not a record id", async () => {
    const { requested, container } = await mountPanel((url) =>
      url.includes("fileid") ? JSON.stringify({ start: 1, num: 20, total: 0, results: [] }) : fixture("search-alberi.json"),
    );
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "keywords_s:alberi";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(requested).toHaveLength(2);
    expect(new URL(requested[1]).searchParams.get("q")).not.toContain("fileid");
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(5);
  });

  it("shows form errors without calling the catalogue", async () => {
    const { requested, container } = await mountPanel(() => "{}");
    container.querySelector<HTMLSelectElement>('select[name="where"]')!.value = "box";
    container.querySelector<HTMLInputElement>('input[name="box"]')!.value = "13, 41, 12, 42";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(requested).toHaveLength(0);
    expect(container.querySelector(".ordt-status")!.textContent).toMatch(/West must be less than east/);
  });
});

describe("groupServices", () => {
  it("merges links to the same OGC endpoint and keeps the layer hint", async () => {
    const { groupServices } = await import("../src/rndt/panel");
    const groups = groupServices([
      { kind: "WFS", url: "https://serviziogc.regione.fvg.it/geoserver/PPR/wfs?request=GetCapabilities&service=wfs&version=2.0.0" },
      {
        kind: "WFS",
        url: "https://serviziogc.regione.fvg.it/geoserver/PPR/wfs?version=2.0.0&service=wfs&request=GetFeature&typeName=PPR:v_alberi_monumentali_e_notevoli",
      },
      { kind: "download", url: "https://x.it/a.zip" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].layerHint).toBe("PPR:v_alberi_monumentali_e_notevoli");
  });

  it("merges the same endpoint declared as http and https, keeping https", async () => {
    const { groupServices } = await import("../src/rndt/panel");
    const groups = groupServices([
      { kind: "WMS", url: "http://servizigis.regione.emilia-romagna.it/wms/rer2022_nir" },
      {
        kind: "WMS",
        url: "https://servizigis.regione.emilia-romagna.it/wms/rer2022_nir?request=GetCapabilities&service=WMS",
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].url).toMatch(/^https:/);
  });

  it("merges a GeoServer endpoint declared as /ows and as /wms", async () => {
    const { groupServices } = await import("../src/rndt/panel");
    const groups = groupServices([
      { kind: "WMS", url: "https://geoservizi.regione.liguria.it/geoserver/M1440/ows?service=WMS&" },
      { kind: "WMS", url: "https://geoservizi.regione.liguria.it/geoserver/M1440/wms?version=1.3.0&request=getcapabilities" },
      { kind: "WFS", url: "https://geoservizi.regione.liguria.it/geoserver/M1440/wfs" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["WMS", "WFS"]);
  });
});

describe("panel lifecycle and safety", () => {
  it("keeps results when the panel is closed and reopened", async () => {
    const { container, cleanup, getPanel } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(5);
    // Host closes the panel: cleanup, then empties the container.
    (cleanup as () => void)();
    container.replaceChildren();
    const reopened = document.createElement("div");
    getPanel()!.render(reopened);
    expect(reopened.querySelectorAll(".ordt-result")).toHaveLength(5);
  });

  it("drops non-web links declared in records", async () => {
    const { extractServices } = await import("../src/rndt/records");
    expect(
      extractServices({
        links: [
          { rel: "related", dctype: "WMS", href: "javascript:alert(1)" },
          { rel: "related", dctype: "WMS", href: "https://x.it/wms" },
        ],
      }),
    ).toEqual([{ kind: "WMS", url: "https://x.it/wms" }]);
  });

  it("registers a toolbar menu that reopens the panel", async () => {
    const ctx = createHost(() => "{}");
    let menu: { items: { id?: string; onSelect?: () => void }[] } | null = null;
    ctx.host.registerToolbarMenu = (m) => {
      menu = m as typeof menu;
      return () => undefined;
    };
    plugin.activate(ctx.host);
    menu!.items.find((i) => i.id === "open")!.onSelect!();
    expect(ctx.host.openRightPanel).toHaveBeenCalledTimes(2);
    plugin.deactivate(ctx.host);
  });
});

describe("closing the panel", () => {
  it("asks GeoLibre to deactivate the plugin when the panel is closed with X", () => {
    const ctx = createHost(() => "{}");
    plugin.activate(ctx.host);
    expect((ctx.getPanel() as unknown as { deactivatePluginOnClose?: boolean }).deactivatePluginOnClose).toBe(true);
    plugin.deactivate(ctx.host);
  });
});

describe("map view when the plugin is turned on", () => {
  afterEach(() => vi.useRealTimers());

  const activateWith = (view: [number, number, number, number] | null) => {
    vi.useFakeTimers();
    const ctx = createHost(() => "{}");
    ctx.host.getViewBounds = () => view;
    plugin.activate(ctx.host);
    vi.advanceTimersByTime(600);
    plugin.deactivate(ctx.host);
    return vi.mocked(ctx.host.fitBounds!);
  };

  it("waits for the map to take its new width beside the panel", () => {
    vi.useFakeTimers();
    const ctx = createHost(() => "{}");
    ctx.host.getViewBounds = () => [-203.3, -16.3, 3.3, 83.1];
    let onResize = () => {};
    const map = { on: (_: string, f: () => void) => (onResize = f), off: vi.fn() };
    ctx.host.getMap = () => map as never;
    plugin.activate(ctx.host);
    const fit = vi.mocked(ctx.host.fitBounds!);
    vi.advanceTimersByTime(500);
    onResize();
    vi.advanceTimersByTime(140);
    expect(fit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(fit).toHaveBeenCalledWith(ITALY_BBOX);
    expect(map.off).toHaveBeenCalled();
    plugin.deactivate(ctx.host);
  });

  it("does not move the map of a plugin turned off at once", () => {
    vi.useFakeTimers();
    const ctx = createHost(() => "{}");
    ctx.host.getViewBounds = () => [-203.3, -16.3, 3.3, 83.1];
    plugin.activate(ctx.host);
    plugin.deactivate(ctx.host);
    vi.advanceTimersByTime(1000);
    expect(ctx.host.fitBounds).not.toHaveBeenCalled();
  });

  it("moves to Italy a view that does not touch it (GeoLibre's opening view)", () => {
    expect(activateWith([-203.3, -16.3, 3.3, 83.1])).toHaveBeenCalledWith(ITALY_BBOX);
  });

  it("moves to Italy the opening globe, whose bounds touch Italy without showing it", () => {
    expect(activateWith([-180, -35.4571, 180, 90])).toHaveBeenCalledWith(ITALY_BBOX);
  });

  it("moves to Italy a view of all Europe, or one centred elsewhere", () => {
    expect(activateWith([-30, 20, 40, 60])).toHaveBeenCalledWith(ITALY_BBOX);
    expect(activateWith([-2, 43, 6, 49])).toHaveBeenCalledWith(ITALY_BBOX);
  });

  it("leaves a view on Italy where it is", () => {
    expect(activateWith([12, 41, 13, 42])).not.toHaveBeenCalled();
    expect(activateWith([-7.7924, 31.633, 30.7004, 54.1343])).not.toHaveBeenCalled();
  });

  it("does nothing when the map has no view yet", () => {
    expect(activateWith(null)).not.toHaveBeenCalled();
  });
});

describe("drawn area", () => {
  it("turns on GeoEditor when 'Drawn shapes' is picked and nothing is drawn", async () => {
    const ctx = await mountPanel(() => "{}");
    ctx.host.activatePlugin = vi.fn(async () => true);
    const where = ctx.container.querySelector<HTMLSelectElement>('select[name="where"]')!;
    where.value = "drawn";
    where.dispatchEvent(new Event("change"));
    await flush();
    expect(ctx.host.activatePlugin).toHaveBeenCalledWith("maplibre-gl-geo-editor");
    expect(ctx.container.querySelector(".ordt-status")!.textContent).toMatch(/GeoEditor is on/);
  });

  it("uses the bounding box of drawn shapes", async () => {
    const ctx = await mountPanel(() => fixture("search-alberi.json"));
    ctx.host.getDrawnFeatures = () => [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[10, 43], [11.5, 43], [11.5, 44], [10, 44], [10, 43]]] } },
    ];
    ctx.container.querySelector<HTMLSelectElement>('select[name="where"]')!.value = "drawn";
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(new URL(ctx.requested[0]).searchParams.get("bbox")).toBe("10,43,11.5,44");
  });
});

describe("zoom to a record", () => {
  it("offers a 'Zoom to extent' link in the record details", async () => {
    const ctx = await mountPanel(() => fixture("search-alberi.json"));
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const first = ctx.container.querySelector<HTMLElement>(".ordt-result")!;
    const zoom = Array.from(first.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Zoom to extent")!;
    zoom.click();
    expect(ctx.host.fitBounds).toHaveBeenLastCalledWith([6.62, 44.06, 9.21, 46.459999084472656]);
  });
});

describe("readable layer names (#7)", () => {
  /** Title and code of each row of the WFS list, as "title | code" (code only when a title was found). */
  const rows = (item: HTMLElement) =>
    Array.from(item.querySelectorAll<HTMLElement>('[aria-label="WFS feature types"] .ordt-layer'), (row) => {
      const code = row.querySelector<HTMLElement>(".ordt-layer-code")!;
      return code.hidden ? row.querySelector(".ordt-layer-title")!.textContent : `${row.querySelector(".ordt-layer-title")!.textContent} | ${code.textContent}`;
    });
  const checkedValue = (item: HTMLElement) =>
    item.querySelector<HTMLInputElement>('[aria-label="WFS feature types"] input:checked')?.value;

  // A WFS whose titles are codes, like FVG RIFIUTI; 35 types so the filter shows.
  const codes = ["TDLD8", "UCEM", "RAEER3", ...Array.from({ length: 32 }, (_, i) => `X${i}`)];
  const wfsCaps = `<wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0.0">
<ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:DCP><ows:HTTP><ows:Get xlink:href="https://serviziogc.regione.fvg.it/geoserver/RIFIUTI/wfs"/></ows:HTTP></ows:DCP>
<ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/json</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation></ows:OperationsMetadata>
<wfs:FeatureTypeList>${codes.map((c) => `<wfs:FeatureType><wfs:Name>RIFIUTI:${c}</wfs:Name><wfs:Title>${c}</wfs:Title></wfs:FeatureType>`).join("")}</wfs:FeatureTypeList></wfs:WFS_Capabilities>`;

  async function openWfs(caps = wfsCaps) {
    const ctx = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search") && url.includes("f=csw")) return fixture("csw-fvg-rifiuti.xml");
      if (url.includes("/rest/metadata/search")) return fixture("search-alberi.json");
      return caps;
    });
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    const item = openDetail(card);
    await flush();
    return { ...ctx, item };
  }

  it("points to GeoLibre's own WFS layer when the service offers no GeoJSON", async () => {
    const { item } = await openWfs(wfsCaps.replace("application/json", "text/xml; subtype=gml/3.2"));
    await flush();
    expect(item.textContent).toContain("This WFS offers no GeoJSON output, so the plugin cannot add it.");
    expect(item.textContent).toContain("Add Data > WFS Layer can read GML services: Copy URL above and try it there.");
    expect(item.querySelector('[aria-label="WFS feature types"]')).toBeNull();
  });

  it("shows the codes first, then RNDT titles with the code below", async () => {
    const { item } = await openWfs();
    await flush();
    const labels = rows(item);
    expect(labels).toContain("Trattamento chimico-fisico e biologico di rifiuti liquidi D8 (TDLD8) | RIFIUTI:TDLD8");
    expect(labels).toContain("Recupero RAEE R3 (RAEER3) | RIFIUTI:RAEER3");
    expect(labels).toContain("RIFIUTI:X0");
    // A WFS takes one feature type at a time.
    expect(item.querySelectorAll('[aria-label="WFS feature types"] input[type="radio"]')).toHaveLength(35);
    expect(item.textContent).toMatch(/Readable names from RNDT for 3 of 35 layers/);
  });

  it("on reaching the list, searches RNDT for each layer still without a name", async () => {
    const byCode = (q: string) =>
      `<csw:GetRecordsResponse xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:dc="http://purl.org/dc/elements/1.1/"><csw:SearchResults numberOfRecordsMatched="1">${
        q.endsWith(" AND X5") ? "<csw:Record><dc:title>Readable X5</dc:title></csw:Record>" : ""
      }</csw:SearchResults></csw:GetRecordsResponse>`;
    const ctx = await mountPanel((url) => {
      const q = new URL(url).searchParams.get("q") ?? "";
      if (url.includes("f=csw") && q.includes(" AND ")) return byCode(q);
      if (url.includes("/rest/metadata/search") && url.includes("f=csw")) return fixture("csw-fvg-rifiuti.xml");
      if (url.includes("/rest/metadata/search")) return fixture("search-alberi.json");
      return wfsCaps;
    });
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    const item = openDetail(card);
    await flush();
    await flush();
    const byCodeCalls = () => ctx.requested.filter((u) => (new URL(u).searchParams.get("q") ?? "").includes(" AND "));
    expect(byCodeCalls()).toHaveLength(0); // nothing until the user reaches the list

    const list = item.querySelector<HTMLElement>('[aria-label="WFS feature types"]')!;
    list.dispatchEvent(new Event("pointerenter")); // folded: no lookup yet
    expect(byCodeCalls()).toHaveLength(0);
    showAll(item);
    list.dispatchEvent(new Event("focusin")); // the same visit: no second round
    for (let i = 0; i < 12; i++) await flush();
    expect(byCodeCalls()).toHaveLength(32);
    expect(rows(item)).toContain("Readable X5 | RIFIUTI:X5");
    expect(item.textContent).toMatch(/Readable names from RNDT for 4 of 35 layers/);
  });

  it("above 1,000 RNDT records, looks up the selected layer only", async () => {
    const big = fixture("csw-fvg-rifiuti.xml").replace('numberOfRecordsMatched="245"', 'numberOfRecordsMatched="1500"');
    const ctx = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search") && url.includes("f=csw")) return big;
      if (url.includes("/rest/metadata/search")) return fixture("search-alberi.json");
      return wfsCaps;
    });
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    const item = openDetail(card);
    await flush();
    await flush();
    // Nothing ticked yet: the note says so, it is not left "looking up".
    const note = Array.from(item.querySelectorAll<HTMLElement>(".ordt-note")).find((n) => /RNDT/.test(n.textContent!))!;
    expect(note.textContent).toBe("Readable names are looked up in RNDT for the selected layer only.");
    expect(note.dataset.kind).toBe("info");
    const ucem = item.querySelector<HTMLInputElement>('[aria-label="WFS feature types"] input[value="RIFIUTI:UCEM"]')!;
    ucem.checked = true;
    ucem.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const targeted = ctx.requested.filter((u) => u.includes("f=csw")).map((u) => new URL(u).searchParams.get("q"));
    expect(targeted.some((q) => q?.endsWith("*UCEM*"))).toBe(true);
    expect(rows(item)).toContain("Utilizzo in cementifici R5 (UCEM) | RIFIUTI:UCEM");
    expect(item.textContent).toMatch(/looked up in RNDT for the selected layer only/);
  });

  it("opens folded above 8 layers: the ticked row and a button, then the whole list with its filter", async () => {
    const { item } = await openWfs();
    await flush();
    const visible = () =>
      Array.from(item.querySelectorAll<HTMLElement>('[aria-label="WFS feature types"] .ordt-layer')).filter((row) => !row.hidden);
    const filter = item.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!;
    // Nothing ticked here (35 types, none wanted): no rows, no box, the button alone.
    expect(visible()).toEqual([]);
    expect(item.querySelector<HTMLElement>('[aria-label="WFS feature types"]')!.hidden).toBe(true);
    expect(filter.hidden).toBe(true);
    const show = item.querySelector<HTMLButtonElement>(".ordt-show-layers")!;
    expect(show.textContent).toBe("Show all 35 layers to choose from");
    const box = item.querySelector<HTMLElement>('[aria-label="WFS feature types"]')!.parentElement!;
    const scrolled = (box.scrollIntoView = vi.fn());
    show.click();
    // The open list takes room: its box, button included, is brought back in sight.
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect(visible()).toHaveLength(35);
    expect(item.querySelector<HTMLElement>('[aria-label="WFS feature types"]')!.hidden).toBe(false);
    expect(filter.hidden).toBe(false);
    expect(item.querySelector(".ordt-show-layers")).toBeNull();
  });

  it("filters a long list on name and readable name", async () => {
    const { item } = await openWfs();
    await flush();
    showAll(item);
    const filter = item.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!;
    filter.value = "cementifici";
    filter.dispatchEvent(new Event("input"));
    const visible = Array.from(item.querySelectorAll<HTMLElement>('[aria-label="WFS feature types"] .ordt-layer'))
      .filter((row) => !row.hidden)
      .map((row) => row.querySelector("input")!.value);
    expect(visible).toEqual(["RIFIUTI:UCEM"]);
    // One choice only: it moves to the row left in sight.
    expect(checkedValue(item)).toBe("RIFIUTI:UCEM");
  });
});

describe("pager at the top of the list (#12)", () => {
  const pagers = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>(".ordt-pager")).map((p) =>
      Array.from(p.querySelectorAll<HTMLButtonElement>("button")).map((b) => `${b.textContent}:${b.disabled ? "off" : "on"}`),
    );

  it("shows the same pager above and below the list", async () => {
    // Fixture: 41 records in total, first page.
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const top = container.querySelector(".ordt-pager-top")!;
    // In the sticky results header, right above the list.
    const head = top.closest(".ordt-results-head");
    expect(head).not.toBeNull();
    expect(head!.nextElementSibling?.classList.contains("ordt-results")).toBe(true);
    expect(pagers(container)).toEqual([
      ["‹:off", "›:on"],
      ["‹ Previous:off", "Next ›:on"],
    ]);
    // The range sits between the header arrows.
    expect(top.textContent).toBe("‹1-5 of 41›");
  });

  it("the top Next asks for the next page and both pagers follow", async () => {
    const { container, requested } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    expect(new URL(requested.at(-1)!).searchParams.get("start")).toBe("21");
    expect(pagers(container)).toEqual([
      ["‹:on", "›:on"],
      ["‹ Previous:on", "Next ›:on"],
    ]);
  });

  it("has no pager on a single page", async () => {
    const one = JSON.parse(fixture("search-alberi.json"));
    one.total = 5;
    const { container } = await mountPanel(() => JSON.stringify(one));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(pagers(container)).toEqual([[], []]);
  });
});

describe("folded filters after a search", () => {
  it("folds the form into chips of the filters, and unfolds it on request", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    const summary = container.querySelector<HTMLElement>(".ordt-summary")!;
    const tools = container.querySelector<HTMLElement>(".ordt-head-tools")!;
    expect(summary.hidden).toBe(true);
    expect(tools.hidden).toBe(true);

    // The text box lives in the search bar, outside the form, and still counts.
    const text = container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!;
    expect(form.contains(text)).toBe(false);
    text.value = "alberi";
    container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value = "Regione Piemonte, Comune di Torino";
    container.querySelector<HTMLInputElement>('input[name="orgMode"][value="hide"]')!.checked = true;
    container.querySelector<HTMLInputElement>('input[name="availableAs"][value="WMS"]')!.checked = true;
    form.requestSubmit();
    await flush();

    expect(form.hidden).toBe(true);
    expect(tools.hidden).toBe(false);
    expect(summary.hidden).toBe(false);
    // No chip for the text: it is in the search bar.
    // The default area, the map view, is a filter too.
    expect(chipLabels(container)).toEqual(["WMS", "Map view", "Hiding: Regione Piemonte", "Hiding: Comune di Torino"]);
    const toggle = Array.from(summary.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Edit filters")!;
    toggle.click();
    expect(form.hidden).toBe(false);
    expect(toggle.textContent).toBe("Hide filters");
    // Organisation is an advanced filter: editing opens that part.
    expect(container.querySelector<HTMLDetailsElement>(".ordt-more")!.open).toBe(true);

    Array.from(container.querySelectorAll<HTMLButtonElement>(".ordt-menu-item")).find((b) => b.textContent === "Clear results")!.click();
    expect(form.hidden).toBe(false);
    expect(summary.hidden).toBe(true);
    expect(tools.hidden).toBe(true);
  });

  it("removes one filter with its chip and searches again", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value = "Regione Piemonte, Comune di Torino";
    container.querySelector<HTMLInputElement>('input[name="orgMode"][value="hide"]')!.checked = true;
    container.querySelector<HTMLInputElement>('input[name="openData"]')!.checked = true;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    container.querySelector<HTMLButtonElement>('[aria-label="Remove Hiding: Regione Piemonte"]')!.click();
    await flush();
    expect(container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value).toBe("Comune di Torino");
    expect(chipLabels(container)).toEqual(["Map view", "Hiding: Comune di Torino", "Open data only"]);
    const q = new URL(requested.at(-1)!).searchParams.get("q")!;
    expect(q).toContain("NOT EnteResponsabile_s:");
    expect(q).not.toContain("Piemonte");
  });

  it("Clear all removes every filter, keeps the text and searches again", async () => {
    // Panels of earlier tests share the form id, and the text box would join their form.
    document.body.replaceChildren();
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    const clearAll = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>(".ordt-summary button")).find((b) => b.textContent === "Clear all")!;

    form.requestSubmit(); // only the default area: one chip, and Clear all already there
    await flush();
    expect(chipLabels(container)).toEqual(["Map view"]);
    expect(clearAll().hidden).toBe(false);

    const text = container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!;
    const organisation = container.querySelector<HTMLInputElement>('input[name="organisation"]')!;
    const hiding = container.querySelector<HTMLInputElement>('input[name="orgMode"][value="hide"]')!;
    const dateFrom = container.querySelector<HTMLInputElement>('input[name="dateFrom"]')!;
    text.value = "alberi";
    organisation.value = "Comune di Livorno";
    hiding.checked = true;
    dateFrom.value = "2026-09-23";
    form.requestSubmit();
    await flush();
    expect(clearAll().hidden).toBe(false);

    clearAll().click();
    await flush();
    expect([text.value, organisation.value, hiding.checked, dateFrom.value]).toEqual(["alberi", "", false, ""]);
    // Clear all removes the area too: the whole catalogue.
    expect(container.querySelector<HTMLSelectElement>('select[name="where"]')!.value).toBe("anywhere");
    expect(new URL(requested.at(-1)!).searchParams.get("bbox")).toBeNull();
    // The segmented choices go back to their defaults, not to nothing.
    const checked = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
    expect([checked("kind"), checked("textMode"), checked("orgMode")]).toEqual(["all", "all", "only"]);
    expect(container.querySelector<HTMLElement>(".ordt-count")!.hidden).toBe(true);
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toBe("(alberi)");
    expect(chipLabels(container)).toEqual([]);
    // No filter left: the chip row gives way to the Filters link.
    expect(container.querySelector<HTMLElement>(".ordt-summary")!.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>(".ordt-filters-link")!.hidden).toBe(false);
    expect(clearAll().hidden).toBe(true);
  });

  it("sorts by metadata date, newest first, when no text is searched; by relevance with a text", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    form.requestSubmit();
    await flush();
    expect(new URL(requested.at(-1)!).searchParams.get("sort")).toBe("apiso_Modified_dt:desc");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Sort results"]')!.value).toBe("apiso_Modified_dt:desc");
    // The form itself still says Relevance: a text brings it back.
    expect(container.querySelector<HTMLSelectElement>('select[name="sort"]')!.value).toBe("");
    const text = container.querySelector<HTMLInputElement>('input[name="text"]')!;
    text.value = "alberi";
    form.requestSubmit();
    await flush();
    expect(new URL(requested.at(-1)!).searchParams.get("sort")).toBeNull();
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Sort results"]')!.value).toBe("");
  });

  it("sorts from the results header, from the first page", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    const sort = container.querySelector<HTMLSelectElement>('[aria-label="Sort results"]')!;
    sort.value = "title:asc";
    sort.dispatchEvent(new Event("change"));
    await flush();
    const url = new URL(requested.at(-1)!);
    expect(url.searchParams.get("sort")).toBe("title:asc");
    expect(url.searchParams.get("start")).toBe("1");
    // The form follows, so the next search from the form keeps the order.
    expect(container.querySelector<HTMLSelectElement>('select[name="sort"]')!.value).toBe("title:asc");
  });

  it("fills the date range from the Last week / month / year presets", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 31, 10));
    try {
      const { container } = await mountPanel(() => fixture("search-alberi.json"));
      const from = container.querySelector<HTMLInputElement>('input[name="dateFrom"]')!;
      const to = container.querySelector<HTMLInputElement>('input[name="dateTo"]')!;
      const preset = (label: string) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>(".ordt-date-presets button")).find(
          (b) => b.textContent === label,
        )!;
      to.value = "2026-12-31";
      preset("Last week").click();
      expect([from.value, to.value]).toEqual(["2026-03-24", ""]);
      preset("Last month").click();
      expect(from.value).toBe("2026-03-01");
      preset("Last year").click();
      expect(from.value).toBe("2025-03-31");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the filters as they are when changing page", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    form.requestSubmit();
    await flush();
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ordt-summary button")).find((b) => b.textContent === "Edit filters")!.click();
    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    expect(form.hidden).toBe(false);
  });
});

describe("Report the error", () => {
  it("copies a report for the record's contact, RNDT in copy, when a service fails", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search")) return fixture("search-alberi.json");
      throw new Error("cannot reach example.org: HTTP 400");
    });
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WMS"),
    )!;
    const item = openDetail(card);
    await flush();
    await flush();

    const button = item.querySelector<HTMLButtonElement>(".ordt-report")!;
    expect(button.textContent).toBe("Copy error report");
    expect(button.parentElement!.textContent).toMatch(/\(to [^@\s]+@[^\s,]+, RNDT in copy\)$/);
    button.click();
    await flush();
    expect(button.textContent).toBe("Copied: paste it into a new email");
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    const title = item.querySelector(".ordt-detail-title")!.textContent!;
    expect(text).toMatch(/^A: [^@\s]+@\S+\nCc: info@rndt\.gov\.it\n/);
    expect(text).toContain(`\nOggetto: Errore nel caricamento del servizio WMS - ${title}\n\nBuongiorno,\n\nvi scrivo come referenti`);
    expect(text).toContain("Metto in copia il RNDT.");
    expect(text).toContain(`Scheda: ${title}`);
    expect(text).toMatch(/\nErrore: WMS error: cannot reach .*HTTP 400\n/);
    expect(text).toMatch(/Data e ora \(UTC\): \d{4}-\d\d-\d\d \d\d:\d\d/);
  });

  it("offers no report for a service the web version cannot read (no CORS headers)", async () => {
    const fetchMock = vi.fn(async () => new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search")) return fixture("search-alberi.json");
      throw new TypeError("NetworkError when attempting to fetch resource.");
    });
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WMS"),
    )!;
    const item = openDetail(card);
    for (let i = 0; i < 6; i++) await flush();
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ mode: "no-cors" }));
    expect(item.textContent).toMatch(/WMS error: \S+ answers, but a web page cannot read it: the server sends no CORS headers\. The service works in GeoLibre Desktop/);
    expect(item.querySelector(".ordt-report")).toBeNull();
  });

  it("addresses RNDT alone when the record names no contact", async () => {
    const { errorReport, emailText: errorReportText } = await import("../src/rndt/panel");
    const record = {
      id: "x:1",
      title: "Carta",
      abstract: "",
      type: "service",
      organisation: "",
      contactEmails: [],
      modified: "",
      bbox: null,
      services: [],
      otherLinks: [],
      htmlUrl: "https://geodati.gov.it/RNDT/rest/metadata/item/x%3A1/html",
      xmlUrl: "",
    };
    const report = errorReport(record, { kind: "WMS", url: "https://example.org/wms" } as never, "WMS error: HTTP 500", new Date("2026-09-30T19:29:00Z"));
    expect([report.to, report.cc]).toEqual([["info@rndt.gov.it"], []]);
    const text = errorReportText(report);
    expect(text).toMatch(/^A: info@rndt\.gov\.it\nOggetto: /);
    expect(text).toContain("Buongiorno,\n\nvi ringrazio per il catalogo RNDT.");
    expect(text).not.toContain("Ente:");
    expect(text).toContain("Data e ora (UTC): 2026-09-30 19:29");
  });

  it("links the plugin repo from the footer", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const repo = container.querySelector<HTMLAnchorElement>('.ordt-footer a[aria-label="The plugin on GitHub"]')!;
    expect(repo.href).toBe("https://github.com/ondata/openrndt-geolibre");
    expect(repo.target).toBe("_blank");
    expect(repo.querySelector("svg")).not.toBeNull();
  });

  it("opens new-tab links in the system browser through the host", async () => {
    const { host, container } = await mountPanel(() => fixture("search-alberi.json"));
    host.openExternalUrl = vi.fn();
    const link = Array.from(container.querySelectorAll<HTMLAnchorElement>('.ordt-footer a[target="_blank"]')).find((a) => a.textContent === "Italian geospatial catalogue")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(host.openExternalUrl).toHaveBeenCalledWith("https://geodati.gov.it/geoportale/");
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps only real addresses from the contact field", async () => {
    const { parseEmails } = await import("../src/rndt/records");
    expect(parseEmails("sinaservice@isprambiente.it")).toEqual(["sinaservice@isprambiente.it"]);
    expect(parseEmails("ad@min")).toEqual([]);
    expect(parseEmails(["a@x.it; b@y.it", "a@x.it"])).toEqual(["a@x.it", "b@y.it"]);
    expect(parseEmails(undefined)).toEqual([]);
  });
});

describe("Settings and the error log", () => {
  const failingWms = async () => {
    const ctx = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search")) return fixture("search-alberi.json");
      throw new Error("cannot reach example.org: HTTP 400");
    });
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WMS"),
    )!;
    openDetail(card);
    await flush();
    await flush();
    return ctx;
  };
  const settingsToggle = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ordt-footer button")).find((b) => b.textContent === "⚙ Settings")!;

  it("logs nothing by default", async () => {
    localStorage.clear();
    const { container } = await failingWms();
    settingsToggle(container).click();
    expect(container.querySelector<HTMLInputElement>('input[name="logErrors"]')!.checked).toBe(false);
    expect(localStorage.getItem("openrndt-geolibre:error-log")).toBeNull();
  });

  it("keeps the choice and logs failing services as JSON Lines", async () => {
    localStorage.clear();
    localStorage.setItem("openrndt-geolibre:settings", JSON.stringify({ logErrors: true }));
    const { host, container } = await failingWms();
    const log = JSON.parse(localStorage.getItem("openrndt-geolibre:error-log")!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ serviceKind: "WMS", error: expect.stringMatching(/^WMS error: cannot reach .*HTTP 400$/) });
    expect(log[0].url).toMatch(/^https?:\/\//);
    expect(log[0].time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

    settingsToggle(container).click();
    const settings = container.querySelector<HTMLElement>(".ordt-settings")!;
    expect(settings.hidden).toBe(false);
    expect(settings.textContent).toContain("1 entry");
    host.exportTextFile = vi.fn();
    Array.from(settings.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Export JSON Lines")!.click();
    const [name, content] = (host.exportTextFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe("openrndt-errors.jsonl");
    expect(content.trim().split("\n").map((line: string) => JSON.parse(line))).toEqual(log);

    Array.from(settings.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Clear log")!.click();
    expect(localStorage.getItem("openrndt-geolibre:error-log")).toBeNull();
    expect(settings.textContent).toContain("0 entries");

    // Turning it off stops the log.
    const box = container.querySelector<HTMLInputElement>('input[name="logErrors"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(JSON.parse(localStorage.getItem("openrndt-geolibre:settings")!)).toEqual({ logErrors: false, rememberSearches: true });
  });

  it("keeps at most 1,000 entries, dropping the oldest", async () => {
    localStorage.clear();
    const { appendErrorLog, readErrorLog } = await import("../src/rndt/settings");
    const entry = (n: number) => ({ time: String(n), recordId: "", recordTitle: "", organisation: "", serviceKind: "WMS", url: "", error: "" });
    for (let n = 1; n <= 1002; n++) appendErrorLog(entry(n));
    const log = readErrorLog();
    expect(log).toHaveLength(1000);
    expect([log[0].time, log.at(-1)!.time]).toEqual(["3", "1002"]);
    localStorage.clear();
  });

  it("works when storage throws", async () => {
    const { loadSettings, appendErrorLog, readErrorLog } = await import("../src/rndt/settings");
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadSettings()).toEqual({ logErrors: false, rememberSearches: true });
    expect(() => appendErrorLog({ time: "", recordId: "", recordTitle: "", organisation: "", serviceKind: "", url: "", error: "" })).not.toThrow();
    expect(readErrorLog()).toEqual([]);
    spy.mockRestore();
    set.mockRestore();
  });
});

describe("Detail view", () => {
  it("shows one record in place of the list, and goes back to it", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const panel = container.querySelector<HTMLElement>(".ordt-panel")!;
    const card = container.querySelectorAll<HTMLElement>(".ordt-result")[1];
    const title = card.querySelector(".ordt-result-title")!.textContent;
    const view = openDetail(card);

    expect(view.hidden).toBe(false);
    expect(panel.classList.contains("ordt-in-detail")).toBe(true);
    expect(view.querySelector(".ordt-detail-title")!.textContent).toBe(title);
    // The way back is in the fixed bar above the view, with the place in the page.
    const bar = container.querySelector<HTMLElement>(".ordt-detail-bar")!;
    expect(bar.hidden).toBe(false);
    expect(view.querySelector(".ordt-back")).toBeNull();
    const back = bar.querySelector<HTMLButtonElement>(".ordt-back")!;
    expect(bar.querySelector(".ordt-detail-position")!.textContent).toBe("2 of 5");
    expect(back.textContent).toBe("← 41 results");
    // Services and links live only in the view, not in the cards.
    expect(container.querySelector(".ordt-results .ordt-services")).toBeNull();

    const scrolled = vi.fn();
    card.scrollIntoView = scrolled;
    back.click();
    expect(view.hidden).toBe(true);
    expect(bar.hidden).toBe(true);
    expect(view.childElementCount).toBe(0);
    expect(panel.classList.contains("ordt-in-detail")).toBe(false);
    // The card just seen is marked and brought to the top of the list.
    expect(card.classList.contains("ordt-last-viewed")).toBe(true);
    expect(scrolled).toHaveBeenCalledWith({ block: "start" });
    // Opening another record moves the mark.
    const other = container.querySelectorAll<HTMLElement>(".ordt-result")[2];
    openDetail(other);
    expect(bar.querySelector(".ordt-detail-position")!.textContent).toBe("3 of 5");
    bar.querySelector<HTMLButtonElement>(".ordt-back")!.click();
    expect(card.classList.contains("ordt-last-viewed")).toBe(false);
    expect(other.classList.contains("ordt-last-viewed")).toBe(true);
  });

  it("gives way to Settings and Search help, whose boxes live outside it", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const view = openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    searchHelpToggle(container).click();
    expect(view.hidden).toBe(true);
    expect(container.querySelector(".ordt-panel")!.classList.contains("ordt-in-detail")).toBe(false);
  });

  it("closes when a new page or search arrives", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const view = openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    expect(view.hidden).toBe(false);
    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    expect(view.hidden).toBe(true);
    expect(container.querySelector(".ordt-panel")!.classList.contains("ordt-in-detail")).toBe(false);
  });
});

describe("WMS layer checklist", () => {
  it("ticks nothing for a service record: it describes the whole service", async () => {
    const { container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-piemonte-111.xml"),
    );
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find(
      (li) => li.querySelector(".ordt-badge-service")?.textContent === "WMS" && li.textContent!.includes("service"),
    )!;
    const item = openDetail(card);
    await flush();
    await flush();
    expect(item.querySelectorAll('[aria-label="WMS layers"] input:checked')).toHaveLength(0);
    const add = item.querySelector<HTMLButtonElement>(".ordt-service .ordt-primary")!;
    expect([add.textContent, add.disabled]).toEqual(["Select a layer", true]);
  });

  it("adds every ticked layer, named with its title, and says which one failed", async () => {
    const { host, container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-piemonte-111.xml"),
    );
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    const item = openDetail(card);
    await flush();
    await flush();
    const boxes = Array.from(item.querySelectorAll<HTMLInputElement>('[aria-label="WMS layers"] input[type="checkbox"]:not(:disabled)'));
    expect(boxes.length).toBeGreaterThan(1);
    tickFirstWms(item);
    expect(boxes.filter((b) => b.checked)).toHaveLength(1);
    const second = boxes.find((b) => !b.checked)!;
    second.checked = true;
    second.dispatchEvent(new Event("change", { bubbles: true }));
    const add = Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add to map (2)")!;
    expect(add).toBeDefined();

    vi.mocked(host.addWmsLayer!).mockImplementationOnce(() => "wms-1").mockImplementationOnce(() => {
      throw new Error("bad bounds");
    });
    add.click();
    const calls = vi.mocked(host.addWmsLayer!).mock.calls;
    expect(calls).toHaveLength(2);
    const secondRow = second.closest(".ordt-layer")!;
    const secondTitle = secondRow.querySelector(".ordt-layer-title")!.textContent;
    expect(calls[1][0]).toBe(secondTitle);
    expect(calls[1][1].layers).toBe(second.value);
    expect(item.textContent).toContain("Added 1 of 2 layers");
    expect(item.textContent).toContain(`Could not add ${secondTitle}: bad bounds`);
  });
});

describe("WMS layers with the same name, or already on the map", () => {
  // Two layers with one title, like Fiesole's plan in force and adopted plan.
  const caps = `<WMS_Capabilities version="1.3.0"><Capability><Request><GetMap><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://example.org/wms"/></Get></HTTP></DCPType></GetMap></Request>
<Layer><CRS>EPSG:3857</CRS>
<Layer><Name>aree_urb_vigente</Name><Title>Zonizzazione dei centri abitati</Title><CRS>EPSG:3857</CRS></Layer>
<Layer><Name>aree_urb_adottato</Name><Title>Zonizzazione dei centri abitati</Title><CRS>EPSG:3857</CRS></Layer>
</Layer></Capability></WMS_Capabilities>`;

  async function openTwin(prepare?: (host: RndtHost) => void) {
    const ctx = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search") && url.includes("f=csw")) throw new Error("no RNDT lookup here");
      if (url.includes("/rest/metadata/search")) return fixture("search-services.json");
      return caps;
    });
    prepare?.(ctx.host);
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    const item = openDetail(card);
    await flush();
    await flush();
    const list = item.querySelector<HTMLElement>('[aria-label="WMS layers"]')!;
    const box = (code: string) => list.querySelector<HTMLInputElement>(`input[value="${code}"]`)!;
    const tick = (code: string, on: boolean) => {
      box(code).checked = on;
      box(code).dispatchEvent(new Event("change", { bubbles: true }));
    };
    const addButton = () => Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent!.startsWith("Add to map"))!;
    return { ...ctx, item, list, box, tick, addButton };
  }

  it("keeps the code in the name when two layers share a title", async () => {
    const { host, list, box, tick, addButton } = await openTwin();
    expect(list.querySelectorAll(".ordt-layer-same-name")).toHaveLength(2);
    tick("aree_urb_vigente", true);
    tick("aree_urb_adottato", true);
    addButton().click();
    expect(vi.mocked(host.addWmsLayer!).mock.calls.map((c) => c[0])).toEqual([
      "Zonizzazione dei centri abitati (aree_urb_vigente)",
      "Zonizzazione dei centri abitati (aree_urb_adottato)",
    ]);
    expect(box("aree_urb_vigente").closest(".ordt-layer")!.textContent).toContain("on the map");
  });

  it("knows a layer that is in the project already, as in a reopened project", async () => {
    const { host, item, box, tick, addButton } = await openTwin((h) => {
      h.getLayers = () => ["saved-1", "other"];
      h.getProjectSnapshot = () => ({
        layers: [
          { id: "saved-1", type: "wms", source: { url: "https://example.org/wms", layers: "aree_urb_vigente" } },
          { id: "gone", type: "wms", source: { url: "https://example.org/wms", layers: "aree_urb_adottato" } },
          { id: "other", type: "geojson" },
        ],
      });
    });
    expect(box("aree_urb_vigente").closest(".ordt-layer")!.textContent).toContain("on the map");
    // In the snapshot but no longer among the project's layers: not on the map.
    expect(box("aree_urb_adottato").closest(".ordt-layer")!.textContent).not.toContain("on the map");
    tick("aree_urb_vigente", true);
    addButton().click();
    expect(host.addWmsLayer).not.toHaveBeenCalled();
    expect(item.textContent).toContain("Already on the map, not added again");
  });

  it("does not add again a layer still on the map, and says so", async () => {
    const { host, item, tick, addButton } = await openTwin();
    let ids: string[] = [];
    let n = 0;
    host.getLayers = () => ids;
    vi.mocked(host.addWmsLayer!).mockImplementation(() => {
      const id = `wms-${++n}`;
      ids = [...ids, id];
      return id;
    });
    tick("aree_urb_vigente", true);
    addButton().click();
    expect(host.addWmsLayer).toHaveBeenCalledTimes(1);

    addButton().click();
    expect(host.addWmsLayer).toHaveBeenCalledTimes(1);
    expect(item.textContent).toContain("Already on the map, not added again: Zonizzazione dei centri abitati (aree_urb_vigente).");

    // Removed from the project: it can be added again.
    ids = [];
    addButton().click();
    expect(host.addWmsLayer).toHaveBeenCalledTimes(2);
  });
});

describe("WMS layers that do not declare EPSG:3857", () => {
  /** The first 24 bytes of a PNG of `size` × `size` pixels. */
  const png = (size: number) =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, size >> 8, size & 255, 0, 0, size >> 8, size & 255]).buffer;

  /**
   * `drawsTile`: every GetMap answers a tile of the size asked. Otherwise the
   * server answers as the cadastral one does: one 500×500 picture for the
   * group layer whatever the request, an error document for the others in
   * EPSG:3857.
   */
  async function openAde(drawsTile: boolean, hostTakesCrs = false) {
    const ctx = createHost((url) =>
      url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-ade-130.xml"),
    );
    if (hostTakesCrs) ctx.host.importLayerStyle = () => undefined;
    const plain = ctx.host.fetchArrayBuffer!;
    ctx.host.fetchArrayBuffer = vi.fn(async (url: string) => {
      if (!/REQUEST=GetMap/i.test(url)) return plain(url);
      if (drawsTile) return png(64);
      return /LAYERS=Cartografia_Catastale/.test(url) ? png(500) : plain(url);
    });
    plugin.activate(ctx.host);
    const container = document.createElement("div");
    document.body.append(container);
    ctx.getPanel()!.render(container);
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    const item = openDetail(card);
    for (let i = 0; i < 4; i++) await flush();
    return { ...ctx, item };
  }

  it("tries one tile in EPSG:3857 and keeps the layers usable when the server draws it", async () => {
    const { host, item } = await openAde(true);
    const probe = vi.mocked(host.fetchArrayBuffer!).mock.calls.map((c) => c[0]).find((u) => /REQUEST=GetMap/i.test(u))!;
    const params = new URL(probe).searchParams;
    expect(params.get("CRS") ?? params.get("SRS")).toBe("EPSG:3857");
    expect(params.get("WIDTH")).toBe("64");
    const boxes = Array.from(item.querySelectorAll<HTMLInputElement>('[aria-label="WMS layers"] input'));
    expect(boxes.every((b) => !b.disabled)).toBe(true);
    expect(item.textContent).toContain("EPSG:3857 not declared, but the server drew a test tile in it.");
    expect(item.textContent).not.toContain("No layer of this WMS is offered in EPSG:3857");
  });

  it("asks the test tile on a layer that holds no other layers", async () => {
    const { host } = await openAde(false);
    const probe = vi.mocked(host.fetchArrayBuffer!).mock.calls.map((c) => c[0]).find((u) => /REQUEST=GetMap/i.test(u))!;
    expect(new URL(probe).searchParams.get("LAYERS")).toBe("province");
  });

  it("adds them in a system they list when the host takes a crs", async () => {
    const { host, item } = await openAde(false, true);
    const box = (name: string) => item.querySelector<HTMLInputElement>(`[aria-label="WMS layers"] input[value="${name}"]`)!;
    expect(box("CP.CadastralParcel").disabled).toBe(false);
    expect(item.textContent).toContain("Not offered in EPSG:3857: asked in EPSG:6706 and redrawn by GeoLibre.");
    // The group answered the test tile with a picture of another size.
    expect(box("Cartografia_Catastale").disabled).toBe(true);
    expect(box("Cartografia_Catastale").closest("label")!.title).toContain("one fixed picture");
    // A group to skip is no fault: not in red.
    expect(box("Cartografia_Catastale").closest("label")!.querySelector(".ordt-layer-reason")).toBeNull();
    expect(box("Cartografia_Catastale").closest("label")!.querySelector(".ordt-layer-note")!.textContent).toContain("A group of the layers below");
    const groupTest = vi.mocked(host.fetchArrayBuffer!).mock.calls.map((c) => c[0]).find((u) => /LAYERS=Cartografia_Catastale/.test(u))!;
    expect(new URL(groupTest).searchParams.get("CRS")).toBe("EPSG:6706");

    box("CP.CadastralParcel").checked = true;
    box("CP.CadastralParcel").dispatchEvent(new Event("change", { bubbles: true }));
    Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent!.startsWith("Add to map"))!.click();
    expect(host.addWmsLayer).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ layers: "CP.CadastralParcel", crs: "EPSG:6706" }));
  });

  it("passes no crs when the server draws EPSG:3857", async () => {
    const { host, item } = await openAde(true, true);
    const box = item.querySelector<HTMLInputElement>('[aria-label="WMS layers"] input[value="CP.CadastralParcel"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent!.startsWith("Add to map"))!.click();
    expect(vi.mocked(host.addWmsLayer!).mock.calls[0][1]).not.toHaveProperty("crs");
  });

  it("passes queryable: false only for a layer the server marks not queryable", async () => {
    const { host, item } = await openAde(false, true);
    for (const name of ["fabbricati", "CP.CadastralParcel"]) {
      const box = item.querySelector<HTMLInputElement>(`[aria-label="WMS layers"] input[value="${name}"]`)!;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent!.startsWith("Add to map"))!.click();
    const options = Object.fromEntries(vi.mocked(host.addWmsLayer!).mock.calls.map((c) => [c[1].layers, c[1]]));
    expect(options.fabbricati).toMatchObject({ queryable: false });
    // Every layer carries the record it comes from (#36).
    expect(options["CP.CadastralParcel"].metadata).toMatchObject({ catalogue: "RNDT", recordId: expect.any(String), recordUrl: expect.stringMatching(/\/html$/) });
    expect(options["CP.CadastralParcel"]).not.toHaveProperty("queryable");
  });

  it("keeps them disabled when the test tile is an error", async () => {
    const { item } = await openAde(false);
    const boxes = Array.from(item.querySelectorAll<HTMLInputElement>('[aria-label="WMS layers"] input'));
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(item.textContent).toContain("the server did not draw a test tile in it: it needs GeoLibre 3.2.0 or later.");
  });
});

describe("WMS derived from an ArcGIS WMTS", () => {
  const wmts = "https://www.cartografia.servizirl.it/arcgis2/rest/services/BaseMap/ortofoto2003/ImageServer/WMTS?service=WMTS";
  const search = JSON.stringify({
    total: 1,
    start: 1,
    results: [{ id: "r_lombar:ortofoto2003", title: "Ortofoto 2003 - WMTS", _source: { apiso_Type_s: "service", links_s: [wmts] } }],
  });

  async function open(answer: (url: string) => string) {
    const ctx = await mountPanel((url) => (url.includes("/rest/metadata/search") ? search : answer(url)));
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const item = openDetail(ctx.container.querySelector<HTMLElement>(".ordt-result")!);
    for (let i = 0; i < 4; i++) await flush();
    return { ...ctx, item };
  }

  it("lists the WMS and the REST endpoint of the same service, marked as not declared", async () => {
    const caps = `<WMS_Capabilities version="1.3.0"><Capability><Request><GetMap><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://www.cartografia.servizirl.it/arcgis2/services/BaseMap/ortofoto2003/ImageServer/WMSServer"/></Get></HTTP></DCPType></GetMap></Request>
<Layer><CRS>EPSG:3857</CRS><Layer><Name>0</Name><Title>ortofoto2003</Title><CRS>EPSG:3857</CRS></Layer></Layer></Capability></WMS_Capabilities>`;
    const { item, requested } = await open(() => caps);
    const kinds = Array.from(item.querySelectorAll(".ordt-service .ordt-badge-service"), (b) => b.textContent);
    expect(kinds).toEqual(["WMTS", "WMS", "ArcGIS REST"]);
    expect(requested.some((u) => u.startsWith("https://www.cartografia.servizirl.it/arcgis2/services/BaseMap/ortofoto2003/ImageServer/WMSServer?"))).toBe(true);
    expect(item.textContent).toContain("Not declared in the record");
    expect(item.querySelectorAll('[aria-label="WMS layers"] input')).toHaveLength(1);
    // ArcGIS layer "0": its title is shown instead of the number.
    expect(item.querySelector('[aria-label="WMS layers"] .ordt-layer-title')!.textContent).toBe("ortofoto2003");
  });

  it("says so, without an error report, when the service has no WMS", async () => {
    const { item } = await open(() => {
      throw new Error("HTTP 400");
    });
    expect(item.textContent).toContain("This ArcGIS service offers no WMS");
    expect(item.querySelector(".ordt-report")).toBeNull();
  });
});

describe("ArcGIS REST services", () => {
  const ARPAE = "https://servizi-gis.arpae.it/server/rest/services/Geoportal/ACQUEPressioni/MapServer";
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;
  const search = JSON.stringify({
    total: 1,
    start: 1,
    results: [
      {
        id: "arpa:depuratori",
        title: "Depuratori - ed.2023",
        _source: { apiso_Type_s: "dataset", links_s: [ARPAE, `${ARPAE}/1`] },
      },
    ],
  });
  const feature = (i: number) => ({ type: "Feature", id: i, geometry: { type: "Point", coordinates: [9.4, 44.9] }, properties: { i } });

  async function open(answer: (url: string) => string | ArrayBuffer, browserDraws = true, prepare?: (host: RndtHost) => void) {
    vi.stubGlobal("fetch", async () => (browserDraws ? new Response(png) : Promise.reject(new TypeError("Failed to fetch"))));
    const ctx = createHost(() => "");
    ctx.host.fetchArrayBuffer = vi.fn(async (url: string) => {
      ctx.requested.push(url);
      if (url.includes("/rest/metadata/search")) return encode(search);
      const out = answer(url);
      return typeof out === "string" ? encode(out) : out;
    });
    ctx.host.addTileLayer = vi.fn(() => "tile-1");
    prepare?.(ctx.host);
    plugin.activate(ctx.host);
    const container = document.createElement("div");
    document.body.append(container);
    ctx.getPanel()!.render(container);
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const item = openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    for (let i = 0; i < 6; i++) await flush();
    return { ...ctx, item };
  }

  const service = (url: string) =>
    url.startsWith(`${ARPAE}?f=json`) ? fixture("arcgis-arpae-mapserver.json") : /\/export\?/.test(url) ? png : "{}";
  const button = (item: HTMLElement, text: string | RegExp) =>
    Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent!)))!;

  afterEach(() => vi.unstubAllGlobals());

  it("lists the service once, with the linked layer ticked, and adds it as an image", async () => {
    const { host, item } = await open(service);
    expect(Array.from(item.querySelectorAll(".ordt-service .ordt-badge-service"), (b) => b.textContent)).toEqual(["ArcGIS REST"]);
    const boxes = item.querySelectorAll<HTMLInputElement>('[aria-label="ArcGIS layers"] input');
    expect(boxes).toHaveLength(16);
    expect(Array.from(boxes).filter((b) => b.checked).map((b) => b.value)).toEqual(["1"]);
    button(item, "Add to map (1)").click();
    expect(host.addTileLayer).toHaveBeenCalledWith("Depuratori - ed.2023", expect.stringContaining(`${ARPAE}/export?bbox={bbox-epsg-3857}&`), expect.anything());
    expect(vi.mocked(host.addTileLayer!).mock.calls[0][1]).toContain("layers=show%3A1");
    expect(vi.mocked(host.addTileLayer!).mock.calls[0][2]).toMatchObject({ metadata: { catalogue: "RNDT", recordId: expect.any(String) } });
    expect(item.querySelector('[aria-label="ArcGIS layers"] .ordt-layer-tag')!.textContent).toBe("on the map");
  });

  it("knows a layer that is in the project already, as in a reopened project", async () => {
    const first = await open(service);
    button(first.item, "Add to map (1)").click();
    const template = vi.mocked(first.host.addTileLayer!).mock.calls[0][1];
    plugin.deactivate(first.host);
    // GeoLibre saves it as a tile layer with that template.
    const { host, item } = await open(service, true, (h) => {
      h.getLayers = () => ["saved-tiles"];
      h.getProjectSnapshot = () => ({ layers: [{ id: "saved-tiles", type: "xyz", source: { type: "raster", tiles: [template] } }] });
    });
    expect(item.querySelector('[aria-label="ArcGIS layers"] .ordt-layer-tag')!.textContent).toBe("on the map");
    button(item, "Add to map (1)").click();
    expect(host.addTileLayer).not.toHaveBeenCalled();
  });

  it("keeps Add to map off, and says why, when the browser cannot get the images", async () => {
    const { item } = await open(service, false);
    expect(button(item, "Add to map (1)").disabled).toBe(true);
    expect(item.textContent).toContain("no CORS header");
  });

  it("downloads the ticked layer's features page by page", async () => {
    const { host, item, requested } = await open((url) => {
      if (url.startsWith(`${ARPAE}/1?f=json`)) return fixture("arcgis-arpae-layer.json");
      if (url.includes("returnCountOnly=true")) return JSON.stringify({ count: 2500 });
      if (url.includes("/1/query?")) {
        const offset = Number(new URL(url).searchParams.get("resultOffset"));
        const n = Math.min(1000, 2500 - offset);
        return JSON.stringify({ type: "FeatureCollection", features: Array.from({ length: n }, (_, i) => feature(offset + i)) });
      }
      return service(url);
    });
    button(item, "Add features").click();
    for (let i = 0; i < 12; i++) await flush();
    const pages = requested.filter((u) => u.includes("f=geojson")).map((u) => new URL(u).searchParams.get("resultOffset"));
    expect(pages).toEqual(["0", "1000", "2000"]);
    expect(requested.find((u) => u.includes("returnCountOnly"))).toContain("geometry=12%2C41%2C13%2C42");
    const [name, data] = vi.mocked(host.addGeoJsonLayer!).mock.calls[0];
    expect(name).toBe("Depuratori - ed.2023");
    expect(data.features).toHaveLength(2500);
    expect(item.textContent).toContain("Added 2,500 features.");
  });

  it("reports a service that needs a login", async () => {
    const { item } = await open(() => JSON.stringify({ error: { code: 499, message: "Token Required", details: [] } }));
    expect(item.textContent).toContain('ArcGIS error: the server answers 499, "Token Required" (the service needs a login)');
    expect(item.querySelector(".ordt-report")).not.toBeNull();
  });
});

describe("search from a link (?rndt=, ?rndtBbox=)", () => {
  afterEach(() => vi.useRealTimers());

  const handle = (host: RndtHost, query: string) => plugin.handleUrlParameters!(host, new URLSearchParams(query));

  it("declares the parameters it owns", () => {
    expect(plugin.urlParameterNames).toEqual(URL_PARAMETER_NAMES);
    expect(plugin.urlParameterNames).toEqual(expect.arrayContaining(["rndt", "rndtBbox", "rndtTheme", "rndtKind"]));
  });

  it("puts the link's filters in the form and searches with them (#30)", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndt=fiumi&rndtKind=data&rndtTheme=hy&rndtAs=WMS&rndtSort=newest");
    await flush();

    const q = new URL(requested[0]).searchParams.get("q")!;
    expect(q).toContain("fiumi");
    expect(q).toContain("Idrografia");
    expect(container.querySelector<HTMLInputElement>('input[name="kind"][value="data"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLSelectElement>('select[name="theme"]')!.value).toBe("Idrografia");
    expect(container.querySelector<HTMLInputElement>('input[name="availableAs"][value="WMS"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLSelectElement>('select[name="sort"]')!.value).toBe("apiso_Modified_dt:desc");
    plugin.deactivate(host);
  });

  it("starts from an empty form: a filter set by hand does not survive a link", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value = "Regione Puglia";
    await handle(host, "rndt=strade");
    await flush();

    expect(container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value).toBe("");
    expect(new URL(requested[0]).searchParams.get("q")).toBe("(strade)");
    plugin.deactivate(host);
  });

  it("searches the text anywhere, also when the panel is rendered after the link is handled", async () => {
    const ctx = createHost(() => fixture("search-services.json"));
    plugin.activate(ctx.host);
    await handle(ctx.host, "rndt=idrografia");
    expect(ctx.requested).toHaveLength(0);
    const container = document.createElement("div");
    document.body.append(container);
    ctx.getPanel()!.render(container);
    await flush();

    const search = new URL(ctx.requested[0]);
    expect(search.searchParams.get("q")).toBe("(idrografia)");
    expect(search.searchParams.get("bbox")).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="text"]')!.value).toBe("idrografia");
    expect(container.querySelector<HTMLSelectElement>('select[name="where"]')!.value).toBe("anywhere");
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(5);
    plugin.deactivate(ctx.host);
  });

  it("searches in the link's box and shows it in the form", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndt=catastale&rndtBbox=12.3,37.5,13.9,38.3");
    await flush();

    const search = new URL(requested[0]);
    expect(search.searchParams.get("q")).toBe("(catastale)");
    expect(search.searchParams.get("bbox")).toBe("12.3,37.5,13.9,38.3");
    expect(container.querySelector<HTMLSelectElement>('select[name="where"]')!.value).toBe("box");
    const box = container.querySelector<HTMLInputElement>('input[name="box"]')!;
    expect(box.value).toBe("12.3, 37.5, 13.9, 38.3");
    expect(box.hidden).toBe(false);
    plugin.deactivate(host);
  });

  it("moves the map to the link's box instead of Italy", () => {
    vi.useFakeTimers();
    const ctx = createHost(() => "{}");
    ctx.host.getViewBounds = () => [-203.3, -16.3, 3.3, 83.1];
    plugin.activate(ctx.host);
    void handle(ctx.host, "rndtBbox=12.3,37.5,13.9,38.3");
    vi.advanceTimersByTime(1000);
    const fit = vi.mocked(ctx.host.fitBounds!);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledWith([12.3, 37.5, 13.9, 38.3]);
    plugin.deactivate(ctx.host);
  });

  it("keeps the map view a link sets, box or not (#44)", () => {
    vi.useFakeTimers();
    const ctx = createHost(() => "{}");
    ctx.host.getViewBounds = () => [15.44, 38.03, 15.53, 38.1];
    plugin.activate(ctx.host);
    void handle(ctx.host, "rndtBbox=12.3,37.5,13.9,38.3&lat=38.07&lon=15.49&zoom=12");
    vi.advanceTimersByTime(1000);
    expect(ctx.host.fitBounds).not.toHaveBeenCalled();
    plugin.deactivate(ctx.host);
  });

  it("adds the layers of a link, each record and service read once, and says which could not be (#44)", async () => {
    const { host, requested, container } = await mountPanel((url) =>
      url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-piemonte-111.xml"),
    );
    // GeoLibre 3.2.0 and later: a layer without EPSG:3857 is asked in its own system.
    host.importLayerStyle = vi.fn();
    const id = "c_l219:4bfe0c85-3a26-4e3f-a6c8-88cf6f6e2dcf";
    await handle(host, `rndtLayer=${id}~wms~Microzone&rndtLayer=${id}~wms~Nope`);
    for (let i = 0; i < 5; i++) await flush();

    expect(host.addWmsLayer).toHaveBeenCalledTimes(1);
    expect(host.addWmsLayer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ layers: "Microzone", metadata: expect.objectContaining({ recordId: id, serviceType: "WMS", layerName: "Microzone" }) }),
    );
    // No search in the link: only the record, read once, and its WMS once.
    expect(requested.filter((u) => u.includes("/rest/metadata/search"))).toHaveLength(1);
    expect(requested.filter((u) => /REQUEST=GetCapabilities/i.test(u))).toHaveLength(1);
    const note = container.querySelector(".ordt-link-note")!.textContent!;
    expect(note).toMatch(/^Added 1 of 2 layers of the link\. Could not add Nope: not found in a WMS service of /);
    plugin.deactivate(host);
  });

  it("opens the record when the text is a record id", async () => {
    const { host, container } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndt=c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2");
    await flush();
    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(false);
    plugin.deactivate(host);
  });

  it("follows a link once: GeoLibre gives the parameters again when a project is opened", async () => {
    const { host, requested } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndt=una+sola+volta");
    await flush();
    expect(requested).toHaveLength(1);
    await handle(host, "rndt=una+sola+volta");
    await flush();
    expect(requested).toHaveLength(1);
    await handle(host, "rndt=un+altro+link");
    await flush();
    expect(requested).toHaveLength(2);
    plugin.deactivate(host);
  });

  it("does nothing with no value, or with the plugin off", async () => {
    const { host, requested } = await mountPanel(() => "{}");
    await handle(host, "rndt");
    await flush();
    expect(requested).toHaveLength(0);
    plugin.deactivate(host);
    await handle(host, "rndt=idrografia");
    await flush();
    expect(requested).toHaveLength(0);
  });
});

describe("Services and the filters they do not declare (#33)", () => {
  const handle = (host: RndtHost, query: string) => plugin.handleUrlParameters!(host, new URLSearchParams(query));
  const q = (url: string) => new URL(url).searchParams.get("q") ?? "";
  const skipped = (container: HTMLElement) => container.querySelector<HTMLElement>(".ordt-skipped")!;
  const theme = (container: HTMLElement) => container.querySelector<HTMLSelectElement>('select[name="theme"]')!;
  const openData = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[name="openData"]')!;
  const pickKind = (container: HTMLElement, kind: string) => {
    const radio = container.querySelector<HTMLInputElement>(`input[name="kind"][value="${kind}"]`)!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  };

  beforeEach(() => localStorage.clear());

  it("shows no chip for a theme or open data that a services search does not send, and says why", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndtKind=services&rndtTheme=cp&rndtOpen=1");
    await flush();
    expect(q(requested[0])).toBe("apiso_Type_s:service");
    expect(chipLabels(container)).toEqual(["Services"]);
    expect(skipped(container).hidden).toBe(false);
    expect(skipped(container).textContent).toContain("Theme and Open data only not applied");
    // The values stay in the form, greyed out: they come back with Data.
    expect([theme(container).value, theme(container).disabled]).toEqual(["Parcelle catastali", true]);
    expect([openData(container).checked, openData(container).disabled]).toEqual([true, true]);
    expect(container.querySelector(".ordt-count")!.hasAttribute("hidden")).toBe(true);
    plugin.deactivate(host);
  });

  it("searches datasets with a WMS and the same theme from the notice", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndtKind=services&rndtTheme=cp");
    await flush();
    skipped(container).querySelector<HTMLButtonElement>("button")!.click();
    await flush();
    const sent = q(requested.at(-1)!);
    expect(sent).toContain('INSPIRETheme_s:("Parcelle catastali")');
    expect(sent).toContain("apiso_Type_s:(dataset OR series)");
    expect(sent).toContain("links_s:");
    expect(container.querySelector<HTMLInputElement>('input[name="availableAs"][value="WMS"]')!.checked).toBe(true);
    expect(theme(container).disabled).toBe(false);
    expect(skipped(container).hidden).toBe(true);
    expect(chipLabels(container)).toEqual(expect.arrayContaining(["Data", "WMS"]));
    expect(chipLabels(container)).toHaveLength(3);
    plugin.deactivate(host);
  });

  it("turns Download into WFS when it searches datasets", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await handle(host, "rndtKind=services&rndtService=download&rndtTheme=hy");
    await flush();
    skipped(container).querySelector<HTMLButtonElement>("button")!.click();
    await flush();
    const as = [...container.querySelectorAll<HTMLInputElement>('input[name="availableAs"]:checked')].map((b) => b.value);
    expect(as).toEqual(["WFS"]);
    expect(q(requested.at(-1)!)).toContain("Idrografia");
    plugin.deactivate(host);
  });

  it("from the form: a theme picked before Services is kept but not shown, nor saved in recent searches", async () => {
    const { host, container } = await mountPanel(() => fixture("search-services.json"));
    theme(container).value = "Idrografia";
    pickKind(container, "services");
    expect(theme(container).disabled).toBe(true);
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(chipLabels(container)).toEqual(["Services", "Map view"]);
    const saved = JSON.parse(localStorage.getItem("openrndt-geolibre:history") ?? "[]") as { filters: string[] }[];
    expect(saved[0].filters).toEqual(["Services", "Map view"]);
    pickKind(container, "data");
    expect([theme(container).value, theme(container).disabled]).toEqual(["Idrografia", false]);
    plugin.deactivate(host);
  });
});

describe("search saved in the project (getProjectState, applyProjectState)", () => {
  const submit = async (container: HTMLElement, text: string) => {
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = text;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
  };
  const render = (ctx: ReturnType<typeof createHost>) => {
    const container = document.createElement("div");
    document.body.append(container);
    ctx.getPanel()!.render(container);
    return container;
  };

  it("asks GeoLibre not to fold its panel when a project loads", () => {
    expect((plugin as { restoresPanelCollapseState?: boolean }).restoresPanelCollapseState).toBe(true);
  });

  it("has nothing to save before a search, or with the plugin off", async () => {
    const { host } = await mountPanel(() => "{}");
    expect(plugin.getProjectState!()).toBeUndefined();
    plugin.deactivate(host);
    expect(plugin.getProjectState!()).toBeUndefined();
  });

  it("saves the search, the box it used, the page and the open record", async () => {
    const { host, container } = await mountPanel(() => fixture("search-services.json"));
    await submit(container, "catasto");
    expect(plugin.getProjectState!()).toMatchObject({
      v: 1,
      form: { text: "catasto", bbox: [12, 41, 13, 42], sort: "" },
      start: 1,
      recordId: null,
    });
    openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    expect(plugin.getProjectState!()).toMatchObject({ recordId: "c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2" });
    // It goes into a JSON file.
    expect(JSON.parse(JSON.stringify(plugin.getProjectState!()))).toEqual(plugin.getProjectState!());
    plugin.deactivate(host);
  });

  it("saves a record opened by its id as that id", async () => {
    const { host, container } = await mountPanel(() => fixture("search-services.json"));
    await submit(container, "c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2");
    expect(plugin.getProjectState!()).toMatchObject({
      form: { text: "c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2", textMode: "all", bbox: null },
      recordId: "c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2",
    });
    plugin.deactivate(host);
  });

  it("brings back a state given before the plugin is turned on: form, search in the saved box, open record", async () => {
    const saved = {
      v: 1,
      form: {
        text: "catasto",
        textMode: "any",
        kind: "services",
        availableAs: ["WMS"],
        organisation: "Comune",
        invertOrganisation: true,
        openDataOnly: true,
        bbox: [12.95, 37.6, 14.3, 38.3],
        spatialRel: "Within",
      },
      start: 21,
      recordId: "r_lombar:1019d1db-648f-46d4-b428-951722b8f5c3",
    };
    const ctx = createHost(() => fixture("search-services.json"));
    plugin.applyProjectState!(ctx.host, saved);
    expect(plugin.getProjectState!()).toMatchObject({ start: 21 });
    plugin.activate(ctx.host);
    const container = render(ctx);
    await flush();

    const search = new URL(ctx.requested[0]);
    expect(search.searchParams.get("bbox")).toBe("12.95,37.6,14.3,38.3");
    expect(search.searchParams.get("spatialRel")).toBe("Within");
    expect(search.searchParams.get("start")).toBe("21");
    expect(search.searchParams.get("q")).toContain("catasto");
    const value = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value;
    const checked = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
    expect(value("text")).toBe("catasto");
    expect(value("where")).toBe("box");
    expect(value("box")).toBe("12.95, 37.6, 14.3, 38.3");
    expect(value("organisation")).toBe("Comune");
    expect(checked("textMode")).toBe("any");
    expect(checked("kind")).toBe("services");
    expect(checked("orgMode")).toBe("hide");
    expect(checked("availableAs")).toBe("WMS");
    expect(checked("spatialRel")).toBe("Within");
    expect(container.querySelector<HTMLInputElement>('input[name="openData"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLElement>(".ordt-service-types")!.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(false);
    expect(plugin.getProjectState!()).toMatchObject({ start: 21, recordId: saved.recordId, form: { text: "catasto", spatialRel: "Within" } });
    plugin.deactivate(ctx.host);
  });

  it("does not search again for a state equal to what the panel shows", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await submit(container, "catasto");
    const before = requested.length;
    plugin.applyProjectState!(host, JSON.parse(JSON.stringify(plugin.getProjectState!())));
    await flush();
    expect(requested).toHaveLength(before);
    plugin.deactivate(host);
  });

  it("shows the list when the saved record is not in the page any more", async () => {
    const { host, container } = await mountPanel(() => fixture("search-services.json"));
    plugin.applyProjectState!(host, { v: 1, form: { text: "catasto" }, start: 1, recordId: "gone:1" });
    await flush();
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(5);
    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(true);
    plugin.deactivate(host);
  });

  it("ignores a state it cannot read", async () => {
    const { host, requested, container } = await mountPanel(() => fixture("search-services.json"));
    await submit(container, "catasto");
    expect(plugin.applyProjectState!(host, { v: 2 })).toBe(false);
    await flush();
    expect(requested).toHaveLength(1);
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(5);
    plugin.deactivate(host);
  });

  it("asks GeoLibre to be told of a project that carries no search, and empties the panel then", async () => {
    expect((plugin as { clearsStateOnProjectLoad?: boolean }).clearsStateOnProjectLoad).toBe(true);
    const { host, container } = await mountPanel(() => fixture("search-services.json"));
    await submit(container, "catasto");
    openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    plugin.applyProjectState!(host, undefined);
    expect(container.querySelectorAll(".ordt-result")).toHaveLength(0);
    expect(container.querySelector<HTMLInputElement>('input[name="text"]')!.value).toBe("");
    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(true);
    expect(container.querySelector(".ordt-status")!.textContent).toMatch(/^Search the Italian national catalogue/);
    expect(plugin.getProjectState!()).toBeUndefined();
    plugin.deactivate(host);
  });

  it("drops a state kept for later when a project without a search follows", () => {
    const ctx = createHost(() => "{}");
    plugin.applyProjectState!(ctx.host, { v: 1, form: { text: "catasto" } });
    plugin.applyProjectState!(ctx.host, undefined);
    expect(plugin.getProjectState!()).toBeUndefined();
  });

  it("leaves alone a form filled in but never searched", async () => {
    const { host, container } = await mountPanel(() => "{}");
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "ortofoto";
    plugin.applyProjectState!(host, undefined);
    expect(container.querySelector<HTMLInputElement>('input[name="text"]')!.value).toBe("ortofoto");
    plugin.deactivate(host);
  });

  it("lets a link win over the state of the project", async () => {
    const ctx = createHost(() => fixture("search-services.json"));
    plugin.applyProjectState!(ctx.host, { v: 1, form: { text: "catasto" }, start: 1, recordId: null });
    plugin.activate(ctx.host);
    await plugin.handleUrlParameters!(ctx.host, new URLSearchParams("rndt=idrografia"));
    render(ctx);
    await flush();
    expect(ctx.requested).toHaveLength(1);
    expect(new URL(ctx.requested[0]).searchParams.get("q")).toBe("(idrografia)");
    plugin.deactivate(ctx.host);
  });
});

describe("panel refinements (#19)", () => {
  const none = JSON.stringify({ start: 1, num: 20, total: 0, results: [] });
  const text = (container: HTMLElement) => container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!;
  const anywhere = (container: HTMLElement) => {
    const where = container.querySelector<HTMLSelectElement>('select[name="where"]')!;
    where.value = "anywhere";
    where.dispatchEvent(new Event("change"));
  };

  it("with a filter keeps the chip row, with none shows a Filters link next to Zoom to results", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    const summary = container.querySelector<HTMLElement>(".ordt-summary")!;
    const link = container.querySelector<HTMLButtonElement>(".ordt-filters-link")!;
    // The default area, the map view, is a filter.
    form.requestSubmit();
    await flush();
    expect(summary.hidden).toBe(false);
    expect(link.hidden).toBe(true);

    anywhere(container);
    form.requestSubmit();
    await flush();
    expect(summary.hidden).toBe(true);
    expect(link.hidden).toBe(false);
    expect(link.textContent).toBe("Filters");
    expect(link.closest(".ordt-results-head")).not.toBeNull();
    link.click();
    expect(form.hidden).toBe(false);
    expect(link.textContent).toBe("Hide filters");
    link.click();
    expect(form.hidden).toBe(true);
  });

  it("with no results hides curl, sort and the menu, and offers the remedies that apply", async () => {
    const { container, requested } = await mountPanel(() => none);
    const form = container.querySelector<HTMLFormElement>("form")!;
    text(container).value = "bombazza fiumi";
    form.requestSubmit();
    await flush();
    expect(container.querySelector<HTMLElement>(".ordt-head-tools")!.hidden).toBe(true);
    const empty = container.querySelector<HTMLElement>(".ordt-empty")!;
    expect(empty.hidden).toBe(false);
    const links = () => Array.from(empty.querySelectorAll<HTMLButtonElement>("button"));
    expect(links().map((b) => b.textContent)).toEqual([
      "Search Anywhere instead of the map view",
      "Match any word (bombazza or fiumi)",
    ]);
    // The chip row stays, with Clear all.
    expect(container.querySelector<HTMLElement>(".ordt-summary")!.hidden).toBe(false);
    // No footprint and no Filters link: the row of the zoom links is not left empty.
    expect(container.querySelector<HTMLElement>(".ordt-filters-link")!.parentElement!.hidden).toBe(true);

    links()[0].click();
    await flush();
    expect(new URL(requested.at(-1)!).searchParams.get("bbox")).toBeNull();
    expect(links().map((b) => b.textContent)).toEqual(["Match any word (bombazza or fiumi)"]);
    links()[0].click();
    await flush();
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toBe("(bombazza OR fiumi)");
    // Nothing else to suggest: the message alone.
    expect(empty.hidden).toBe(true);
  });

  it("offers no remedy when there are results", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(container.querySelector<HTMLElement>(".ordt-empty")!.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>(".ordt-head-tools")!.hidden).toBe(false);
  });

  it("cuts a long abstract, with More and Less", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    container.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    const abstract = container.querySelector<HTMLElement>(".ordt-detail-view .ordt-abstract")!;
    const toggle = container.querySelector<HTMLButtonElement>(".ordt-detail-view .ordt-abstract-toggle")!;
    expect(abstract.classList.contains("ordt-clamped")).toBe(true);
    expect(toggle.textContent).toBe("More");
    toggle.click();
    expect(abstract.classList.contains("ordt-clamped")).toBe(false);
    expect(toggle.textContent).toBe("Less");
  });
});

describe("Contact the organisation (#20)", () => {
  const record = {
    id: "x:1",
    title: "Carta",
    abstract: "",
    type: "dataset",
    organisation: "Regione Esempio",
    contactEmails: ["sit@regione.example.it"],
    modified: "",
    bbox: null,
    services: [],
    otherLinks: [],
    htmlUrl: "https://geodati.gov.it/RNDT/rest/metadata/item/x%3A1/html",
    xmlUrl: "",
  };

  it("writes to the record's contact, with no copy to RNDT, and leaves room for the request", async () => {
    const { contactEmail, emailText } = await import("../src/rndt/panel");
    const email = contactEmail(record);
    expect([email.to, email.cc]).toEqual([["sit@regione.example.it"], []]);
    expect(emailText(email)).toBe(
      [
        "A: sit@regione.example.it",
        "Oggetto: Richiesta sul dataset Carta",
        "",
        "Buongiorno,",
        "",
        "vi scrivo come referenti di un dataset indicato nel Repertorio Nazionale dei Dati Territoriali (RNDT), che ho trovato con GeoLibre (plugin openrndt-geolibre).",
        "",
        "Scheda: Carta",
        "Identificativo: x:1",
        "Pagina della scheda: https://geodati.gov.it/RNDT/rest/metadata/item/x%3A1/html",
        "Ente: Regione Esempio",
        "",
        "[Scrivi qui la tua richiesta: un chiarimento sul dato, la licenza, un aggiornamento, un formato]",
        "",
        "Grazie e buon lavoro",
      ].join("\n"),
    );
    const service = contactEmail({ ...record, type: "service" });
    expect(service.subject).toBe("Richiesta sul servizio Carta");
    expect(service.body).toContain("referenti di un servizio indicato");
  });

  it("asks RNDT whom to write to when the record gives no address", async () => {
    const { contactEmail } = await import("../src/rndt/panel");
    const email = contactEmail({ ...record, contactEmails: [] });
    expect([email.to, email.cc]).toEqual([["info@rndt.gov.it"], []]);
    expect(email.subject).toBe("Contatto per il dataset Carta");
    expect(email.body).toContain("che non indica un indirizzo email del punto di contatto. Potete indicarmi a chi rivolgermi?");
    expect(email.body).toContain("Ente: Regione Esempio");
    expect(email.body).not.toContain("Scrivi qui");
    const unnamed = contactEmail({ ...record, contactEmails: [], organisation: "" });
    expect(unnamed.body).not.toContain("Ente:");
    expect(unnamed.body).toContain("La scheda non indica nemmeno l'ente responsabile.");
  });

  async function detail(patch: (source: Record<string, unknown>) => void = () => undefined) {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const page = JSON.parse(fixture("search-alberi.json"));
    for (const result of page.results) patch(result._source);
    const ctx = await mountPanel(() => JSON.stringify(page));
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const cards = ctx.container.querySelectorAll<HTMLElement>(".ordt-result");
    return { ...ctx, writeText, cards, view: openDetail(cards[0]) };
  }

  it("opens a box under the organisation's row, with what the record says and a ready email", async () => {
    const { view, writeText, cards } = await detail((source) => {
      source.EnteResponsabile_s = "Regione Esempio";
      source.PuntoDiContattoEmail_s = "sit@regione.example.it";
    });
    const row = view.querySelector<HTMLElement>(".ordt-org-row")!;
    const link = row.querySelector<HTMLButtonElement>(".ordt-contact-link")!;
    const box = view.querySelector<HTMLElement>(".ordt-contact")!;
    expect(row.firstElementChild!.textContent).toBe("Regione Esempio");
    // The date comes before the organisation, so the box opens right under its row.
    expect(row.previousElementSibling!.textContent).toMatch(/^Metadata updated /);
    expect(row.nextElementSibling).toBe(box);
    expect([link.textContent, box.hidden]).toEqual(["Contact", true]);

    link.click();
    expect([link.textContent, box.hidden]).toEqual(["Close", false]);
    const rows = Array.from(box.querySelectorAll("dt"), (dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
    expect(rows[0][0]).toBe("About");
    expect(rows[0][1]).toContain(view.querySelector(".ordt-detail-title")!.textContent);
    expect(rows[1]).toEqual(["Organisation", "Regione Esempio"]);
    expect(rows[2]).toEqual(["Contact", "sit@regione.example.itpoint of contact named in the record"]);

    const copy = box.querySelector<HTMLButtonElement>(".ordt-copy-email")!;
    expect(copy.textContent).toBe("Copy email");
    expect(copy.parentElement!.textContent).toBe("Copy email (to sit@regione.example.it)");
    copy.click();
    await flush();
    expect(copy.textContent).toBe("Copied: paste it into a new email");
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toMatch(/^A: sit@regione\.example\.it\nOggetto: Richiesta sul /);
    expect(text).not.toContain("Cc:");

    const show = box.querySelector<HTMLButtonElement>(".ordt-contact-show")!;
    const preview = box.querySelector<HTMLElement>(".ordt-contact-text")!;
    expect([show.textContent, preview.hidden]).toEqual(["Show text", true]);
    show.click();
    expect([show.textContent, preview.hidden, preview.textContent]).toEqual(["Hide text", false, text]);

    link.click();
    expect([link.textContent, box.hidden]).toEqual(["Contact", true]);
    // Not remembered from a record to the next.
    link.click();
    expect(openDetail(cards[1]).querySelector<HTMLElement>(".ordt-contact")!.hidden).toBe(true);
  });

  it("offers the email to RNDT for a record with no address, and names a missing organisation", async () => {
    const { view } = await detail((source) => {
      delete source.EnteResponsabile_s;
      delete source.PuntoDiContattoEmail_s;
    });
    const link = view.querySelector<HTMLButtonElement>(".ordt-contact-link")!;
    link.click();
    const box = view.querySelector<HTMLElement>(".ordt-contact")!;
    const rows = Array.from(box.querySelectorAll("dt"), (dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
    expect(rows.slice(1)).toEqual([
      ["Organisation", "Not named in the record"],
      ["Contact", "This record gives no email address."],
    ]);
    expect(box.querySelector(".ordt-copy-email")!.parentElement!.textContent).toBe("Copy email to RNDT (to RNDT)");
  });
});

describe("Copy for an agent (#23)", () => {
  it("copies the search, its page and the commands to go on, from the menu of the results header", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const entry = () => container.querySelector<HTMLButtonElement>(".ordt-results-head .ordt-copy-agent")!;
    const menu = entry().closest<HTMLElement>(".ordt-menu")!;
    // Above Clear results, and out of sight until there are results.
    expect(Array.from(menu.querySelectorAll("button"), (b) => b.firstChild!.textContent)).toEqual(["Share", "Copy for an agent", "Clear results"]);
    expect(container.querySelector<HTMLElement>(".ordt-head-tools")!.hidden).toBe(true);

    container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!.value = "alberi";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(entry().textContent).toBe("Copy for an agentThis search, its 5 results and the commands to go on");
    menu.hidden = false;
    entry().click();
    await flush();
    expect(entry().firstChild!.textContent).toBe("Copied: paste it into your agent");
    // The menu stays open, so the confirmation is read.
    expect(menu.hidden).toBe(false);

    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text.split("\n")[0]).toBe('# RNDT search: "alberi"');
    expect(text).toContain("- Area: bbox 12,41,13,42 (west,south,east,north, EPSG:4326), records that touch it");
    expect(text).toContain("- Results: 41; this is page 1 (records 1-5)");
    expect(text).toContain("curl -sG 'https://geodati.gov.it/RNDT/rest/metadata/search'");
    const titles = Array.from(container.querySelectorAll(".ordt-result-title"), (b) => b.textContent!);
    expect(titles).toHaveLength(5);
    for (const title of titles) expect(text).toContain(`| ${title.replace(/\|/g, "\\|")} |`);
  });
});

describe("Share (#31)", () => {
  afterEach(() => {
    delete (navigator as { share?: unknown }).share;
    delete (navigator as { canShare?: unknown }).canShare;
  });

  async function searched(text: string) {
    const ctx = await mountPanel(() => fixture("search-alberi.json"));
    ctx.container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!.value = text;
    ctx.container.querySelector<HTMLInputElement>('input[name="kind"][value="data"]')!.checked = true;
    ctx.container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const entry = () => ctx.container.querySelector<HTMLButtonElement>(".ordt-results-head .ordt-share")!;
    return { ...ctx, entry };
  }

  it("hands the search's GeoLibre web link to the system share sheet", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const { entry, host } = await searched("alberi");
    entry().click();
    await flush();

    expect(share).toHaveBeenCalledTimes(1);
    const { title, url } = (share.mock.calls[0] as unknown as [{ title: string; url: string }])[0];
    expect(title).toBe("RNDT: alberi");
    const link = new URL(url);
    expect(link.origin).toBe("https://web.geolibre.app");
    expect(link.searchParams.get("plugin")).toBe("openrndt-geolibre");
    expect(link.searchParams.get("rndt")).toBe("alberi");
    expect(link.searchParams.get("rndtKind")).toBe("data");
    plugin.deactivate(host);
  });

  it("copies the link where there is no share sheet, and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { entry, host } = await searched("alberi");
    entry().click();
    await flush();

    expect((writeText.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/web\.geolibre\.app\/\?plugin=openrndt-geolibre&rndt=alberi/);
    expect(entry().textContent).toBe("Link copied");
    plugin.deactivate(host);
  });

  it("copies when the share sheet refuses, and does nothing when it is closed", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = vi.fn(async () => {
      throw new DOMException("closed", "AbortError");
    });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const { entry, host } = await searched("alberi");
    entry().click();
    await flush();
    expect(writeText).not.toHaveBeenCalled();

    share.mockImplementationOnce(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    entry().click();
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    plugin.deactivate(host);
  });

  it("shares the record open in the detail view", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { host, container } = await searched("alberi");
    const view = openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    await flush();
    const id = view.querySelector<HTMLButtonElement>('.ordt-menu-item[title]')!.title;
    // The detail view's own menu has Share first.
    const share = view.querySelector<HTMLButtonElement>(".ordt-detail-actions .ordt-share")!;
    expect(share.closest(".ordt-menu")!.querySelector("button")).toBe(share);
    share.click();
    await flush();

    const link = new URL((writeText.mock.calls[0] as unknown as [string])[0]);
    expect([...link.searchParams]).toEqual([
      ["plugin", "openrndt-geolibre"],
      ["rndt", id],
    ]);
    expect(share.textContent).toBe("Link copied");
    plugin.deactivate(host);
  });

  it("puts the catalogue layers turned on in the link, bottom to top, and names the others (#44)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // The browser reads every server but one: no CORS there.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nocors.example")) throw new TypeError("Failed to fetch");
      return new Response("");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { entry, host, container } = await searched("alberi");
      const wms = (id: string, url: string, layerName: string | null) => ({
        id,
        name: `Layer ${id}`,
        type: "wms",
        visible: id !== "hidden",
        source: { url, layers: layerName ?? "x", version: "1.3.0", crs: "EPSG:3857" },
        metadata: { catalogue: "RNDT", recordId: "c_x:1", ...(layerName && { serviceType: "WMS", layerName }) },
      });
      const layers = [
        { id: "geo", name: "Tram worksites", type: "geojson", visible: true, source: {}, metadata: {} },
        wms("wms-b", "https://s.example/wms", "B"),
        wms("http", "http://old.example/wms", "C"),
        {
          id: "arc",
          name: "Layer arc",
          type: "xyz",
          visible: true,
          source: { tiles: ["https://a.example/arcgis/rest/services/P/MapServer/export?bbox={bbox-epsg-3857}&f=image"] },
          metadata: { recordId: "c_y:2", serviceType: "ArcGIS", layerName: "3" },
        },
        wms("wms-a", "https://s.example/wms", "A"),
        wms("hidden", "https://s.example/wms", "H"),
        wms("old", "https://s.example/wms", null),
        wms("nocors", "https://nocors.example/wms", "N"),
        { id: "basemap", name: "World Imagery", type: "xyz", visible: true, source: { tiles: ["https://e.example/{z}/{y}/{x}"] }, metadata: { sourceKind: "maplibre-basemap-control" } },
      ];
      host.getProjectSnapshot = () => ({ layers });
      host.getLayers = () => layers.map((l) => l.id);
      entry().click();
      await flush();
      await flush();

      const link = new URL((writeText.mock.calls[0] as unknown as [string])[0]);
      expect(link.searchParams.getAll("rndtLayer")).toEqual(["c_x:1~wms~A", "c_y:2~arcgis~3", "c_x:1~wms~B"]);
      // An http server is left out without asking: web.geolibre.app is https.
      expect(fetchMock.mock.calls.some(([url]) => url.startsWith("http://"))).toBe(false);
      expect(fetchMock.mock.calls.some(([url]) => url.startsWith("https://a.example/") && !url.includes("{bbox"))).toBe(true);
      const note = container.querySelector(".ordt-link-note")!.textContent!;
      expect(note).toContain("Layers in the link: 3.");
      expect(note).toContain("Left out: Layer nocors; Layer old; Layer http; Tram worksites.");
      plugin.deactivate(host);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not wait past its budget for a server that never answers (#44)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // Like a real fetch, it gives up only when its signal aborts.
    vi.stubGlobal("fetch", (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")))),
    );
    try {
      const { entry, host, container } = await searched("alberi");
      const layer = {
        id: "slow",
        name: "Slow",
        type: "wms",
        visible: true,
        source: { url: "https://slow.example/wms", layers: "S", version: "1.3.0", crs: "EPSG:3857" },
        metadata: { recordId: "c_x:1", serviceType: "WMS", layerName: "S" },
      };
      host.getProjectSnapshot = () => ({ layers: [layer] });
      host.getLayers = () => ["slow"];
      const started = Date.now();
      entry().click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled(), { timeout: 4000 });
      expect(Date.now() - started).toBeLessThan(3500);
      expect(new URL((writeText.mock.calls[0] as unknown as [string])[0]).searchParams.has("rndtLayer")).toBe(false);
      expect(container.querySelector(".ordt-link-note")!.textContent).toContain("Left out: Slow.");
      plugin.deactivate(host);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 6000);

  it("puts the map view in the link (#44)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { entry, host } = await searched("alberi");
    // A world copy east of the first one: the longitude is wrapped back.
    const center = { lng: 375.49, lat: 38.07, wrap: () => ({ lng: 15.49, lat: 38.07 }) };
    host.getMap = () => ({ getCenter: () => center, getZoom: () => 12 }) as never;
    entry().click();
    await flush();

    const link = new URL((writeText.mock.calls[0] as unknown as [string])[0]);
    expect([link.searchParams.get("lat"), link.searchParams.get("lon"), link.searchParams.get("zoom")]).toEqual(["38.07", "15.49", "12"]);
    plugin.deactivate(host);
  });
});

describe("A menu with no room below (#24)", () => {
  it("opens upwards when it would end under the footer, downwards otherwise", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const view = openDetail(container.querySelector<HTMLElement>(".ordt-result")!);
    const button = view.querySelector<HTMLButtonElement>(".ordt-detail-actions .ordt-menu-button")!;
    const menu = button.nextElementSibling as HTMLElement;
    const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    container.querySelector<HTMLElement>(".ordt-footer")!.getBoundingClientRect = rect(600, 640);

    // The button sits right above the footer: 80 px of menu do not fit below, and fit above.
    button.getBoundingClientRect = rect(570, 590);
    menu.getBoundingClientRect = rect(594, 674);
    button.click();
    expect([menu.hidden, menu.classList.contains("ordt-menu-up")]).toEqual([false, true]);
    button.click();

    // Higher up there is room below.
    button.getBoundingClientRect = rect(200, 220);
    menu.getBoundingClientRect = rect(224, 304);
    button.click();
    expect([menu.hidden, menu.classList.contains("ordt-menu-up")]).toEqual([false, false]);
  });
});

describe("Recent searches (#25)", () => {
  const KEY = "openrndt-geolibre:history";
  const none = JSON.stringify({ start: 1, num: 20, total: 0, results: [] });
  const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as { kind: string; form: { text: string; bbox: number[] | null; sort: string }; filters: string[]; recordId: string | null; title: string; total: number; time: string }[];
  const box = (container: HTMLElement) => container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!;
  const list = (container: HTMLElement) => container.querySelector<HTMLElement>(".ordt-history")!;
  const items = (container: HTMLElement) => Array.from(list(container).querySelectorAll<HTMLElement>(".ordt-history-item"));
  const key = (container: HTMLElement, name: string) => {
    const event = new KeyboardEvent("keydown", { key: name, cancelable: true });
    box(container).dispatchEvent(event);
    return event;
  };
  const mousedown = (el: Element) => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  async function searchFor(container: HTMLElement, text: string) {
    box(container).value = text;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
  }
  const entry = (text: string, patch: Record<string, unknown> = {}) => ({
    kind: "search",
    form: { kind: "all", serviceTypes: [], availableAs: [], text, textMode: "all", field: "", keywords: "", organisation: "", invertOrganisation: false, inspireThemes: [], openDataOnly: false, dateField: "apiso_RevisionDate_dt", dateFrom: "", dateTo: "", bbox: null, spatialRel: "Intersects", sort: "" },
    filters: [],
    recordId: null,
    title: "",
    total: 7,
    time: new Date().toISOString(),
    ...patch,
  });

  beforeEach(() => localStorage.clear());

  it("saves a search started from the box, and updates it for a page, the order or a filter removed", async () => {
    let answer = fixture("search-alberi.json");
    const { container } = await mountPanel(() => answer);
    await searchFor(container, "alberi");
    expect(stored().map((e) => [e.kind, e.form.text, e.filters, e.total, e.form.bbox])).toEqual([["search", "alberi", ["Map view"], 41, [12, 41, 13, 42]]]);

    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    const sort = container.querySelector<HTMLSelectElement>(".ordt-sort")!;
    sort.value = "title:asc";
    sort.dispatchEvent(new Event("change"));
    await flush();
    expect(stored().map((e) => [e.form.text, e.form.sort])).toEqual([["alberi", "title:asc"]]);
    container.querySelector<HTMLButtonElement>(".ordt-chip-remove")!.click();
    await flush();
    expect(stored().map((e) => [e.form.text, e.filters])).toEqual([["alberi", []]]);

    // Another search from the box is another entry; one with no results is none.
    await searchFor(container, "ortofoto");
    expect(stored().map((e) => e.form.text)).toEqual(["ortofoto", "alberi"]);
    answer = none;
    await searchFor(container, "bombazza");
    expect(stored().map((e) => e.form.text)).toEqual(["ortofoto", "alberi"]);
  });

  it("does not save a search a project brings, and calls its box a saved area", async () => {
    const ctx = await mountPanel(() => fixture("search-alberi.json"));
    plugin.applyProjectState!(ctx.host as never, { v: 1, form: { ...entry("alberi").form, bbox: [12.95, 37.6, 14.3, 38.3] }, start: 1, recordId: null });
    await flush();
    expect(new URL(ctx.requested.at(-1)!).searchParams.get("bbox")).toBe("12.95,37.6,14.3,38.3");
    expect(chipLabels(ctx.container)).toEqual(["Saved area"]);
    expect(stored()).toEqual([]);
  });

  it("opens under the search box, narrows while typing, and takes the keys", async () => {
    localStorage.setItem(KEY, JSON.stringify([
      entry("ortofoto", { filters: ["WMS", "Only: Regione Piemonte"], total: 1417 }),
      { ...entry('fileid:"r_lazio:cf08"'), kind: "record", recordId: "r_lazio:cf08", title: "pericolositap3p4(mg)", total: 1 },
      entry("", { filters: ["Map view"], time: "2026-01-05T10:00:00.000Z" }),
    ]));
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    expect(box(container).getAttribute("autocomplete")).toBe("off");
    expect(list(container).hidden).toBe(true);
    box(container).dispatchEvent(new Event("focus"));
    expect([list(container).hidden, box(container).getAttribute("aria-expanded")]).toEqual([false, "true"]);
    expect(list(container).closest(".ordt-search-bar")).not.toBeNull();
    expect(list(container).querySelector(".ordt-history-head")!.firstChild!.textContent).toBe("Recent searches");
    const text = (el: HTMLElement, cls: string) => el.querySelector(cls)?.textContent ?? null;
    expect(items(container).map((el) => [text(el, ".ordt-history-text"), text(el, ".ordt-history-kind"), text(el, ".ordt-history-sub"), text(el, ".ordt-history-count")])).toEqual([
      ["ortofoto", null, "WMS · Only: Regione Piemonte", "1,417"],
      ["pericolositap3p4(mg)", "Record", "r_lazio:cf08", null],
      ["No text", null, "Map view", "7"],
    ]);
    expect(text(items(container)[2], ".ordt-history-when")).toBe("2026-01-05");
    expect(text(items(container)[0], ".ordt-history-when")).toMatch(/^\d\d:\d\d$/);

    // Letters of a filter find the entry; with none left the list closes.
    box(container).value = "piemonte";
    box(container).dispatchEvent(new Event("input"));
    expect(items(container)).toHaveLength(1);
    expect(list(container).querySelector(".ordt-history-head")!.firstChild!.textContent).toBe("1 of 3 recent searches");
    box(container).value = "zzz";
    box(container).dispatchEvent(new Event("input"));
    expect(list(container).hidden).toBe(true);
    box(container).value = "";
    box(container).dispatchEvent(new Event("input"));

    // Down, down, up; Delete removes the highlighted entry; Esc closes and keeps the text.
    const selected = () => items(container).findIndex((el) => el.getAttribute("aria-selected") === "true");
    key(container, "ArrowDown");
    key(container, "ArrowDown");
    expect(selected()).toBe(1);
    key(container, "ArrowUp");
    expect(selected()).toBe(0);
    key(container, "ArrowUp");
    expect(selected()).toBe(-1);
    key(container, "ArrowDown");
    key(container, "Delete");
    expect(stored().map((e) => e.kind)).toEqual(["record", "search"]);
    box(container).value = "pe";
    box(container).dispatchEvent(new Event("input"));
    expect(key(container, "Escape").defaultPrevented).toBe(true);
    expect([list(container).hidden, box(container).value]).toEqual([true, "pe"]);
    // With the list closed Esc is the browser's own.
    expect(key(container, "Escape").defaultPrevented).toBe(false);
  });

  it("lists every search on a click in a box that still holds the last text; only typing narrows", async () => {
    localStorage.setItem(KEY, JSON.stringify([entry("alberi"), entry("ortofoto")]));
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    await searchFor(container, "idrografia");
    // The box keeps "idrografia", the search on screen: the list is not narrowed to it.
    box(container).dispatchEvent(new Event("focus"));
    expect(items(container).map((el) => el.querySelector(".ordt-history-text")!.textContent)).toEqual(["idrografia", "alberi", "ortofoto"]);
    expect(list(container).querySelector(".ordt-history-head")!.firstChild!.textContent).toBe("Recent searches");
    box(container).value = "idrografi";
    box(container).dispatchEvent(new Event("input"));
    expect(items(container)).toHaveLength(1);
    // Closed and opened again, it lists them all once more.
    key(container, "Escape");
    box(container).dispatchEvent(new Event("click"));
    expect(items(container)).toHaveLength(3);
    key(container, "Escape");
    key(container, "ArrowDown");
    expect(items(container)).toHaveLength(3);
  });

  it("closes on a press outside the search bar, in the panel or anywhere else on the page", async () => {
    localStorage.setItem(KEY, JSON.stringify([entry("alberi"), entry("ortofoto")]));
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    box(container).dispatchEvent(new Event("focus"));
    mousedown(box(container));
    expect(list(container).hidden).toBe(false);
    // The map, GeoLibre's layer list: outside the panel.
    mousedown(document.body);
    expect(list(container).hidden).toBe(true);
    box(container).dispatchEvent(new Event("focus"));
    mousedown(container.querySelector(".ordt-footer")!);
    expect(list(container).hidden).toBe(true);
  });

  it("removes one entry with its ×, and all of them after asking", async () => {
    localStorage.setItem(KEY, JSON.stringify([entry("a"), entry("b"), entry("c")]));
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    box(container).dispatchEvent(new Event("focus"));
    mousedown(items(container)[1].querySelector(".ordt-history-remove")!);
    expect(stored().map((e) => e.form.text)).toEqual(["a", "c"]);
    expect(list(container).hidden).toBe(false);
    const foot = () => list(container).querySelector<HTMLElement>(".ordt-history-foot")!;
    expect(foot().textContent).toBe("Clear historyOn this computer only");
    mousedown(foot().querySelector("button")!);
    expect(foot().textContent).toBe("Clear all 2 searches?ClearKeep");
    mousedown(foot().querySelectorAll("button")[1]);
    expect(foot().textContent).toBe("Clear historyOn this computer only");
    mousedown(foot().querySelector("button")!);
    mousedown(foot().querySelector("button")!);
    expect([list(container).hidden, localStorage.getItem(KEY)]).toEqual([true, null]);
    // An empty history opens nothing.
    box(container).dispatchEvent(new Event("focus"));
    expect(list(container).hidden).toBe(true);
  });

  it("runs an entry again with its filters, on its saved area", async () => {
    localStorage.setItem(KEY, JSON.stringify([
      entry("vecchia"),
      entry("ortofoto", { form: { ...entry("ortofoto").form, bbox: [7.5, 44, 9.5, 46], availableAs: ["WMS"] }, filters: ["WMS", "Map view"] }),
    ]));
    const { container, requested, host } = await mountPanel(() => fixture("search-alberi.json"));
    box(container).dispatchEvent(new Event("focus"));
    mousedown(items(container)[1]);
    await flush();
    const params = new URL(requested.at(-1)!).searchParams;
    expect([params.get("bbox"), params.get("start")]).toEqual(["7.5,44,9.5,46", "1"]);
    expect(params.get("q")).toContain("(ortofoto)");
    expect(host.fitBounds).toHaveBeenCalledWith([7.5, 44, 9.5, 46]);
    expect([list(container).hidden, box(container).value]).toEqual([true, "ortofoto"]);
    // The chip names the saved area; the entry goes back on top and still says what the area was.
    expect(chipLabels(container)).toEqual(["WMS", "Saved area"]);
    expect(stored().map((e) => [e.form.text, e.filters])).toEqual([["ortofoto", ["WMS", "Map view"]], ["vecchia", []]]);
  });

  it("keeps a record opened by its id, with its title, and opens it again", async () => {
    const page = JSON.parse(fixture("search-alberi.json"));
    const record = page.results[0];
    const id = record.id ?? record._source.fileid;
    const one = JSON.stringify({ ...page, total: 1, results: [record] });
    const { container, requested } = await mountPanel((url) => (url.includes("fileid") ? one : fixture("search-alberi.json")));
    await searchFor(container, id);
    expect(stored().map((e) => [e.kind, e.recordId, e.title, e.filters])).toEqual([["record", id, container.querySelector(".ordt-detail-title")!.textContent, []]]);
    await searchFor(container, "alberi");
    box(container).dispatchEvent(new Event("focus"));
    expect(items(container).map((el) => el.querySelector(".ordt-history-kind")?.textContent ?? "")).toEqual(["", "Record"]);
    const before = requested.length;
    mousedown(items(container)[1]);
    await flush();
    expect(requested.length).toBeGreaterThan(before);
    expect(requested.at(-1)).toContain("fileid");
    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(false);
    expect(stored().map((e) => e.kind)).toEqual(["record", "search"]);
  });

  it("can be turned off in Settings, which clears the list", async () => {
    localStorage.setItem(KEY, JSON.stringify([entry("a"), entry("b")]));
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const toggle = container.querySelector<HTMLInputElement>('input[name="rememberSearches"]')!;
    const size = () => container.querySelector(".ordt-history-size")!.textContent;
    expect(toggle.checked).toBe(true);
    box(container).dispatchEvent(new Event("focus"));
    expect(size()).toBe("2 searches");
    await searchFor(container, "alberi");
    expect(size()).toBe("3 searches");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect([size(), localStorage.getItem(KEY)]).toEqual(["0 searches", null]);
    await searchFor(container, "ortofoto");
    expect(localStorage.getItem(KEY)).toBeNull();
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await searchFor(container, "ortofoto");
    expect(stored().map((e) => e.form.text)).toEqual(["ortofoto"]);
    container.querySelector<HTMLButtonElement>(".ordt-clear-history")!.click();
    expect([size(), localStorage.getItem(KEY)]).toEqual(["0 searches", null]);
  });
});
