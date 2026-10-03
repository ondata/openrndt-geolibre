import { bboxError, type Bbox } from "./query";

/**
 * The query parameters the plugin owns in a GeoLibre link, e.g.
 * `…/?rndt=idrografia&rndtBbox=12.3,37.5,13.9,38.3`. GeoLibre activates the
 * plugin when one is in the address and hands them to `handleUrlParameters`.
 * Names are case-sensitive.
 */
export const TEXT_PARAM = "rndt";
export const BBOX_PARAM = "rndtBbox";
export const URL_PARAMETER_NAMES = [TEXT_PARAM, BBOX_PARAM];

/** A search asked by a link. */
export interface LinkSearch {
  text: string;
  /** Search area, or null for anywhere. */
  bbox: Bbox | null;
}

/**
 * Read the search a link asks for, or null when it asks for none (`?rndt`
 * with no value only opens the panel). Anyone can write a link: a box that is
 * not valid is left out with a warning, the text is still searched.
 */
export function linkSearchFrom(params: URLSearchParams): LinkSearch | null {
  const text = (params.get(TEXT_PARAM) ?? "").trim();
  let bbox: Bbox | null = null;
  const rawBox = (params.get(BBOX_PARAM) ?? "").trim();
  if (rawBox) {
    const box = rawBox.split(/[\s,;]+/).filter(Boolean).map(Number) as Bbox;
    const error = bboxError(box);
    if (error) console.warn(`[openrndt-geolibre] Ignoring ${BBOX_PARAM}=${rawBox} in the link: ${error}`);
    else bbox = box;
  }
  return text || bbox ? { text, bbox } : null;
}
