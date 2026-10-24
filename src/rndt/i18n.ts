import { PLUGIN_ID } from "./constants";
import type { RndtHost } from "./host";
import { IT } from "./i18n-it";

/**
 * The panel follows GeoLibre's language (#3): Italian when GeoLibre is in
 * Italian, English otherwise. The Italian catalogue goes to GeoLibre's own
 * translation system (`registerTranslations`, GeoLibre 3.4.0), so app and
 * plugin pick the language the same way; the English text stays in the code,
 * next to each key, and is what a host without translations shows.
 */

/** Keys live under the plugin's id, so the development copy has its own. Read at call time: constants.ts may import this module. */
const prefix = () => `plugin.${PLUGIN_ID}.`;

let host: RndtHost | null = null;
/** GeoLibre keeps registrations for the session: once per host. */
const registered = new WeakSet<object>();

type Params = Record<string, string | number>;

/** Remember the host and give GeoLibre the Italian catalogue. */
export function bindLanguage(app: RndtHost): void {
  host = app;
  if (registered.has(app) || !app.registerTranslations) return;
  registered.add(app);
  app.registerTranslations({ it: Object.fromEntries(Object.entries(IT).map(([key, text]) => [prefix() + key, text])) });
}

const interpolate = (text: string, params?: Params) =>
  params ? text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;

/** The text of `key` in GeoLibre's language, else `english` with `{{name}}` filled in. */
export function tr(key: string, english: string, params?: Params): string {
  return host?.translate?.(prefix() + key, english, params) ?? interpolate(english, params);
}

/**
 * A text with a count, `<key>_one` / `<key>_other` in the catalogue. `count`
 * stays a number for GeoLibre's plural rules; show it formatted through
 * another parameter (`{{n}}`, given here as `fmt(count)`).
 */
export function trCount(key: string, one: string, other: string, count: number, params: Params = {}): string {
  const all = { n: fmt(count), ...params, count };
  const english = count === 1 ? one : other;
  return host?.translate?.(prefix() + key, english, all) ?? interpolate(english, all);
}

/** True when GeoLibre shows Italian (`it`, `it-IT`, …). */
export function isItalian(): boolean {
  return /^it\b/i.test(host?.getLocale?.() ?? "");
}

/** A number as the language writes it: 1,234 or 1.234. */
export function fmt(n: number): string {
  return n.toLocaleString(isItalian() ? "it-IT" : "en");
}

/** Call `listener` after GeoLibre switches language; returns the unsubscribe function. */
export function onLanguageChange(listener: () => void): () => void {
  return host?.onLocaleChange?.(() => listener()) ?? (() => {});
}
