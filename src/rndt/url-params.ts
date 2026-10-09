import { INSPIRE_THEME_CODES, SERVICE_TYPES } from "./constants";
import { bboxError, emptyForm, type Bbox, type LinkKind, type SearchForm } from "./query";

/**
 * The query parameters the plugin owns in a GeoLibre link, e.g.
 * `…/?rndt=idrografia&rndtKind=services&rndtTheme=hy`. GeoLibre activates the
 * plugin when one is in the address and hands them to `handleUrlParameters`.
 * Names are case-sensitive and public once a link is shared: do not rename
 * them. Each holds one field of the search form (#30).
 */
export const TEXT_PARAM = "rndt";
export const BBOX_PARAM = "rndtBbox";
/** A layer turned on, repeated once per layer (#44): `<record id>~<wms|arcgis>~<layer name>`. */
export const LAYER_PARAM = "rndtLayer";
/** A box the map fits once, not a search filter (#47): `west,south,east,north`. */
export const VIEW_PARAM = "rndtView";

/** Short, stable names for the values of a few fields, as a link writes them. */
const FIELDS: Record<string, string> = {
  title: "title",
  abstract: "description",
  lineage: "apiso_Lineage_txt",
  limitation: "apiso_AccessConstraints_s",
};
const DATE_FIELDS: Record<string, string> = {
  revision: "apiso_RevisionDate_dt",
  publication: "apiso_PublicationDate_dt",
  creation: "apiso_CreationDate_dt",
  catalogue: "sys_created_dt",
};
const SORTS: Record<string, string> = {
  title: "title:asc",
  "title-desc": "title:desc",
  newest: "apiso_Modified_dt:desc",
  oldest: "apiso_Modified_dt:asc",
};
const LINK_KINDS: LinkKind[] = ["WMS", "WFS", "ArcGIS REST"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One link parameter: how it reads into the form and how the form writes it. */
interface Param {
  name: string;
  /** Applies a non-empty raw value to the form; returns an error to warn about, or null. */
  read: (raw: string, form: SearchForm) => string | null;
  /** The value to write for this form, or "" when the field is at its default. */
  write: (form: SearchForm) => string;
}

const keyOf = (map: Record<string, string>, value: string) =>
  Object.keys(map).find((key) => map[key] === value) ?? "";
const list = (raw: string) =>
  raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const box = (raw: string) => raw.split(/[\s,;]+/).filter(Boolean).map(Number) as Bbox;
const isTrue = (raw: string) => /^(1|true|yes)$/i.test(raw);
const isFalse = (raw: string) => /^(0|false|no)$/i.test(raw);

function mapped(name: string, map: Record<string, string>, field: keyof SearchForm): Param {
  return {
    name,
    read: (raw, form) => {
      const value = map[raw.toLowerCase()];
      if (value === undefined) return `not one of ${Object.keys(map).join(", ")}`;
      (form as unknown as Record<string, unknown>)[field] = value;
      return null;
    },
    write: (form) => keyOf(map, form[field] as string),
  };
}

function flag(name: string, field: "invertOrganisation" | "openDataOnly"): Param {
  return {
    name,
    read: (raw, form) => {
      if (isTrue(raw)) form[field] = true;
      else if (!isFalse(raw)) return "not 1 or 0";
      return null;
    },
    write: (form) => (form[field] ? "1" : ""),
  };
}

function text(name: string, field: "text" | "keywords" | "organisation"): Param {
  return {
    name,
    read: (raw, form) => {
      form[field] = raw;
      return null;
    },
    write: (form) => form[field].trim(),
  };
}

function date(name: string, field: "dateFrom" | "dateTo"): Param {
  return {
    name,
    read: (raw, form) => {
      if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) return "not a yyyy-mm-dd date";
      form[field] = raw;
      return null;
    },
    write: (form) => form[field],
  };
}

