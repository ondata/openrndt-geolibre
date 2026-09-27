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
 * - words typed in "all"/"any" mode are escaped, so `:` or `-` cannot break the
 *   query; `*` and `?` stay usable as wildcards. "Lucene" mode passes text as is.
 */

export type ResourceKind = "all" | "data" | "services";
export type TextMode = "all" | "any" | "lucene";
/** [west, south, east, north] in WGS84 degrees. */
export type Bbox = [number, number, number, number];

export interface SearchForm {
  kind: ResourceKind;
  serviceTypes: string[];
  text: string;
  textMode: TextMode;
  /** Field prefix for the free text; "" searches everywhere. */
  field: string;
  /** Comma-separated keywords, matched exactly on `keywords_s`. */
  keywords: string;
  organisation: string;
  /** Italian INSPIRE theme labels, as stored in `INSPIRETheme_s`. */
  inspireThemes: string[];
  openDataOnly: boolean;
  dateField: string;
  /** yyyy-mm-dd or "". */
  dateFrom: string;
  dateTo: string;
  /** Keep records that have no value in `dateField`. */
  includeMissingDates: boolean;
  /** Intersecting box, or null for anywhere. */
  bbox: Bbox | null;
  sort: string;
}

export interface BuiltQuery {
  q: string | null;
  bbox?: string;
  spatialRel?: "Intersects";
  sort?: string;
}

export function emptyForm(): SearchForm {
  return {
    kind: "all",
    serviceTypes: [],
    text: "",
    textMode: "all",
    field: "",
    keywords: "",
    organisation: "",
    inspireThemes: [],
    openDataOnly: false,
    dateField: "apiso_RevisionDate_dt",
    dateFrom: "",
    dateTo: "",
    includeMissingDates: true,
    bbox: null,
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
  const words = text.split(/\s+/).filter(Boolean).map(escapeTerm);
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
  const range = `${form.dateField}:[${from || "1900-01-01"} TO ${to || "2100-12-31"}]`;
  return form.includeMissingDates ? `(${range} OR (NOT _exists_:${form.dateField}))` : range;
}

/**
 * Build the REST parameters for a form. Throws on invalid input (bad date or
 * box), so callers can show the message instead of sending a query the
 * catalogue would silently ignore (a malformed bbox returns the whole catalogue).
 */
export function buildQuery(form: SearchForm): BuiltQuery {
  const clauses: string[] = [];

  const text = textClause(form);
  if (text) clauses.push(text);

  const keywords = form.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length) clauses.push(`keywords_s:(${quotedOr(keywords)})`);

  const organisation = form.organisation.trim();
  if (organisation) clauses.push(`EnteResponsabile_s:${containsIgnoreCase(organisation)}`);

  if (form.kind !== "services") {
    if (form.inspireThemes.length) clauses.push(`INSPIRETheme_s:(${quotedOr(form.inspireThemes)})`);
    if (form.openDataOnly) clauses.push("_exists_:isOpendata");
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
    built.spatialRel = "Intersects";
  }
  if (form.sort) built.sort = form.sort;
  return built;
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
