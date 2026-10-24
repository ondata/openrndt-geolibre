import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/geolibre";
import type { GeoLibreRightPanelRegistration } from "../src/lib/geolibre/host-api";
import { addressWith, syncAddress } from "../src/rndt/address";
import type { RndtHost } from "../src/rndt/host";
import type { RndtPanel } from "../src/rndt/panel";
import type { PanelState } from "../src/rndt/project-state";
import { emptyForm } from "../src/rndt/query";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://web.geolibre.app/";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const search = () => new URL(location.href).searchParams;

describe("addressWith (#61)", () => {
  const ours = new URLSearchParams("rndt=catasto&rndtBbox=6,36,19,47&lat=41.9&lon=12.5&zoom=6");

  it("keeps the parameters of others and replaces ours and GeoLibre's view", () => {
    const next = new URL(addressWith(`${BASE}?url=p.json&plugin=openrndt-geolibre&other=1&rndt=old&rndtTheme=hy&lat=45&lon=9&zoom=3`, ours));
    expect(next.searchParams.get("url")).toBe("p.json");
    expect(next.searchParams.get("plugin")).toBe("openrndt-geolibre");
    expect(next.searchParams.get("other")).toBe("1");
    expect(next.searchParams.get("rndt")).toBe("catasto");
    expect(next.searchParams.has("rndtTheme")).toBe(false);
    expect(next.searchParams.getAll("lat")).toEqual(["41.9"]);
  });

  it("writes commas as they are", () => {
    expect(addressWith(BASE, ours)).toContain("rndtBbox=6,36,19,47");
  });

  it("takes ours out on stop and leaves GeoLibre's view and the rest", () => {
    const next = new URL(addressWith(`${BASE}?url=p.json&rndt=old&rndtLayer=a~wms~b&rndtView=6,36,19,47&lat=45&lon=9&zoom=3`, null));
    expect([...next.searchParams.keys()]).toEqual(["url", "lat", "lon", "zoom"]);
  });
});

describe("syncAddress (#61)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/?url=p.json");
  });
  afterEach(() => vi.useRealTimers());

  const setup = (initial: PanelState | null) => {
    let state = initial;
    const panel = { onStateChange: null as (() => void) | null, projectState: () => state };
    const handlers = new Map<string, () => void>();
    const map = {
      on: (event: string, f: () => void) => handlers.set(event, f),
      off: vi.fn(),
      getCenter: () => ({ wrap: () => ({ lng: 12.5, lat: 41.9 }) }),
      getZoom: () => 6,
    };
    const app = { getMap: () => map } as unknown as RndtHost;
    const stop = syncAddress(panel as unknown as RndtPanel, app);
    return { panel, map, stop, move: () => handlers.get("moveend")!(), set: (s: PanelState | null) => (state = s) };
  };
  const state = (text: string, recordId: string | null = null): PanelState => ({ v: 1, form: { ...emptyForm(), text }, start: 1, recordId });

  it("writes the search and the map view after the panel or the map settles, without plugin=", () => {
    const { panel, move, set } = setup(null);
    vi.advanceTimersByTime(600);
    expect(location.search).toBe("?url=p.json");
    set(state("catasto"));
    panel.onStateChange!();
    vi.advanceTimersByTime(600);
    expect(search().get("rndt")).toBe("catasto");
    expect(search().get("lat")).toBe("41.9");
    expect(search().get("zoom")).toBe("6");
    expect(search().get("url")).toBe("p.json");
    expect(search().has("plugin")).toBe(false);
    set(state("catasto", "r_lomb:123"));
    move();
    vi.advanceTimersByTime(600);
    expect(search().get("rndt")).toBe("r_lomb:123");
  });

  it("leaves a link alone while there is no search, and takes ours out when results are cleared", () => {
    history.replaceState(null, "", "/?url=p.json&rndt=idrografia");
    const { panel, move, set } = setup(null);
    move();
    vi.advanceTimersByTime(600);
    expect(search().get("rndt")).toBe("idrografia");
    set(state("idrografia"));
    panel.onStateChange!();
    vi.advanceTimersByTime(600);
    set(null);
    panel.onStateChange!();
    vi.advanceTimersByTime(600);
    expect(location.search).toBe("?url=p.json&lat=41.9&lon=12.5&zoom=6");
  });

  it("stops listening and takes ours out on stop", () => {
    const { panel, map, stop, set } = setup(state("catasto"));
    vi.advanceTimersByTime(600);
    expect(search().get("rndt")).toBe("catasto");
    stop();
    expect(panel.onStateChange).toBeNull();
    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    set(state("altro"));
    vi.advanceTimersByTime(600);
    expect([...search().keys()]).toEqual(["url", "lat", "lon", "zoom"]);
  });
});

describe("the plugin keeps the address (#61)", () => {
  const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
  const createHost = () => {
    let panel: GeoLibreRightPanelRegistration | null = null;
    const host: RndtHost = {
      registerRightPanel: (p) => {
        panel = p;
        return vi.fn();
      },
      openRightPanel: vi.fn(() => true),
      closeRightPanel: vi.fn(),
      fetchArrayBuffer: vi.fn(async () => new TextEncoder().encode(fixture("search-services.json")).buffer as ArrayBuffer),
      fitBounds: vi.fn(),
      getViewBounds: () => [12, 41, 13, 42],
    };
    const mount = () => {
      const container = document.createElement("div");
      document.body.append(container);
      panel!.render(container);
      return container;
    };
    return { host, mount };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

  it("follows a search and cleans up when turned off", async () => {
    history.replaceState(null, "", "/?url=p.json");
    const { host, mount } = createHost();
    plugin.activate(host);
    const container = mount();
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "catasto";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    await settle();
    expect(search().get("rndt")).toBe("catasto");
    expect(search().get("url")).toBe("p.json");
    plugin.deactivate(host);
    expect(location.search).toBe("?url=p.json");
  });

  it("opened from a link, waits for the link and then follows it", async () => {
    history.replaceState(null, "", "/?plugin=openrndt-geolibre&rndt=idrografia");
    const { host, mount } = createHost();
    plugin.activate(host);
    mount();
    await settle();
    expect(location.search).toBe("?plugin=openrndt-geolibre&rndt=idrografia");
    await plugin.handleUrlParameters!(host, new URLSearchParams(location.search));
    await flush();
    await settle();
    expect(search().get("rndt")).toBe("idrografia");
    expect(search().get("plugin")).toBe("openrndt-geolibre");
    plugin.deactivate(host);
    expect(location.search).toBe("?plugin=openrndt-geolibre");
  });
});
