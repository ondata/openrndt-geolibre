import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/geolibre";
import type { GeoLibreRightPanelRegistration } from "../src/lib/geolibre/host-api";
import { ITALY_BBOX, PANEL_ID } from "../src/rndt/constants";
import type { RndtHost } from "../src/rndt/host";

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

  it("leaves a view that touches Italy where it is", () => {
    expect(activateWith([12, 41, 13, 42])).not.toHaveBeenCalled();
    expect(activateWith([-30, 20, 40, 60])).not.toHaveBeenCalled();
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

  async function openWfs() {
    const ctx = await mountPanel((url) => {
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
    return { ...ctx, item };
  }

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
    list.dispatchEvent(new Event("pointerenter"));
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
    const ucem = item.querySelector<HTMLInputElement>('[aria-label="WFS feature types"] input[value="RIFIUTI:UCEM"]')!;
    ucem.checked = true;
    ucem.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const targeted = ctx.requested.filter((u) => u.includes("f=csw")).map((u) => new URL(u).searchParams.get("q"));
    expect(targeted.some((q) => q?.endsWith("*UCEM*"))).toBe(true);
    expect(rows(item)).toContain("Utilizzo in cementifici R5 (UCEM) | RIFIUTI:UCEM");
    expect(item.textContent).toMatch(/looked up in RNDT for the selected layer only/);
  });

  it("filters a long list on name and readable name", async () => {
    const { item } = await openWfs();
    await flush();
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
    expect(container.querySelector(".ordt-summary-text")!.textContent).toBe("No filters");
    expect(clearAll().hidden).toBe(true);
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
    const { errorReport, errorReportText } = await import("../src/rndt/panel");
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
    expect(JSON.parse(localStorage.getItem("openrndt-geolibre:settings")!)).toEqual({ logErrors: false });
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
    expect(loadSettings()).toEqual({ logErrors: false });
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
    const back = view.querySelector<HTMLButtonElement>(".ordt-back")!;
    expect(back.textContent).toBe("← 41 results");
    // Services and links live only in the view, not in the cards.
    expect(container.querySelector(".ordt-results .ordt-services")).toBeNull();

    const scrolled = vi.fn();
    card.scrollIntoView = scrolled;
    back.click();
    expect(view.hidden).toBe(true);
    expect(view.childElementCount).toBe(0);
    expect(panel.classList.contains("ordt-in-detail")).toBe(false);
    // The card just seen is marked and brought to the top of the list.
    expect(card.classList.contains("ordt-last-viewed")).toBe(true);
    expect(scrolled).toHaveBeenCalledWith({ block: "start" });
    // Opening another record moves the mark.
    const other = container.querySelectorAll<HTMLElement>(".ordt-result")[2];
    openDetail(other).querySelector<HTMLButtonElement>(".ordt-back")!.click();
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

  async function openTwin() {
    const ctx = await mountPanel((url) => {
      if (url.includes("/rest/metadata/search") && url.includes("f=csw")) throw new Error("no RNDT lookup here");
      if (url.includes("/rest/metadata/search")) return fixture("search-services.json");
      return caps;
    });
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

  async function open(answer: (url: string) => string | ArrayBuffer, browserDraws = true) {
    vi.stubGlobal("fetch", async () => (browserDraws ? new Response(png) : Promise.reject(new TypeError("Failed to fetch"))));
    const ctx = createHost(() => "");
    ctx.host.fetchArrayBuffer = vi.fn(async (url: string) => {
      ctx.requested.push(url);
      if (url.includes("/rest/metadata/search")) return encode(search);
      const out = answer(url);
      return typeof out === "string" ? encode(out) : out;
    });
    ctx.host.addTileLayer = vi.fn(() => "tile-1");
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
    expect(item.querySelector('[aria-label="ArcGIS layers"] .ordt-layer-tag')!.textContent).toBe("on the map");
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
