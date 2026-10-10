/**
 * Search form -> RNDT REST query.
 *
 * Mirrors the portal's "Ricerca Dettagliata" (function `adaptSerialize` on
 * geodati.gov.it), documented in openrndt's
 * `knowledge/api/advanced-search-form.md`. Deliberate differences:
 * - organisation is a case-insensitive "contains" match on `EnteResponsabile_s`
 *   (a regular expression), instead of the portal's exact, case-sensitive
 *   match. `apiso_OrganizationName_txt` (used by openrndt's `--org`) is the
 *   metadata contact, not the responsible party: for "Regione Piemonte" it
 *   misses 249 of 612 records whose contact is CSI Piemonte (2026-09-26);
 * - INSPIRE themes and "open data only" apply to "All" too, not only to "Data";
 * - a date range keeps only records that have the chosen date: there is no
 *   "include empty values" option. Most records carry only one of the three
 *   dates, so with it a range let in about half of the catalogue;
 * - words typed in "all"/"any" mode are escaped, so `:` or `-` cannot break the
 *   query; `*` and `?` stay usable as wildcards. "Lucene" mode passes text as is.
 */

export type ResourceKind = "all" | "data" | "services";
/** Link types a record can offer, whatever its record type. */
export type LinkKind = "WMS" | "WFS" | "ArcGIS REST";
export type TextMode = "all" | "any" | "lucene";
/** Intersects: the record's extent touches the box; Within: it lies entirely inside. */
export type SpatialRel = "Intersects" | "Within";
/** [west, south, east, north] in WGS84 degrees. */
export type Bbox = [number, number, number, number];

export interface SearchForm {
  kind: ResourceKind;
  serviceTypes: string[];
  /** Keep records linking to any of these, datasets and services alike. */
  availableAs: LinkKind[];
  text: string;
  textMode: TextMode;
  /** Field prefix for the free text; "" searches everywhere. */
  field: string;
  /** Comma-separated keywords, matched exactly on `keywords_s`. */
  keywords: string;
  /** Comma-separated organisations, each a case-insensitive "contains" match. */
  organisation: string;
  /** Leave the organisations out instead of keeping only them. */
  invertOrganisation: boolean;
  /** Comma-separated IPA codes of the owner, the prefix of the record id before ":" (#54). */
  ipa: string;
  /** Italian INSPIRE theme labels, as stored in `INSPIRETheme_s`. */
  inspireThemes: string[];
  openDataOnly: boolean;
  dateField: string;
  /** yyyy-mm-dd or "". */
  dateFrom: string;
  dateTo: string;
  /** Search area, or null for anywhere. */
  bbox: Bbox | null;
  spatialRel: SpatialRel;
  sort: string;
}

export interface BuiltQuery {
  q: string | null;
  bbox?: string;
  spatialRel?: SpatialRel;
  sort?: string;
}

export function emptyForm(): SearchForm {
  return {
    kind: "all",
    serviceTypes: [],
    availableAs: [],
    text: "",
    textMode: "all",
    field: "",
    keywords: "",
    organisation: "",
    invertOrganisation: false,
    ipa: "",
    inspireThemes: [],
    openDataOnly: false,
    dateField: "apiso_RevisionDate_dt",
    dateFrom: "",
    dateTo: "",
    bbox: null,
    spatialRel: "Intersects",
    sort: "",
  };
}

