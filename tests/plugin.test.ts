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
