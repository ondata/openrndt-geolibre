import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import plugin from "../src/geolibre";
import type { GeoLibreRightPanelRegistration } from "../src/lib/geolibre/host-api";
import { PANEL_ID } from "../src/rndt/constants";
import type { RndtHost } from "../src/rndt/host";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    const item = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    item.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    expect(item.querySelector<HTMLElement>(".ordt-detail")!.hidden).toBe(false);
    const addButton = Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Add to map…",
    )!;
    addButton.click();
    await flush();
    expect(requested.at(-1)).toMatch(/REQUEST=GetCapabilities/);
    const addLayer = Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Add layer",
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
        const item = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
          li.querySelector(".ordt-badge-service")?.textContent === "WMS",
        )!;
        item.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
        Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add to map…")!.click();
        await flush();
        Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add layer")!.click();
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
    const item = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      li.querySelector(".ordt-badge-service")?.textContent === "WMS",
    )!;
    item.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    Array.from(item.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent === "Add to map…")!
      .click();
    await flush();
    const addLayer = Array.from(item.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Add layer",
    )!;
    expect(addLayer.disabled).toBe(true);
    expect(item.textContent).toContain("not offered in EPSG:3857");
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

  it("offers inside the area once an area is chosen", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    const choice = container.querySelector<HTMLElement>(".ordt-spatial-rel")!;
    expect(choice.hidden).toBe(true);
    const where = container.querySelector<HTMLSelectElement>('select[name="where"]')!;
    where.value = "view";
    where.dispatchEvent(new Event("change"));
    expect(choice.hidden).toBe(false);
    container.querySelector<HTMLInputElement>('input[name="spatialRel"][value="Within"]')!.checked = true;
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(new URL(requested[0]).searchParams.get("spatialRel")).toBe("Within");
  });

  it("toggles the search-mode help and runs an example", async () => {
    const { requested, container } = await mountPanel(() =>
      fixture("search-alberi.json"),
    );
    const toggle =
      container.querySelector<HTMLButtonElement>(".ordt-help-toggle")!;
    const help = container.querySelector<HTMLElement>(".ordt-help")!;
    expect(toggle.getAttribute("aria-controls")).toBe(help.id);
    expect(help.hidden).toBe(true);
    toggle.click();
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

    toggle.click();
    expect(help.hidden).toBe(true);
  });

  it("explains every Search in option and runs its example", async () => {
    const { requested, container } = await mountPanel(() =>
      fixture("search-alberi.json"),
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Help on search fields"]',
    )!;
    const fieldHelp = Array.from(
      container.querySelectorAll<HTMLElement>(".ordt-help"),
    ).find((el) => el.id === toggle.getAttribute("aria-controls"))!;
    expect(fieldHelp.hidden).toBe(true);
    toggle.click();
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
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Help on search areas"]',
    )!;
    const whereHelp = Array.from(
      container.querySelectorAll<HTMLElement>(".ordt-help"),
    ).find((el) => el.id === toggle.getAttribute("aria-controls"))!;
    toggle.click();
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
    const copy = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Copy query",
    )!;
    expect(copy.disabled).toBe(true);

    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "alberi";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(copy.disabled).toBe(false);
    copy.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("--data-urlencode 'q=(alberi)'"));
    expect(copy.textContent).toBe("Copied");
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
    const item = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    item.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    const areaButtons = () => Array.from(item.querySelectorAll<HTMLButtonElement>("button"));
    const wfsRow = Array.from(item.querySelectorAll<HTMLElement>(".ordt-service")).find((row) =>
      row.textContent!.includes("WFS"),
    )!;
    Array.from(wfsRow.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add to map…")!.click();
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

  it("filters on a record's organisation, keeping the other filters", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "alberi";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const org = container.querySelector<HTMLButtonElement>(".ordt-org")!;
    expect(org.title).toBe("Show only results from this organisation");
    org.click();
    await flush();
    expect(container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value).toBe(org.textContent);
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

  it("hides a record's organisation with the Hide button", async () => {
    const { requested, container } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const name = container.querySelector<HTMLButtonElement>(".ordt-org")!.textContent!;
    container.querySelector<HTMLButtonElement>(".ordt-hide-org")!.click();
    await flush();
    const organisation = container.querySelector<HTMLInputElement>('input[name="organisation"]')!;
    const invert = container.querySelector<HTMLInputElement>('input[name="invertOrganisation"]')!;
    expect(organisation.value).toBe(name);
    expect(invert.checked).toBe(true);
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toMatch(/^NOT EnteResponsabile_s:/);

    // Clicking the name keeps only that organisation again.
    container.querySelector<HTMLButtonElement>(".ordt-org")!.click();
    await flush();
    expect(invert.checked).toBe(false);
    expect(new URL(requested.at(-1)!).searchParams.get("q")).toMatch(/^EnteResponsabile_s:/);
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
    const item = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    item.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    Array.from(item.querySelectorAll<HTMLButtonElement>("button"))
      .filter((b) => b.textContent === "Add to map…")
      .at(-1)!
      .click();
    await flush();
    return { ...ctx, item };
  }

  it("shows the layer names first, then adds RNDT titles in brackets", async () => {
    const { item } = await openWfs();
    await flush();
    const picker = item.querySelector<HTMLSelectElement>('select[aria-label="WFS feature type"]')!;
    const labels = Array.from(picker.options).map((o) => o.textContent);
    expect(labels).toContain("RIFIUTI:TDLD8 (Trattamento chimico-fisico e biologico di rifiuti liquidi D8 (TDLD8))");
    expect(labels).toContain("RIFIUTI:RAEER3 (Recupero RAEE R3 (RAEER3))");
    expect(labels).toContain("RIFIUTI:X0");
    expect(item.textContent).toMatch(/Readable names from RNDT for 3 of 35 layers/);
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
    const item = Array.from(ctx.container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === "WFS"),
    )!;
    item.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    Array.from(item.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent === "Add to map…").at(-1)!.click();
    await flush();
    await flush();
    const picker = item.querySelector<HTMLSelectElement>('select[aria-label="WFS feature type"]')!;
    picker.value = "RIFIUTI:UCEM";
    picker.dispatchEvent(new Event("change"));
    await flush();
    const targeted = ctx.requested.filter((u) => u.includes("f=csw")).map((u) => new URL(u).searchParams.get("q"));
    expect(targeted.some((q) => q?.endsWith("*UCEM*"))).toBe(true);
    expect(picker.selectedOptions[0].textContent).toBe("RIFIUTI:UCEM (Utilizzo in cementifici R5 (UCEM))");
    expect(item.textContent).toMatch(/looked up in RNDT for the selected layer only/);
  });

  it("filters a long list on name and readable name", async () => {
    const { item } = await openWfs();
    await flush();
    const filter = item.querySelector<HTMLInputElement>('input[aria-label="Filter layers"]')!;
    filter.value = "cementifici";
    filter.dispatchEvent(new Event("input"));
    const picker = item.querySelector<HTMLSelectElement>('select[aria-label="WFS feature type"]')!;
    const visible = Array.from(picker.options).filter((o) => !o.hidden).map((o) => o.value);
    expect(visible).toEqual(["RIFIUTI:UCEM"]);
    expect(picker.value).toBe("RIFIUTI:UCEM");
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
    expect(top.parentElement?.classList.contains("ordt-results-head")).toBe(true);
    expect(top.parentElement?.nextElementSibling?.classList.contains("ordt-results")).toBe(true);
    expect(pagers(container)).toEqual([
      ["Previous:off", "Next:on"],
      ["Previous:off", "Next:on"],
    ]);
  });

  it("the top Next asks for the next page and both pagers follow", async () => {
    const { container, requested } = await mountPanel(() => fixture("search-alberi.json"));
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    expect(new URL(requested.at(-1)!).searchParams.get("start")).toBe("21");
    const [top, bottom] = pagers(container);
    expect(top).toEqual(bottom);
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
  it("folds the form into a summary of the filters, and unfolds it on request", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    const summary = container.querySelector<HTMLElement>(".ordt-summary")!;
    const actions = container.querySelector<HTMLElement>(".ordt-result-actions")!;
    expect(summary.hidden).toBe(true);
    expect(actions.hidden).toBe(true);

    // The text box lives in the search bar, outside the form, and still counts.
    const text = container.querySelector<HTMLInputElement>('.ordt-search-bar input[name="text"]')!;
    expect(form.contains(text)).toBe(false);
    text.value = "alberi";
    container.querySelector<HTMLInputElement>('input[name="organisation"]')!.value = "Regione Piemonte";
    container.querySelector<HTMLInputElement>('input[name="invertOrganisation"]')!.checked = true;
    container.querySelector<HTMLInputElement>('input[name="availableAs"][value="WMS"]')!.checked = true;
    form.requestSubmit();
    await flush();

    expect(form.hidden).toBe(true);
    expect(actions.hidden).toBe(false);
    expect(summary.hidden).toBe(false);
    expect(summary.querySelector(".ordt-summary-text")!.textContent).toBe(
      "Filters: as WMS · hiding Regione Piemonte",
    );
    const toggle = summary.querySelector<HTMLButtonElement>("button")!;
    toggle.click();
    expect(form.hidden).toBe(false);
    expect(toggle.textContent).toBe("Hide filters");

    container.querySelector<HTMLButtonElement>(".ordt-result-actions button")!.click(); // Clear results
    expect(form.hidden).toBe(false);
    expect(summary.hidden).toBe(true);
    expect(actions.hidden).toBe(true);
  });

  it("keeps the filters as they are when changing page", async () => {
    const { container } = await mountPanel(() => fixture("search-alberi.json"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    form.requestSubmit();
    await flush();
    container.querySelector<HTMLButtonElement>(".ordt-summary button")!.click();
    container.querySelector<HTMLElement>(".ordt-pager-top")!.querySelectorAll("button")[1].click();
    await flush();
    expect(form.hidden).toBe(false);
  });
});