const LUCENE_SPECIAL = /[+\-&|!(){}[\]^"~:\\/]/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Escape Lucene syntax in a single word, keeping `*` and `?` wildcards. */
export function escapeTerm(word: string): string {
  return word.replace(LUCENE_SPECIAL, (c) => `\\${c}`);
}

/** Escape a value placed inside a double-quoted Lucene phrase. */
export function escapePhrase(value: string): string {
  return value.replace(/["\\]/g, (c) => `\\${c}`);
}

const REGEX_SPECIAL = /[.?+*|{}[\]()"\\#@&<>~/]/;

/**
 * Lucene regular expression matching `value` anywhere in a keyword field,
 * ignoring case: each letter becomes a `[xX]` class, specials are escaped.
 */
export function containsIgnoreCase(value: string): string {
  const body = Array.from(value.trim())
    .map((c) => {
      const lower = c.toLowerCase();
      const upper = c.toUpperCase();
      if (lower !== upper) return `[${lower}${upper}]`;
      return REGEX_SPECIAL.test(c) ? `\\${c}` : c;
    })
    .join("");
  return `/.*${body}.*/`;
}

/** The non-empty, trimmed items of a comma-separated list. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The organisation names of the Organisation field: comma-separated, as a
 * CSV line, where a name in double quotes keeps its commas (#51): Arpae
 * Emilia-Romagna is "Agenzia Regionale per la Prevenzione, l'Ambiente e
 * l'Energia dell'Emilia Romagna".
 */
export function splitNames(value: string): string[] {
  const names: string[] = [];
  let current = "";
  let quoted = false;
  for (const c of value) {
    if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) {
      names.push(current);
      current = "";
    } else current += c;
  }
  names.push(current);
  return names.map((name) => name.trim()).filter(Boolean);
}

/**
 * Lucene regular expression for record ids starting with an IPA code (#54):
 * the prefix before ":" is the owner's code in the IPA index, written in upper
 * or lower case depending on the record (`PCM`, `r_sardeg` and `R_SARDEG`).
 */
export function ipaPrefix(code: string): string {
  return containsIgnoreCase(code).replace(/^\/\.\*/, "/").replace(/\.\*\/$/, ":.*/");
}

/** The Organisation field for these names: a name with a comma goes in double quotes. */
export function joinNames(names: string[]): string {
  return names.map((name) => (name.includes(",") ? `"${name}"` : name)).join(", ");
}

function quotedOr(values: string[]): string {
  return values.map((v) => `"${escapePhrase(v)}"`).join(" OR ");
}

/** Error message for an invalid box, or null when it is usable. */
export function bboxError(bbox: Bbox): string | null {
  if (bbox.length !== 4 || !bbox.every((v) => Number.isFinite(v))) {
    return "The box needs four numbers: west, south, east, north.";
  }
  const [w, s, e, n] = bbox;
  if (w < -180 || e > 180 || s < -90 || n > 90) {
    return "Longitudes must be within -180..180 and latitudes within -90..90.";
  }
  if (w >= e || s >= n) {
    return "West must be less than east and south less than north.";
  }
  return null;
}

/** Clamp a map view box to valid WGS84 ranges (a zoomed-out view can exceed them). */
export function clampBbox(bbox: Bbox): Bbox {
  const [w, s, e, n] = bbox;
  return [Math.max(w, -180), Math.max(s, -90), Math.min(e, 180), Math.min(n, 90)];
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function textClause(form: SearchForm): string | null {
  const text = form.text.trim();
  if (!text) return null;
  if (form.textMode === "lucene") return `(${text})`;
  // A mark standing alone (the " - " of many titles) would be a term no
  // record holds, and with AND it would find nothing (#46).
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).map(escapeTerm);
  if (!words.length) return null;
  const group = `(${words.join(form.textMode === "any" ? " OR " : " AND ")})`;
  return form.field ? `${form.field}:${group}` : group;
}

function dateClause(form: SearchForm): string | null {
  const from = form.dateFrom.trim();
  const to = form.dateTo.trim();
  if (!from && !to) return null;
  for (const value of [from, to]) {
    if (value && !DATE_RE.test(value)) throw new Error(`Invalid date "${value}": use yyyy-mm-dd.`);
  }
  return `${form.dateField}:[${from || "1900-01-01"} TO ${to || "2100-12-31"}]`;
}

/**
 * Build the REST parameters for a form. Throws on invalid input (bad date or
 * box), so callers can show the message instead of sending a query the
 * catalogue would silently ignore (a malformed bbox returns the whole catalogue).
 */
/**
 * A link to an ArcGIS REST service or layer (`…/rest/services/…/MapServer`,
 * `…/MapServer/3`, with a query string or not), as a Lucene regular
 * expression, which must match the whole link. A wildcard cannot say it: a
 * `/` after the `*` does not parse, and `*MapServer*` also takes the WMS and
 * WMTS under the service. 1,621 records on 2026-10-01.
 */
const ARCGIS_REST_PATTERN = "/http.*\\/rest\\/services\\/.*(Map|Image|Feature)Server(\\/[0-9]+)?\\/?(\\?.*)?/";

export function buildQuery(form: SearchForm): BuiltQuery {
  const clauses: string[] = [];

  const text = textClause(form);
  if (text) clauses.push(text);

  const ipa = splitList(form.ipa).map(ipaPrefix);
  if (ipa.length) clauses.push(`apiso_Identifier_s:${ipa.length === 1 ? ipa[0] : `(${ipa.join(" OR ")})`}`);

  const keywords = splitList(form.keywords);
  if (keywords.length) clauses.push(`keywords_s:(${quotedOr(keywords)})`);

  const organisations = splitNames(form.organisation).map(containsIgnoreCase);
  if (organisations.length) {
    const match = organisations.length === 1 ? organisations[0] : `(${organisations.join(" OR ")})`;
    clauses.push(`${form.invertOrganisation ? "NOT " : ""}EnteResponsabile_s:${match}`);
  }

  if (form.kind !== "services") {
    if (form.inspireThemes.length) clauses.push(`INSPIRETheme_s:(${quotedOr(form.inspireThemes)})`);
    if (form.openDataOnly) clauses.push("_exists_:isOpendata");
  }

  // links_s holds the records' URLs; the "wms"/"wfs" substring matches the
  // plugin's WMS/WFS badges on 99% of a 2,400-record sample (2026-09-27).
  // Wildcards are case-sensitive, so the three spellings in use are listed
  // ("Wms" is ArcGIS's WmsServer: 53 records have no other spelling). The
  // http prefix leaves out relative links such as "/layer_r1/wms?...", which
  // the plugin cannot open (Monte Argentario, San Giovanni Valdarno).
  if (form.availableAs.length) {
    const patterns = form.availableAs.flatMap((kind) => {
      if (kind === "ArcGIS REST") return [ARCGIS_REST_PATTERN];
      const lower = kind.toLowerCase();
      return [lower, kind, `${lower[0].toUpperCase()}${lower.slice(1)}`].map((k) => `http*${k}*`);
    });
    clauses.push(`links_s:(${patterns.join(" OR ")})`);
  }

  const date = dateClause(form);
  if (date) clauses.push(date);

  if (form.kind === "data") {
    clauses.push("apiso_Type_s:(dataset OR series)");
  } else if (form.kind === "services") {
    clauses.push("apiso_Type_s:service");
    if (form.serviceTypes.length) clauses.push(`apiso_ServiceType_s:(${form.serviceTypes.join(" OR ")})`);
  }

  const built: BuiltQuery = { q: clauses.length ? clauses.join(" AND ") : null };

  if (form.bbox) {
    const error = bboxError(form.bbox);
    if (error) throw new Error(error);
    built.bbox = form.bbox.map(round).join(",");
    built.spatialRel = form.spatialRel;
  }
  if (form.sort) built.sort = form.sort;
  return built;
}

/**
 * The text as an RNDT record id, or null. Ids are `<prefix>:<local part>`
 * and can hold more colons (`r_basili:51db0c0e:15171e5a981:-78ae`): all 500
 * of a sample had one, none had a space, quote or bracket (2026-10-01).
 */
export function recordIdIn(text: string): string | null {
  const t = text.trim();
  return /^[^\s:"()]+:[^\s"()]+$/.test(t) ? t : null;
}

/** A form that finds one record by id, whatever the other filters (`id:` finds nothing, `fileid:` does). */
export function idForm(id: string): SearchForm {
  return { ...emptyForm(), textMode: "lucene", text: `fileid:"${escapePhrase(id)}"` };
}

/** REST parameters for a page of results (JSON format), in request order. */
function searchParams(form: SearchForm, start: number, num: number): [string, string][] {
  const built = buildQuery(form);
  const params: [string, string][] = [];
  if (built.q) params.push(["q", built.q]);
  if (built.bbox) params.push(["bbox", built.bbox]);
  if (built.spatialRel) params.push(["spatialRel", built.spatialRel]);
  if (built.sort) params.push(["sort", built.sort]);
  params.push(["start", String(start)], ["num", String(num)], ["f", "json"]);
  return params;
}

function searchEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/rest/metadata/search`;
}

/** Full search URL for a page of results (JSON format). */
export function buildSearchUrl(baseUrl: string, form: SearchForm, start: number, num: number): string {
  return `${searchEndpoint(baseUrl)}?${new URLSearchParams(searchParams(form, start, num)).toString()}`;
}

/** Single-quote a value for a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * A `curl` command that sends the same request as {@link buildSearchUrl}, for
 * a POSIX shell. Values go through `--data-urlencode`, so the Lucene query
 * stays readable instead of percent-encoded.
 */
export function buildCurlCommand(baseUrl: string, form: SearchForm, start: number, num: number): string {
  const lines = [`curl -sG ${shellQuote(searchEndpoint(baseUrl))}`];
  for (const [key, value] of searchParams(form, start, num)) {
    lines.push(`--data-urlencode ${shellQuote(`${key}=${value}`)}`);
  }
  return lines.join(" \\\n  ");
}
