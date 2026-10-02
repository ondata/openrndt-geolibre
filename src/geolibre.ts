import type { GeoLibrePlugin, GeoLibreRightPanelRegistration } from "./lib/geolibre/host-api";
import { ITALY_BBOX, PANEL_ID, PLUGIN_ID, PLUGIN_NAME, PLUGIN_VERSION } from "./rndt/constants";
import type { RndtHost } from "./rndt/host";
import { RndtPanel } from "./rndt/panel";
import "./rndt/panel.css";

/**
 * openrndt-geolibre: search the Italian national catalogue of spatial data
 * (RNDT) from a GeoLibre right panel and add its WMS/WFS services to the map.
 *
 * Panel-only plugin: no map control, so GeoLibre shows it as a plain toggle in
 * the Plugins menu (like other catalogue plugins). Toggling it on opens the
 * panel; toggling it off removes the panel and the result footprints.
 */

/** `engines` is part of GeoLibre's plugin contract but not of the template's copy. */
type Plugin = GeoLibrePlugin & { engines?: ("maplibre" | "mapbox" | "cesium" | "arcgis")[] };

let disposePanel: (() => void) | null = null;

export const plugin: Plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  // The footprints layer draws on the MapLibre map directly.
  engines: ["maplibre"],
  activate(app) {
    const host = app as RndtHost;
    if (!host.registerRightPanel) return false;
    const panel = new RndtPanel(host);
    const registration: GeoLibreRightPanelRegistration & { deactivatePluginOnClose?: boolean } = {
      id: PANEL_ID,
      title: "RNDT",
      defaultWidth: 380,
      // The panel is the plugin's whole UI: closing it with X turns the plugin
      // off, so the Plugins menu check mark follows (GeoLibre host option).
      deactivatePluginOnClose: true,
      render: (container) => panel.mount(container),
    };
    const unregister = host.registerRightPanel(registration);
    // A toolbar menu brings the panel back when another plugin panel has
    // taken its place, and clears results.
    const unregisterMenu = host.registerToolbarMenu?.({
      id: `${PLUGIN_ID}-menu`,
      label: "RNDT",
      items: [
        { id: "open", label: "Open search panel", onSelect: () => host.openRightPanel?.(PANEL_ID) },
        { id: "footprints", label: "Hide or show footprints", onSelect: () => panel.toggleFootprints() },
        { id: "clear", label: "Clear results and footprints", onSelect: () => panel.clearResults() },
      ],
    });
    host.openRightPanel?.(PANEL_ID);
    // The catalogue is Italian and the search starts on the current map view:
    // a view that does not touch Italy (GeoLibre opens on North America) moves
    // there. One that does is the user's own and stays.
    const view = host.getViewBounds?.();
    const [west, south, east, north] = ITALY_BBOX;
    let cancelMove = () => {};
    if (view && (view[2] < west || view[0] > east || view[3] < south || view[1] > north)) {
      // The panel narrows the map as it opens: a fit computed on the old width
      // leaves Italy off centre (GeoLibre Desktop 3.2.0). Wait for the map to
      // stop resizing; with a panel already open no resize comes, hence the timer.
      const map = host.getMap?.();
      const move = () => {
        cancelMove();
        host.fitBounds?.(ITALY_BBOX);
      };
      let timer = setTimeout(move, 600);
      const onResize = () => {
        clearTimeout(timer);
        timer = setTimeout(move, 150);
      };
      map?.on("resize", onResize);
      cancelMove = () => {
        clearTimeout(timer);
        map?.off("resize", onResize);
      };
    }
    disposePanel = () => {
      cancelMove();
      unregisterMenu?.();
      host.closeRightPanel?.(PANEL_ID);
      unregister();
      panel.destroy();
    };
  },
  deactivate() {
    disposePanel?.();
    disposePanel = null;
  },
};

export default plugin;