const PARAMS: Param[] = [
  text(TEXT_PARAM, "text"),
  {
    name: BBOX_PARAM,
    read: (raw, form) => {
      const bbox = box(raw);
      const error = bboxError(bbox);
      if (error) return error;
      form.bbox = bbox;
      return null;
    },
    write: (form) => (form.bbox ? form.bbox.join(",") : ""),
  },
  {
    name: "rndtWithin",
    read: (raw, form) => {
      if (isTrue(raw)) form.spatialRel = "Within";
      else if (!isFalse(raw)) return "not 1 or 0";
      return null;
    },
    write: (form) => (form.bbox && form.spatialRel === "Within" ? "1" : ""),
  },
  {
    name: "rndtKind",
    read: (raw, form) => {
      const kind = raw.toLowerCase();
      if (kind !== "data" && kind !== "services" && kind !== "all") return "not data, services or all";
      form.kind = kind;
      return null;
    },
    write: (form) => (form.kind === "all" ? "" : form.kind),
  },
  {
    name: "rndtService",
    read: (raw, form) => {
      const known = SERVICE_TYPES.map((option) => option.value);
      const values = list(raw.toLowerCase());
      const unknown = values.filter((value) => !known.includes(value));
      form.serviceTypes = values.filter((value) => known.includes(value));
      return unknown.length ? `unknown ${unknown.join(", ")}` : null;
    },
    write: (form) => form.serviceTypes.join(","),
  },
  {
    name: "rndtAs",
    read: (raw, form) => {
      const values = list(raw);
      const kinds = values
        .map((value) => LINK_KINDS.find((kind) => kind.toLowerCase() === value.toLowerCase() || (kind === "ArcGIS REST" && /^arcgis$/i.test(value))))
        .filter((kind): kind is LinkKind => kind !== undefined);
      form.availableAs = [...new Set(kinds)];
      return kinds.length < values.length ? `not all of ${LINK_KINDS.join(", ")}` : null;
    },
    write: (form) => form.availableAs.join(","),
  },
  {
    name: "rndtMode",
    read: (raw, form) => {
      const mode = raw.toLowerCase();
      if (mode !== "all" && mode !== "any" && mode !== "lucene") return "not all, any or lucene";
      form.textMode = mode;
      return null;
    },
    write: (form) => (form.textMode === "all" ? "" : form.textMode),
  },
  mapped("rndtField", FIELDS, "field"),
  text("rndtKeywords", "keywords"),
  text("rndtOrg", "organisation"),
  flag("rndtOrgNot", "invertOrganisation"),
  {
    name: "rndtTheme",
    read: (raw, form) => {
      // The panel filters on one theme: the first code that is known.
      const codes = list(raw.toLowerCase());
      const label = codes.map((code) => INSPIRE_THEME_CODES[code]).find(Boolean);
      if (!label) return "not an INSPIRE theme code (hy, cp, au, …)";
      form.inspireThemes = [label];
      return codes.length > 1 ? "only the first theme is used" : null;
    },
    write: (form) => keyOf(INSPIRE_THEME_CODES, form.inspireThemes[0] ?? ""),
  },
  flag("rndtOpen", "openDataOnly"),
  {
    name: "rndtDate",
    read: (raw, form) => {
      const value = DATE_FIELDS[raw.toLowerCase()];
      if (value === undefined) return `not one of ${Object.keys(DATE_FIELDS).join(", ")}`;
      form.dateField = value;
      return null;
    },
    // Only worth writing with a range: on its own the date field filters nothing.
    write: (form) =>
      (form.dateFrom || form.dateTo) && form.dateField !== emptyForm().dateField ? keyOf(DATE_FIELDS, form.dateField) : "",
  },
  date("rndtFrom", "dateFrom"),
  date("rndtTo", "dateTo"),
  mapped("rndtSort", SORTS, "sort"),
];

export const URL_PARAMETER_NAMES = [...PARAMS.map((param) => param.name), LAYER_PARAM, VIEW_PARAM];

/** A search asked by a link: the whole form, every field the link leaves out at its default. */
export interface LinkSearch {
  form: SearchForm;
}

/**
 * Read the search a link asks for, or null when it asks for none (`?rndt`
 * with no value only opens the panel). The form starts empty, so the same link
 * gives the same search to everyone. Anyone can write a link: a value that is
 * not valid is left out with a warning, the rest is still searched.
 */
export function linkSearchFrom(params: URLSearchParams): LinkSearch | null {
  const form = emptyForm();
  let asked = false;
  for (const param of PARAMS) {
    const raw = (params.get(param.name) ?? "").trim();
    if (!raw) continue;
    asked = true;
    const error = param.read(raw, form);
    if (error) console.warn(`[openrndt-geolibre] Ignoring ${param.name}=${raw} in the link: ${error}`);
  }
  return asked ? { form } : null;
}

