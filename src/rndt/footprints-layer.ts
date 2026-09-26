import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";

const SOURCE_ID = "openrndt-geolibre-footprints";
const FILL_ID = "openrndt-geolibre-footprints-fill";
const LINE_ID = "openrndt-geolibre-footprints-line";
const SELECTED_ID = "openrndt-geolibre-footprints-selected";
const COLOR = "#d9480f";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Search-result footprints drawn straight on the MapLibre map. They are a
 * temporary aid, replaced on every search, so they are not added to the
 * project's layer store (the plugin API has no call to remove a store layer).
 * A basemap change rebuilds the style and drops them: `styledata` re-adds them.
 */
export class FootprintsLayer {
  private data: FeatureCollection = EMPTY;
  private selectedId: string | null = null;
  private lastMove = 0;
  private readonly onStyleData = () => this.ensure();
  private readonly onClick = (event: MapLayerMouseEvent) => {
    const id = event.features?.[0]?.properties?.id;
    if (typeof id === "string") this.onSelect(id);
  };
  private readonly onEnter = () => {
    this.map.getCanvas().style.cursor = "pointer";
  };
  private readonly onLeave = () => {
    this.map.getCanvas().style.cursor = "";
  };

  constructor(
    private readonly map: MapLibreMap,
    private readonly onSelect: (recordId: string) => void,
  ) {
    map.on("styledata", this.onStyleData);
    map.on("click", FILL_ID, this.onClick);
    map.on("mouseenter", FILL_ID, this.onEnter);
    map.on("mouseleave", FILL_ID, this.onLeave);
  }

  private ensure(): void {
    try {
      this.addToMap();
    } catch {
      // Style still loading: the next `styledata` event retries.
    }
  }

  private addToMap(): void {
    const map = this.map;
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: "geojson", data: this.data });
    }
    if (!map.getLayer(FILL_ID)) {
      map.addLayer({
        id: FILL_ID,
        type: "fill",
        source: SOURCE_ID,
        // Many records share the same extent (a region, a municipality): the
        // stacked fills would tint the whole map when zoomed in, so the fill
        // fades out with zoom and only the outlines remain.
        paint: {
          "fill-color": COLOR,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.05, 8, 0.02, 10, 0],
        },
      });
    }
    if (!map.getLayer(LINE_ID)) {
      map.addLayer({
        id: LINE_ID,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": COLOR, "line-width": 1.2, "line-opacity": 0.8 },
      });
    }
    if (!map.getLayer(SELECTED_ID)) {
      map.addLayer({
        id: SELECTED_ID,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": COLOR, "line-width": 3.5 },
        filter: ["==", ["get", "id"], this.selectedId ?? ""],
      });
    }
    this.keepOnTop();
  }

  /**
   * Layers added after the footprints (a new basemap is added as a layer on
   * top, as are WMS layers) would hide them: move them back to the top. The
   * check runs on every `styledata`, so it only moves when needed.
   */
  private keepOnTop(): void {
    const map = this.map;
    const order = map.getLayersOrder();
    const ours = [FILL_ID, LINE_ID, SELECTED_ID];
    if (order.slice(-ours.length).join() === ours.join()) return;
    // At most one move per second, so the plugin never fights the host's own
    // layer ordering in a loop of `styledata` events.
    const now = Date.now();
    if (now - this.lastMove < 1000) return;
    this.lastMove = now;
    for (const id of ours) map.moveLayer(id);
  }

  setData(data: FeatureCollection): void {
    this.data = data;
    this.selectedId = null;
    this.ensure();
    (this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);
    this.applySelection();
  }

  select(recordId: string | null): void {
    this.selectedId = recordId;
    this.applySelection();
  }

  private applySelection(): void {
    if (this.map.getLayer(SELECTED_ID)) {
      this.map.setFilter(SELECTED_ID, ["==", ["get", "id"], this.selectedId ?? ""]);
    }
  }

  clear(): void {
    this.setData(EMPTY);
  }

  remove(): void {
    const map = this.map;
    map.off("styledata", this.onStyleData);
    map.off("click", FILL_ID, this.onClick);
    map.off("mouseenter", FILL_ID, this.onEnter);
    map.off("mouseleave", FILL_ID, this.onLeave);
    for (const id of [SELECTED_ID, LINE_ID, FILL_ID]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }
}
