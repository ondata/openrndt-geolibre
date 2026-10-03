import type { GeoLibrePlugin, GeoLibreRightPanelRegistration } from "./lib/geolibre/host-api";
import { ITALY_BBOX, PANEL_ID, PLUGIN_ID, PLUGIN_LABEL, PLUGIN_NAME, PLUGIN_VERSION } from "./rndt/constants";
import type { RndtHost } from "./rndt/host";
import { RndtPanel } from "./rndt/panel";
import { parsePanelState, type PanelState } from "./rndt/project-state";
import type { Bbox } from "./rndt/query";
import { linkSearchFrom, URL_PARAMETER_NAMES } from "./rndt/url-params";
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
type Plugin = GeoLibrePlugin & {
  engines?: ("maplibre" | "mapbox" | "cesium" | "arcgis")[];
  restoresPanelCollapseState?: boolean;
  clearsStateOnProjectLoad?: boolean;
};

let disposePanel: (() => void) | null = null;
/** The active panel, and the map move that waits for it to open. */
let activePanel: RndtPanel | null = null;
let fitWhenSettled: ((bbox: Bbox) => void) | null = null;
/** The search of a project, given before the plugin is turned on. */
let savedState: PanelState | null = null;
/** The link already followed: GeoLibre gives its parameters again at every project it opens. */
let followedLink: string | null = null;

export const plugin: Plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  // The footprints layer draws on the MapLibre map directly.
  engines: ["maplibre"],
  // `?rndt=<text>` and `?rndtBbox=<west,south,east,north>` in a GeoLibre link.
  urlParameterNames: URL_PARAMETER_NAMES,
  // GeoLibre folds the panels opened while a project loads; this one holds the
  // search the project saved, so it stays open.
  restoresPanelCollapseState: true,
  // The search is data of the project: one that carries none empties the
  // panel, or the search of the project before would be saved into it.
  clearsStateOnProjectLoad: true,
  activate(app) {
    const host = app as RndtHost;
    if (!host.registerRightPanel) return false;
    const panel = new RndtPanel(host);
    const registration: GeoLibreRightPanelRegistration & { deactivatePluginOnClose?: boolean } = {
      id: PANEL_ID,
      title: PLUGIN_LABEL,
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
      label: PLUGIN_LABEL,
      items: [
        { id: "open", label: "Open search panel", onSelect: () => host.openRightPanel?.(PANEL_ID) },
        { id: "footprints", label: "Hide or show footprints", onSelect: () => panel.toggleFootprints() },
        { id: "clear", label: "Clear results and footprints", onSelect: () => panel.clearResults() },
      ],
    });
    host.openRightPanel?.(PANEL_ID);
    // The catalogue is Italian and the search starts on the current map view:
    // a view that is not on Italy (GeoLibre opens on North America) moves
    // there. One that is on it is the user's own and stays: its centre falls
    // in Italy's box and it is under 45° wide. Touching Italy is not enough:
    // the opening globe has bounds -180..180 and shows America.
    const view = host.getViewBounds?.();
    const [west, south, east, north] = ITALY_BBOX;
    const onItaly =
      view &&
      view[2] - view[0] < 45 &&
      (view[0] + view[2]) / 2 >= west &&
      (view[0] + view[2]) / 2 <= east &&
      (view[1] + view[3]) / 2 >= south &&
      (view[1] + view[3]) / 2 <= north;
    // The panel narrows the map as it opens: a fit computed on the old width
    // leaves the area off centre (GeoLibre Desktop 3.2.0). Wait for the map to
    // stop resizing; with a panel already open no resize comes, hence the timer.
    let cancelMove = () => {};
    const fit = (bbox: Bbox) => {
      cancelMove();
      const map = host.getMap?.();
      const move = () => {
        cancelMove();
        host.fitBounds?.(bbox);
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
    };
    if (view && !onItaly) fit(ITALY_BBOX);
    activePanel = panel;
    fitWhenSettled = fit;
    if (savedState) panel.restore(savedState);
    savedState = null;
    disposePanel = () => {
      cancelMove();
      unregisterMenu?.();
      host.closeRightPanel?.(PANEL_ID);
      unregister();
      panel.destroy();
      activePanel = null;
      fitWhenSettled = null;
    };
  },
  handleUrlParameters(_app, params) {
    const link = linkSearchFrom(params);
    if (!link || !activePanel) return;
    // A link opens the app on a search, once: a project opened later brings
    // its own search, or none.
    const key = JSON.stringify(link);
    if (key === followedLink) return;
    followedLink = key;
    // The link's box replaces the move to Italy made at activation.
    if (link.bbox) fitWhenSettled?.(link.bbox);
    activePanel.searchFromLink(link);
  },
  // The last search travels with the project (`plugins.settings`): saved in
  // the web version, it comes back in Desktop, where every service can be read.
  getProjectState() {
    return (activePanel ? activePanel.projectState() : savedState) ?? undefined;
  },
  applyProjectState(_app, state) {
    if (state === undefined) {
      savedState = null;
      activePanel?.reset();
      return;
    }
    const parsed = parsePanelState(state);
    if (!parsed) return false;
    // GeoLibre restores the state before it turns the plugin on.
    if (activePanel) activePanel.restore(parsed);
    else savedState = parsed;
  },
  deactivate() {
    disposePanel?.();
    disposePanel = null;
  },
};

export default plugin;
