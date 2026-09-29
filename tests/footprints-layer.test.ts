import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { FootprintsLayer } from "../src/rndt/footprints-layer";

/** Tiny stand-in for a MapLibre map: layer order, sources, events. */
function fakeMap() {
  const order: string[] = ["background"];
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  const container = document.createElement("div");
  const map = {
    order,
    on: (event: string, ...rest: unknown[]) => {
      const fn = rest.at(-1) as (arg?: unknown) => void;
      (handlers[event] ??= []).push(fn);
    },
    off: vi.fn(),
    fire: (event: string, arg?: unknown) => handlers[event]?.forEach((fn) => fn(arg)),
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
    setLayoutProperty: vi.fn(),
    getCanvas: () => ({ style: {} }),
    getContainer: () => container,
    container,
  };
  return map;
}

describe("FootprintsLayer", () => {
  it("moves the footprints back on top when a layer is added above them", () => {
    const map = fakeMap();
    const layer = new FootprintsLayer(map as unknown as MapLibreMap, () => undefined);
    layer.setData({ type: "FeatureCollection", features: [] });
    expect(map.order.slice(-4)).toEqual([
      "openrndt-geolibre-footprints-fill",
      "openrndt-geolibre-footprints-line",
      "openrndt-geolibre-footprints-hover",
      "openrndt-geolibre-footprints-selected",
    ]);
    // A new basemap arrives as a layer on top.
    map.order.push("google-satellite");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    map.fire("styledata");
    expect(map.order.at(-1)).toBe("openrndt-geolibre-footprints-selected");
    expect(map.order.at(-5)).toBe("google-satellite");
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

  it("hides all footprints and shows them again, also those hidden one by one", () => {
    const map = fakeMap();
    const layer = new FootprintsLayer(map as unknown as MapLibreMap, () => undefined);
    layer.setData({ type: "FeatureCollection", features: [] });

    layer.setHidden("a", true);
    expect(layer.isHidden("a")).toBe(true);
    expect(map.setFilter).toHaveBeenLastCalledWith("openrndt-geolibre-footprints-selected", [
      "all",
      ["==", ["get", "id"], ""],
      ["!", ["in", ["get", "id"], ["literal", ["a"]]]],
    ]);

    layer.setVisible(false);
    expect(layer.isVisible()).toBe(false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("openrndt-geolibre-footprints-fill", "visibility", "none");

    layer.setVisible(true);
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      "openrndt-geolibre-footprints-selected",
      "visibility",
      "visible",
    );
    expect(layer.isHidden("a")).toBe(false);
  });

  it("keeps the global choice and resets single records on new data", () => {
    const map = fakeMap();
    const layer = new FootprintsLayer(map as unknown as MapLibreMap, () => undefined);
    layer.setData({ type: "FeatureCollection", features: [] });
    layer.setHidden("a", true);
    layer.setVisible(false);
    layer.setData({ type: "FeatureCollection", features: [] });
    expect(layer.isVisible()).toBe(false);
    expect(layer.isHidden("a")).toBe(false);
  });

  it("re-adds hidden layers hidden after a style reset", () => {
    const map = fakeMap();
    const added: { id: string; layout?: { visibility?: string } }[] = [];
    map.addLayer = (l: { id: string; layout?: { visibility?: string } }) => {
      added.push(l);
      return map.order.push(l.id);
    };
    const layer = new FootprintsLayer(map as unknown as MapLibreMap, () => undefined);
    layer.setData({ type: "FeatureCollection", features: [] });
    layer.setVisible(false);
    map.order.splice(0, map.order.length, "new-style-background");
    added.length = 0;
    map.fire("styledata");
    expect(added.map((l) => l.layout?.visibility)).toEqual(["none", "none", "none", "none"]);
  });

  describe("click on overlapping footprints", () => {
    const box = (id: string, title: string, [w, s, e, n]: number[]) => ({
      type: "Feature" as const,
      properties: { id, title },
      geometry: { type: "Polygon" as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    });
    const data = {
      type: "FeatureCollection" as const,
      features: [
        box("italy", "Italy", [6, 36, 19, 47]),
        box("sicily", "Sicily", [12, 36, 16, 39]),
        box("palermo", "Palermo", [13, 38, 13.5, 38.3]),
      ],
    };
    // Rendered features as MapLibre returns them: drawing order, a duplicate from another tile.
    const hit = (...ids: string[]) => ({
      point: { x: 10, y: 10 },
      features: ids.map((id) => ({ properties: { id, title: data.features.find((f) => f.properties.id === id)!.properties.title } })),
    });

    it("selects the only footprint under the cursor", () => {
      const map = fakeMap();
      const onSelect = vi.fn();
      new FootprintsLayer(map as unknown as MapLibreMap, onSelect).setData(data);
      map.fire("click", hit("italy", "italy"));
      expect(onSelect).toHaveBeenCalledWith("italy");
      expect(map.container.querySelector(".ordt-footprint-menu")).toBeNull();
    });

    it("lists several footprints smallest first and selects the chosen one", () => {
      const map = fakeMap();
      const onSelect = vi.fn();
      const onHover = vi.fn();
      new FootprintsLayer(map as unknown as MapLibreMap, onSelect, onHover).setData(data);
      map.fire("click", hit("italy", "sicily", "palermo", "italy"));
      expect(onSelect).not.toHaveBeenCalled();
      const items = Array.from(map.container.querySelectorAll<HTMLButtonElement>(".ordt-footprint-menu-item"));
      expect(items.map((i) => i.textContent)).toEqual(["Palermo", "Sicily", "Italy"]);
      expect(onHover).toHaveBeenLastCalledWith("palermo");
      items[1].dispatchEvent(new MouseEvent("mouseenter"));
      expect(onHover).toHaveBeenLastCalledWith("sicily");
      expect(map.setFilter).toHaveBeenLastCalledWith("openrndt-geolibre-footprints-hover", [
        "all",
        ["==", ["get", "id"], "sicily"],
        ["!", ["in", ["get", "id"], ["literal", []]]],
      ]);
      items[1].click();
      expect(onSelect).toHaveBeenCalledWith("sicily");
      expect(map.container.querySelector(".ordt-footprint-menu")).toBeNull();
    });

    it("closes the menu with Escape", () => {
      const map = fakeMap();
      new FootprintsLayer(map as unknown as MapLibreMap, () => undefined).setData(data);
      map.fire("click", hit("italy", "sicily"));
      expect(map.container.querySelector(".ordt-footprint-menu")).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(map.container.querySelector(".ordt-footprint-menu")).toBeNull();
    });

    it("shows the smallest title on hover and marks it", () => {
      const map = fakeMap();
      const onHover = vi.fn();
      new FootprintsLayer(map as unknown as MapLibreMap, () => undefined, onHover).setData(data);
      map.fire("mousemove", hit("italy", "palermo"));
      expect(onHover).toHaveBeenLastCalledWith("palermo");
      expect(map.container.querySelector(".ordt-footprint-tooltip")?.textContent).toBe("Palermo (+1, click to choose)");
      map.fire("mouseleave");
      expect(onHover).toHaveBeenLastCalledWith(null);
      expect(map.container.querySelector(".ordt-footprint-tooltip")).toBeNull();
    });
  });
});
