import type { FeatureCollection } from "geojson";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapLayerMouseEvent,
} from "maplibre-gl";

const SOURCE_ID = "openrndt-geolibre-footprints";
const FILL_ID = "openrndt-geolibre-footprints-fill";
const LINE_ID = "openrndt-geolibre-footprints-line";
const HOVER_ID = "openrndt-geolibre-footprints-hover";
const SELECTED_ID = "openrndt-geolibre-footprints-selected";
const COLOR = "#d9480f";
const HOVER_COLOR = "#1971c2";
const LAYER_IDS = [FILL_ID, LINE_ID, HOVER_ID, SELECTED_ID];

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
  private hoverId: string | null = null;
  /** Chooser shown when a click hits several footprints. */
  private menu: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;
  private visible = true;
  /** Records whose footprint is hidden one by one; reset by `setData`. */
  private readonly hiddenIds = new Set<string>();
  private lastMove = 0;
  private readonly onStyleData = () => this.ensure();
  private readonly onClick = (event: MapLayerMouseEvent) => {
    const hits = this.hitsAt(event.features);
    if (hits.length === 1) this.onSelect(hits[0].id);
    else if (hits.length > 1) this.openMenu(hits, event.point);
  };
  private readonly onMove = (event: MapLayerMouseEvent) => {
    this.map.getCanvas().style.cursor = "pointer";
    if (this.menu) return;
    const hits = this.hitsAt(event.features);
    this.setHover(hits[0]?.id ?? null);
    this.showTooltip(hits, event.point);
  };
  private readonly onLeave = () => {
    this.map.getCanvas().style.cursor = "";
    if (this.menu) return;
    this.setHover(null);
    this.hideTooltip();
  };
  private readonly closeMenu = () => {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.setHover(null);
    this.map.off("movestart", this.closeMenu);
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("pointerdown", this.onOutside, true);
  };
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.closeMenu();
  };
  private readonly onOutside = (event: Event) => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
  };

  constructor(
    private readonly map: MapLibreMap,
    private readonly onSelect: (recordId: string) => void,
    /** A footprint is hovered on the map (null: none), to mark its result. */
    private readonly onHover: (recordId: string | null) => void = () => undefined,
  ) {
    map.on("styledata", this.onStyleData);
    map.on("click", FILL_ID, this.onClick);
    map.on("mousemove", FILL_ID, this.onMove);
    map.on("mouseleave", FILL_ID, this.onLeave);
  }

  /**
   * The footprints under the cursor, once each, smallest first: a click inside
   * a small extent means that record, not the regional or national extents
   * around it, which win by drawing order alone.
   */
  private hitsAt(features: MapGeoJSONFeature[] | undefined): { id: string; title: string }[] {
    const hits = new Map<string, { id: string; title: string; area: number }>();
    for (const feature of features ?? []) {
      const id = feature.properties?.id;
      if (typeof id !== "string" || hits.has(id) || this.hiddenIds.has(id)) continue;
      const title = String(feature.properties?.title ?? id);
      hits.set(id, { id, title, area: this.areaOf(id) });
    }
    return [...hits.values()].sort((a, b) => a.area - b.area);
  }

  /** Extent area in square degrees, from the source data (tiles clip the rendered geometry). */
  private areaOf(recordId: string): number {
    const feature = this.data.features.find((f) => f.properties?.id === recordId);
    if (feature?.geometry.type !== "Polygon") return Infinity;
    const [[w, s], , [e, n]] = feature.geometry.coordinates[0];
    return Math.abs((e - w) * (n - s));
  }

  private openMenu(hits: { id: string; title: string }[], point: { x: number; y: number }): void {
    this.closeMenu();
    this.hideTooltip();
    const menu = document.createElement("div");
    menu.className = "ordt-footprint-menu";
    menu.setAttribute("role", "menu");
    const head = document.createElement("div");
    head.className = "ordt-footprint-menu-head";
    head.textContent = `${hits.length} footprints here, smallest first`;
    menu.append(head);
    for (const hit of hits) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ordt-footprint-menu-item";
      item.setAttribute("role", "menuitem");
      item.textContent = hit.title;
      item.title = hit.title;
      item.addEventListener("mouseenter", () => this.setHover(hit.id));
      item.addEventListener("focus", () => this.setHover(hit.id));
      item.addEventListener("click", () => {
        this.closeMenu();
        this.onSelect(hit.id);
      });
      menu.append(item);
    }
    const container = this.map.getContainer();
    container.append(menu);
    // Keep the menu inside the map: open it left or above the click when needed.
    const x = Math.min(point.x, container.clientWidth - menu.offsetWidth - 4);
    const y = Math.min(point.y, container.clientHeight - menu.offsetHeight - 4);
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    this.menu = menu;
    this.setHover(hits[0].id);
    this.map.on("movestart", this.closeMenu);
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("pointerdown", this.onOutside, true);
  }

  private showTooltip(hits: { title: string }[], point: { x: number; y: number }): void {
    if (!hits.length) return this.hideTooltip();
    if (!this.tooltip) {
      this.tooltip = document.createElement("div");
      this.tooltip.className = "ordt-footprint-tooltip";
      this.map.getContainer().append(this.tooltip);
    }
    const more = hits.length > 1 ? ` (+${hits.length - 1}, click to choose)` : "";
    this.tooltip.textContent = `${hits[0].title}${more}`;
    // Keep it inside the map: near its right or bottom edge (the RNDT panel
    // sits beyond the right one) the tooltip went under the panel. Flip it to
    // the other side of the pointer, as the choice menu does.
    const container = this.map.getContainer();
    const { offsetWidth: w, offsetHeight: h } = this.tooltip;
    const x = point.x + 12 + w > container.clientWidth ? point.x - 12 - w : point.x + 12;
    const y = point.y + 12 + h > container.clientHeight ? point.y - 12 - h : point.y + 12;
    this.tooltip.style.left = `${Math.max(4, x)}px`;
    this.tooltip.style.top = `${Math.max(4, y)}px`;
  }

  private hideTooltip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
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
        layout: { visibility: this.visibility() },
        filter: this.shownFilter(),
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
        layout: { visibility: this.visibility() },
        filter: this.shownFilter(),
        paint: { "line-color": COLOR, "line-width": 1.2, "line-opacity": 0.8 },
      });
    }
    if (!map.getLayer(HOVER_ID)) {
      map.addLayer({
        id: HOVER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { visibility: this.visibility() },
        paint: { "line-color": HOVER_COLOR, "line-width": 3 },
        filter: this.hoverFilter(),
      });
    }
    if (!map.getLayer(SELECTED_ID)) {
      map.addLayer({
        id: SELECTED_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { visibility: this.visibility() },
        paint: { "line-color": COLOR, "line-width": 3.5 },
        filter: this.selectedFilter(),
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
    const ours = LAYER_IDS;
    if (order.slice(-ours.length).join() === ours.join()) return;
    // At most one move per second, so the plugin never fights the host's own
    // layer ordering in a loop of `styledata` events.
    const now = Date.now();
    if (now - this.lastMove < 1000) return;
    this.lastMove = now;
    for (const id of ours) map.moveLayer(id);
  }

  setData(data: FeatureCollection): void {
    this.closeMenu();
    this.hideTooltip();
    this.data = data;
    this.selectedId = null;
    this.hoverId = null;
    this.hiddenIds.clear();
    this.ensure();
    (this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);
    this.applyFilters();
  }

  /** Show or hide all footprints. Showing also brings back those hidden one by one. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.closeMenu();
      this.hideTooltip();
    }
    if (visible && this.hiddenIds.size) {
      this.hiddenIds.clear();
      this.applyFilters();
    }
    for (const id of LAYER_IDS) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", this.visibility());
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Show or hide one record's footprint. */
  setHidden(recordId: string, hidden: boolean): void {
    if (hidden) this.hiddenIds.add(recordId);
    else this.hiddenIds.delete(recordId);
    this.applyFilters();
  }

  isHidden(recordId: string): boolean {
    return this.hiddenIds.has(recordId);
  }

  private visibility(): "visible" | "none" {
    return this.visible ? "visible" : "none";
  }

  /** Features not hidden one by one. */
  private shownFilter(): ExpressionSpecification {
    return ["!", ["in", ["get", "id"], ["literal", [...this.hiddenIds]]]];
  }

  private selectedFilter(): ExpressionSpecification {
    return ["all", ["==", ["get", "id"], this.selectedId ?? ""], this.shownFilter()];
  }

  private hoverFilter(): ExpressionSpecification {
    return ["all", ["==", ["get", "id"], this.hoverId ?? ""], this.shownFilter()];
  }

  /** Highlight one footprint (a result hovered in the list), or none. */
  highlight(recordId: string | null): void {
    if (this.hoverId === recordId) return;
    this.hoverId = recordId;
    if (this.map.getLayer(HOVER_ID)) this.map.setFilter(HOVER_ID, this.hoverFilter());
  }

  /** Map-side hover: highlight and tell the panel. */
  private setHover(recordId: string | null): void {
    if (this.hoverId === recordId) return;
    this.highlight(recordId);
    this.onHover(recordId);
  }

  select(recordId: string | null): void {
    this.selectedId = recordId;
    this.applyFilters();
  }

  private applyFilters(): void {
    const map = this.map;
    if (map.getLayer(FILL_ID)) map.setFilter(FILL_ID, this.shownFilter());
    if (map.getLayer(LINE_ID)) map.setFilter(LINE_ID, this.shownFilter());
    if (map.getLayer(HOVER_ID)) map.setFilter(HOVER_ID, this.hoverFilter());
    if (map.getLayer(SELECTED_ID)) map.setFilter(SELECTED_ID, this.selectedFilter());
  }

  clear(): void {
    this.setData(EMPTY);
  }

  remove(): void {
    const map = this.map;
    this.closeMenu();
    this.hideTooltip();
    map.off("styledata", this.onStyleData);
    map.off("click", FILL_ID, this.onClick);
    map.off("mousemove", FILL_ID, this.onMove);
    map.off("mouseleave", FILL_ID, this.onLeave);
    for (const id of [SELECTED_ID, HOVER_ID, LINE_ID, FILL_ID]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }
}