/** The link parameters of a search: one per field that is not at its default, in a fixed order. */
export function paramsFromForm(form: SearchForm): URLSearchParams {
  const params = new URLSearchParams();
  for (const param of PARAMS) {
    const value = param.write(form);
    if (value) params.set(param.name, value);
  }
  return params;
}

/** Where a shared link opens: GeoLibre web, the one address every recipient can open, also from Desktop. */
export const SHARE_BASE_URL = "https://web.geolibre.app/";
/** The registry id `?plugin=` installs; the development copy is not in the registry, so it shares this too. */
const SHARE_PLUGIN_ID = "openrndt-geolibre";

/**
 * The link that gives someone else this search (#31): GeoLibre web with
 * `?plugin=` (it installs the plugin where it is missing, after the trust
 * prompt, on GeoLibre after 3.2.0) and the search's parameters. With a record
 * open the link opens that record, as `?rndt=<id>` does. `view`: the map view,
 * which GeoLibre applies at startup (#44); `layers`: the layers turned on,
 * bottom to top.
 */
export function shareUrl(form: SearchForm, recordId: string | null, view: MapView | null = null, layers: LinkLayer[] = []): string {
  const params = recordId ? new URLSearchParams({ [TEXT_PARAM]: recordId }) : paramsFromForm(form);
  const query = new URLSearchParams({ plugin: SHARE_PLUGIN_ID });
  for (const [name, value] of params) query.set(name, value);
  for (const layer of layers) query.append(LAYER_PARAM, `${layer.recordId}~${layer.kind}~${layer.name}`);
  if (view) {
    query.set("lat", String(Number(view.lat.toFixed(5))));
    query.set("lon", String(Number(view.lon.toFixed(5))));
    query.set("zoom", String(Number(view.zoom.toFixed(2))));
  }
  return `${SHARE_BASE_URL}?${query}`;
}

/** The map view a link opens on, in GeoLibre's own startup parameters (`?lat=&lon=&zoom=`, GeoLibre 3.0). */
export interface MapView {
  lon: number;
  lat: number;
  zoom: number;
}

/**
 * True when the link sets the map view through GeoLibre's `lat` and `lon`
 * (#44): GeoLibre has opened the map there, and the plugin must not move it.
 * Values GeoLibre would reject do not count.
 */
export function linkHasView(params: URLSearchParams): boolean {
  const value = (name: string) => Number(params.get(name)?.trim() || NaN);
  return Math.abs(value("lat")) <= 90 && Math.abs(value("lon")) <= 180;
}

/**
 * The box a link asks the map to fit (#47), or null. Unlike `rndtBbox` it
 * filters nothing. A box that is not valid is left out with a warning.
 */
export function linkViewFrom(params: URLSearchParams): Bbox | null {
  const raw = (params.get(VIEW_PARAM) ?? "").trim();
  if (!raw) return null;
  const bbox = box(raw);
  const error = bboxError(bbox);
  if (!error) return bbox;
  console.warn(`[openrndt-geolibre] Ignoring ${VIEW_PARAM}=${raw} in the link: ${error}`);
  return null;
}

/** A layer of a record a link asks to add (#44): the first service of that kind in the record that lists the name. */
export interface LinkLayer {
  recordId: string;
  kind: "wms" | "arcgis";
  name: string;
}

/**
 * The layers a link asks for, in their order (bottom to top). The first
 * `~wms~` or `~arcgis~` splits the value, so a record id or a layer name may
 * hold a `~`. A value that is not
 * valid is left out with a warning, as for the other parameters.
 */
export function linkLayersFrom(params: URLSearchParams): LinkLayer[] {
  const layers: LinkLayer[] = [];
  for (const raw of params.getAll(LAYER_PARAM)) {
    const match = /^(.+?)~(wms|arcgis)~(.+)$/.exec(raw.trim());
    if (match) layers.push({ recordId: match[1], kind: match[2] as LinkLayer["kind"], name: match[3] });
    else console.warn(`[openrndt-geolibre] Ignoring ${LAYER_PARAM}=${raw} in the link: expected <record id>~<wms|arcgis>~<layer name>.`);
  }
  return layers;
}
