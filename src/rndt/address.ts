import type { RndtHost } from "./host";
import type { RndtPanel } from "./panel";
import { SHARE_PLUGIN_ID, shareUrl, URL_PARAMETER_NAMES } from "./url-params";

/** GeoLibre's startup view, which the address carries with the search. */
const VIEW_PARAMS = ["lat", "lon", "zoom"];

/**
 * The address with the plugin's parameters replaced by `ours`, or removed when
 * `ours` is null (#61), together with `plugin=openrndt-geolibre` (#63). The
 * other parameters (`?url=` of a project, other plugins') stay as they are.
 */
export function addressWith(href: string, ours: URLSearchParams | null): string {
  const url = new URL(href);
  for (const name of URL_PARAMETER_NAMES) url.searchParams.delete(name);
  if (url.searchParams.get("plugin") === SHARE_PLUGIN_ID) url.searchParams.delete("plugin");
  if (ours) {
    for (const name of VIEW_PARAMS) url.searchParams.delete(name);
    for (const [name, value] of ours) url.searchParams.append(name, value);
  }
  // Commas are valid in a query string: `rndtBbox=6,36,19,47` reads better than `6%2C36…`.
  return url.toString().replace(/%2C/g, ",");
}

/** The address with `plugin=openrndt-geolibre`, which `setUrlParameters` cannot write: a copied address turns the plugin on (#63). */
export function addressWithPlugin(href: string): string {
  const url = new URL(href);
  if (url.searchParams.get("plugin") === SHARE_PLUGIN_ID) return href;
  url.searchParams.set("plugin", SHARE_PLUGIN_ID);
  return url.toString().replace(/%2C/g, ",");
}

/**
 * Keep the browser's address on the search shown, as Share writes it but
 * without the layers (their check is too costly at every map move) (#61), so
 * the address can be copied as it is. GeoLibre 3.5.0 writes the plugin's own
 * parameters through `setUrlParameters` and keeps `lat`, `lon`, `zoom` on the
 * map itself (#63); on older hosts the plugin replaces the history entry
 * itself: Back is unchanged. Returns the function that stops it and takes the
 * parameters out again.
 */
export function syncAddress(panel: RndtPanel, app: RndtHost): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const replace = (next: string) => {
    if (next !== location.href) history.replaceState(history.state, "", next);
  };
  const write = (fromPanel: boolean) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const state = panel.projectState();
      // No search yet (or one from a link still running) leaves the address
      // alone; results cleared by the user take ours out.
      if (!state && !fromPanel) return;
      if (app.setUrlParameters) {
        const ours = state ? new URL(shareUrl(state.form, state.recordId)).searchParams : new URLSearchParams();
        app.setUrlParameters(new URLSearchParams([...ours].filter(([name]) => URL_PARAMETER_NAMES.includes(name))));
        replace(addressWithPlugin(location.href));
        return;
      }
      let ours: URLSearchParams | null = null;
      if (state) {
        const map = app.getMap?.();
        const center = map?.getCenter().wrap();
        const view = map && center ? { lon: center.lng, lat: center.lat, zoom: map.getZoom() } : null;
        ours = new URL(shareUrl(state.form, state.recordId, view)).searchParams;
      }
      replace(ours ? addressWith(location.href, ours) : addressWithPlugin(addressWith(location.href, null)));
    }, 500);
  };
  const onPanel = () => write(true);
  const onMove = () => write(false);
  panel.onStateChange = onPanel;
  const map = app.getMap?.();
  map?.on("moveend", onMove);
  write(false);
  return () => {
    clearTimeout(timer);
    if (panel.onStateChange === onPanel) panel.onStateChange = null;
    map?.off("moveend", onMove);
    replace(addressWith(location.href, null));
  };
}
