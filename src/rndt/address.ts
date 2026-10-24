import type { RndtHost } from "./host";
import type { RndtPanel } from "./panel";
import { shareUrl, URL_PARAMETER_NAMES } from "./url-params";

/** GeoLibre's startup view, which the address carries with the search. */
const VIEW_PARAMS = ["lat", "lon", "zoom"];

/**
 * The address with the plugin's parameters replaced by `ours`, or removed when
 * `ours` is null (#61). The other parameters (`?url=` of a project, other
 * plugins', `plugin=`) stay as they are.
 */
export function addressWith(href: string, ours: URLSearchParams | null): string {
  const url = new URL(href);
  for (const name of URL_PARAMETER_NAMES) url.searchParams.delete(name);
  if (ours) {
    for (const name of VIEW_PARAMS) url.searchParams.delete(name);
    for (const [name, value] of ours) url.searchParams.append(name, value);
  }
  // Commas are valid in a query string: `rndtBbox=6,36,19,47` reads better than `6%2C36…`.
  return url.toString().replace(/%2C/g, ",");
}

/**
 * Keep the browser's address on the search shown, as Share writes it but
 * without the layers (their check is too costly at every map move) and
 * without `plugin=` (#61). GeoLibre has no API for it, so the plugin replaces
 * the history entry itself: Back is unchanged. Returns the function that stops
 * it and takes the parameters out again.
 */
export function syncAddress(panel: RndtPanel, app: RndtHost): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = (fromPanel: boolean) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const state = panel.projectState();
      // No search yet (or one from a link still running) leaves the address
      // alone; results cleared by the user take ours out.
      if (!state && !fromPanel) return;
      let ours: URLSearchParams | null = null;
      if (state) {
        const map = app.getMap?.();
        const center = map?.getCenter().wrap();
        const view = map && center ? { lon: center.lng, lat: center.lat, zoom: map.getZoom() } : null;
        ours = new URL(shareUrl(state.form, state.recordId, view)).searchParams;
        ours.delete("plugin");
      }
      const next = addressWith(location.href, ours);
      if (next !== location.href) history.replaceState(history.state, "", next);
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
    history.replaceState(history.state, "", addressWith(location.href, null));
  };
}
