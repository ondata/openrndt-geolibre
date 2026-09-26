import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { FootprintsLayer } from "../src/rndt/footprints-layer";

/** Tiny stand-in for a MapLibre map: layer order, sources, events. */
function fakeMap() {
  const order: string[] = ["background"];
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const handlers: Record<string, (() => void)[]> = {};
  const map = {
    order,
    on: (event: string, ...rest: unknown[]) => {
      const fn = rest.at(-1) as () => void;
      (handlers[event] ??= []).push(fn);
    },
    off: vi.fn(),
    fire: (event: string) => handlers[event]?.forEach((fn) => fn()),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => (order.includes(id) ? { id } : undefined),
    addLayer: (layer: { id: string }) => order.push(layer.id),
    removeLayer: (id: string) => order.splice(order.indexOf(id), 1),
    moveLayer: vi.fn((id: string) => {
      order.splice(order.indexOf(id), 1);
      order.push(id);
    }),
    getLayersOrder: () => [...order],
    setFilter: vi.fn(),
    getCanvas: () => ({ style: {} }),
  };
  return map;
}

describe("FootprintsLayer", () => {
  it("moves the footprints back on top when a layer is added above them", () => {
    const map = fakeMap();
    const layer = new FootprintsLayer(map as unknown as MapLibreMap, () => undefined);
    layer.setData({ type: "FeatureCollection", features: [] });
    expect(map.order.slice(-3)).toEqual([
      "openrndt-geolibre-footprints-fill",
      "openrndt-geolibre-footprints-line",
      "openrndt-geolibre-footprints-selected",
    ]);
    // A new basemap arrives as a layer on top.
    map.order.push("google-satellite");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    map.fire("styledata");
    expect(map.order.at(-1)).toBe("openrndt-geolibre-footprints-selected");
    expect(map.order.at(-4)).toBe("google-satellite");
    vi.restoreAllMocks();
  });

  it("re-adds source and layers after a style reset", () => {
    const map = fakeMap();
    const layer = new FootprintsLayer(map as unknown as MapLibreMap, () => undefined);
    layer.setData({ type: "FeatureCollection", features: [] });
    map.order.splice(0, map.order.length, "new-style-background");
    map.removeSource("openrndt-geolibre-footprints");
    map.fire("styledata");
    expect(map.getSource("openrndt-geolibre-footprints")).toBeDefined();
    expect(map.order).toContain("openrndt-geolibre-footprints-fill");
  });
});
