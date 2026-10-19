/**
 * Tools for GeoLibre's AI Assistant (#58). The assistant drives the panel, it
 * does not replace it: a search runs in the panel as one typed by hand, and the
 * tool hands the model the page the user sees. Only metadata goes to the
 * model: records, names, counts, outcomes; never the data of a layer.
 *
 * The search input uses the words of a link (`rndtTheme=hy`, `rndtSort=newest`):
 * one vocabulary, read by `readSearchParams`.
 */
import { filterRows } from "./agent-text";
import { ARCGIS_KIND } from "./arcgis";
import { PAGE_SIZE } from "./constants";
import type { AssistantToolSpec } from "./host";
import type { PressOutcome, SearchOutcome } from "./panel";
import { bboxError, type Bbox, type SearchForm } from "./query";
import type { RndtRecord } from "./records";
import { BBOX_PARAM, readSearchParams, TEXT_PARAM } from "./url-params";

/** Where the search looks: the map view (the panel's default), anywhere, or a box. */
export type SearchArea = "view" | "anywhere" | "box";

export interface AssistantSearch {
  form: SearchForm;
  area: SearchArea;
  /** 1-based index of the first record of the page. */
  start: number;
}

/** Tool input name → link parameter. */
const INPUT_PARAMS: Record<string, string> = {
  text: TEXT_PARAM,
  textMode: "rndtMode",
  field: "rndtField",
  kind: "rndtKind",
  serviceTypes: "rndtService",
  availableAs: "rndtAs",
  keywords: "rndtKeywords",
  ipa: "rndtIpa",
  organisation: "rndtOrg",
  excludeOrganisation: "rndtOrgNot",
  theme: "rndtTheme",
  openDataOnly: "rndtOpen",
  dateField: "rndtDate",
  dateFrom: "rndtFrom",
  dateTo: "rndtTo",
  sort: "rndtSort",
  within: "rndtWithin",
};

export const SEARCH_TOOL_NAME = "search";

export const SEARCH_TOOL_DESCRIPTION =
  "Search RNDT, the Italian national catalogue of geospatial metadata, in the openrndt-geolibre panel. " +
  "The search runs in the panel as one typed by hand: the user sees the list and the footprints on the map. " +
  "Returns the page shown (20 records): id, title, organisation, record date, extent and services (WMS, WFS, ArcGIS REST, downloads) of each record, " +
  "the total, and nextStart for the next page. Catalogue content is in Italian: search in Italian.";

export const SEARCH_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", description: "Free text, in Italian. Words are in AND. A record id (prefix:uuid) opens that record." },
    textMode: { type: "string", enum: ["all", "any", "lucene"], description: "all (default, words in AND), any (OR), lucene (passed as is; there a space is OR, write AND)." },
    field: { type: "string", enum: ["title", "abstract", "lineage", "limitation"], description: "Restrict the text to one field; default anywhere." },
    area: {
      description: 'Where: "view" (the current map view, default), "anywhere", or a box [west, south, east, north] in WGS84. Records match when their extent touches it; national records always do.',
      oneOf: [
        { type: "string", enum: ["view", "anywhere"] },
        { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
      ],
    },
    within: { type: "boolean", description: "Keep only records whose extent is entirely inside the area." },
    kind: { type: "string", enum: ["all", "data", "services"], description: "Records of datasets and series, of services, or both (default)." },
    serviceTypes: { type: "array", items: { type: "string", enum: ["view", "download", "discovery", "transformation", "invoke", "other"] }, description: "With kind services only." },
    availableAs: { type: "array", items: { type: "string", enum: ["WMS", "WFS", "ArcGIS"] }, description: "Keep records linking to any of these services." },
    keywords: { type: "string", description: "Comma-separated keywords, matched exactly." },
    ipa: { type: "string", description: "IPA code(s) of the owner, comma-separated (r_lombar, age, ispra_rm): the strongest organisation filter, it finds every spelling of the name." },
    organisation: { type: "string", description: 'Organisation name, case-insensitive "contains"; comma-separated names in OR. Acronyms do not match: write the name in full.' },
    excludeOrganisation: { type: "boolean", description: "Leave the organisations out instead of keeping only them." },
    theme: { type: "string", description: "INSPIRE theme code: hy (hydrography), cp (cadastral parcels), au (administrative units), lc (land cover), lu (land use), oi (orthoimagery), ps (protected sites), nz (natural risk zones), tn (transport networks), ge (geology)…" },
    openDataOnly: { type: "boolean", description: "Records whose publisher filled in the open data field (a declaration, not a check)." },
    dateField: { type: "string", enum: ["revision", "publication", "creation", "catalogue", "modified"], description: "Date the range applies to; default revision. modified is the record's date, not the data's." },
    dateFrom: { type: "string", description: "yyyy-mm-dd" },
    dateTo: { type: "string", description: "yyyy-mm-dd" },
    sort: { type: "string", enum: ["title", "title-desc", "newest", "oldest"], description: "Default relevance. newest/oldest are on the record's date." },
    start: { type: "integer", minimum: 1, description: "First record of the page, 1-based; use nextStart of a previous result." },
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The tool input as a search; throws an error the model can act on. */
export function parseSearchInput(input: unknown): AssistantSearch {
  const fields = input ?? {};
  if (!isObject(fields)) throw new Error("The input must be an object.");
  const params = new URLSearchParams();
  let area: SearchArea = "view";
  let start = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (key === "area") {
      if (value === "view" || value === "anywhere") area = value;
      else if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number")) {
        const error = bboxError(value as Bbox);
        if (error) throw new Error(`area: ${error}`);
        params.set(BBOX_PARAM, value.join(","));
        area = "box";
      } else throw new Error('area: "view", "anywhere" or [west, south, east, north].');
      continue;
    }
    if (key === "start") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error("start: an integer from 1.");
      start = value;
      continue;
    }
    const name = INPUT_PARAMS[key];
    if (!name) throw new Error(`Unknown field ${key}.`);
    if (typeof value === "boolean") params.set(name, value ? "1" : "0");
    else if (typeof value === "string") params.set(name, value);
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) params.set(name, value.join(","));
    else throw new Error(`${key}: not a valid value.`);
  }
  const { form, errors } = readSearchParams(params);
  if (errors.length) {
    const field = (name: string) => Object.keys(INPUT_PARAMS).find((key) => INPUT_PARAMS[key] === name) ?? "area";
    throw new Error(errors.map((e) => `${field(e.name)}: ${e.error}`).join("; "));
  }
  return { form, area, start };
}

/** Longest abstract handed to the model: enough to tell records apart. */
const ABSTRACT_LENGTH = 300;

/** A service kind of a record in the words of the tools: `ArcGIS`, as `open_record` shows it. */
const toolKindName = (kind: string) => (kind === ARCGIS_KIND ? "ArcGIS" : kind);

/** Kinds `open_record` and `add_layers` work with; the others (downloads, WCS…) are listed for reference. */
const ADDABLE_KINDS = ["WMS", "WFS", "ArcGIS"];

/**
 * The page the panel shows, as the tool's result: metadata only, with `next`
 * (what the agent can call now, with the arguments) and `notes` (how to read
 * this result), as a command line tool made for an LLM says in its output.
 */
export function searchResult(page: { form: SearchForm; total: number; start: number; records: RndtRecord[] }, pageSize: number, area: SearchArea) {
  const { form, total, start, records } = page;
  const end = start + records.length - 1;
  const nextStart = end < total ? start + pageSize : null;
  const next: string[] = [];
  const notes: string[] = [];
  if (total === 0) {
    next.push("No records. Widen one filter at a time and search again:");
    if (area !== "anywhere") next.push('- area: "anywhere" (the search was limited to ' + (area === "view" ? "the map view" : "a box") + ")");
    if (form.textMode === "all" && form.text.trim().split(/\s+/).length > 1) next.push('- fewer words, or textMode: "any" (words are in AND)');
    if (form.organisation.trim()) next.push("- organisation: an acronym does not match; a municipality often does not publish itself, its data come under the region or the metropolitan city; try ipa, or the place name in text");
    // Measured 2026-10-19: 23,905 records, 20,735 with an INSPIRE theme, 16,825 with the open data field.
    if (form.inspireThemes.length) next.push("- drop theme: 13% of the records declare no INSPIRE theme");
    if (form.openDataOnly) next.push("- drop openDataOnly: 30% of the records leave the open data field empty, open data included");
    if (form.dateFrom || form.dateTo) next.push("- drop dateFrom/dateTo, or change dateField");
    if (form.availableAs.length) next.push("- drop availableAs");
  } else {
    if (records.some((r) => r.services.some((s) => ADDABLE_KINDS.includes(toolKindName(s.kind))))) {
      next.push("To put a record's data on the map: call open_record with its recordId, then add_layers with the service number and layer names it returns.");
    }
    if (nextStart) next.push(`More records: call search with the same input and start: ${nextStart}.`);
    if (total > 100) next.push("Many records: narrow with theme, ipa, availableAs, kind: \"data\", or a smaller area.");
  }
  if (area === "view") notes.push('Area: the current map view (bbox in filters). Records match when their extent touches it, so national records always do; area "anywhere" searches all of Italy, a box another place.');
  if (records.some((r) => !r.services.length)) notes.push("Records with an empty services list link nothing the plugin can add; their page tells how the data are distributed.");
  if (records.length > 1) notes.push("recordDate is the date of the record, not of the data. Several records may describe the same data (years, editions): prefer the newest, or sort: \"newest\".");
  notes.push("The user sees this same page in the RNDT panel, with the footprints on the map: refer to records by title, and give their id when useful.");
  return {
    total,
    start,
    end: records.length ? end : null,
    nextStart,
    filters: filterRows(form),
    records: records.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      organisation: r.organisation,
      recordDate: r.modified,
      abstract: r.abstract.length > ABSTRACT_LENGTH ? `${r.abstract.slice(0, ABSTRACT_LENGTH)}…` : r.abstract,
      bbox: r.bbox,
      services: r.services.map(({ kind, url }) => ({ kind: toolKindName(kind), url })),
      page: r.htmlUrl,
    })),
    next,
    notes,
  };
}

/** A layer row of the detail view, as the panel shows it. */
export interface ShownLayer {
  name: string;
  title: string;
  ticked: boolean;
  onMap?: true;
  /** Why it cannot be ticked, in the panel's words. */
  disabled?: string;
  note?: string;
}

/** A service of the open record, as the detail view shows it. */
export interface ShownService {
  /** 1-based position in the view: what add_layers takes. */
  service: number;
  kind: string;
  url: string;
  layers: ShownLayer[];
  /** Rows left out past the cap: narrow with `filter`. */
  more?: number;
  /** Buttons of the service, as labelled on screen. */
  buttons: string[];
  /** Messages shown in the service box (errors, notes). */
  messages: string[];
  /** Still loading when the wait ended. */
  loading?: true;
}

/**
 * Longest a tool waits for the panel. GeoLibre gives plugin tools no cancel
 * signal, so the assistant's Stop waits for a running tool: past this, a tool
 * returns what the panel shows, and the panel goes on by itself. A server that
 * does not answer takes about 20 s in the panel (8 s over https, 8 s over http).
 */
export const TOOL_WAIT_MS = 10_000;

/** Most layer rows read per service: some WMS list hundreds. */
export const MAX_TOOL_LAYERS = 200;

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** True while a box of the view still says it is reading or checking. */
export function detailLoading(detail: HTMLElement): boolean {
  return !!detail.querySelector('.ordt-service-area > [data-kind="busy"]');
}

/** The services of the open record as the screen shows them; rows filtered on name or title, capped. */
export function readDetail(detail: HTMLElement, filter = ""): ShownService[] {
  const needle = filter.trim().toLowerCase();
  return Array.from(detail.querySelectorAll<HTMLElement>("li.ordt-service"), (li, i) => {
    const area = li.querySelector<HTMLElement>(".ordt-service-area");
    const rows = Array.from(li.querySelectorAll<HTMLElement>("label.ordt-layer"), (row): ShownLayer => {
      const input = row.querySelector<HTMLInputElement>("input")!;
      const reason = text(row.querySelector(".ordt-layer-reason")) || (input.disabled ? text(row.querySelector(".ordt-layer-note")) || row.title : "");
      const note = input.disabled ? "" : text(row.querySelector(".ordt-layer-note"));
      return {
        name: input.value,
        title: text(row.querySelector(".ordt-layer-title")),
        ticked: input.checked,
        ...(row.querySelector(".ordt-layer-tag") && { onMap: true as const }),
        ...(input.disabled && { disabled: reason || "cannot be ticked" }),
        ...(note && { note }),
      };
    });
    const kept = needle ? rows.filter((l) => `${l.name} ${l.title}`.toLowerCase().includes(needle)) : rows;
    return {
      service: i + 1,
      kind: toolKindName(text(li.querySelector(".ordt-badge-service"))),
      url: li.querySelector<HTMLElement>(".ordt-host")?.title ?? "",
      layers: kept.slice(0, MAX_TOOL_LAYERS),
      ...(kept.length > MAX_TOOL_LAYERS && { more: kept.length - MAX_TOOL_LAYERS }),
      buttons: Array.from(li.querySelectorAll<HTMLButtonElement>(".ordt-service-area button.ordt-button, .ordt-service-actions button.ordt-button"), (b) => text(b)),
      messages: Array.from(area?.querySelectorAll<HTMLElement>("p.ordt-note:not([hidden])") ?? [], (p) => text(p)).filter(Boolean),
      ...(area && detailLoading(li) && { loading: true as const }),
    };
  });
}

export interface AssistantOpen {
  recordId: string;
  filter: string;
}

export const OPEN_TOOL_NAME = "open_record";

export const OPEN_TOOL_DESCRIPTION =
  "Open an RNDT record in the openrndt-geolibre panel, as a click on its title: the detail view reads each service (WMS, WFS, ArcGIS) and lists its layers. " +
  "Returns what the view shows: per service its number, kind, layers (name, title, ticked, already on the map, or why it cannot be ticked), buttons and messages. " +
  "Use it after search, then add_layers with the service number and layer names.";

export const OPEN_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["recordId"],
  properties: {
    recordId: { type: "string", description: "Record id from search (prefix:uuid)." },
    filter: { type: "string", description: "Return only layers whose name or title contains this text (case-insensitive); the panel still shows all." },
  },
};

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function checkKeys(input: Record<string, unknown>, keys: string[]): void {
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new Error(`Unknown field ${key}.`);
}

export function parseOpenInput(input: unknown): AssistantOpen {
  if (!isObject(input)) throw new Error("The input must be an object with recordId.");
  checkKeys(input, ["recordId", "filter"]);
  if (!isText(input.recordId)) throw new Error("recordId: the id of a record, from search.");
  if (input.filter != null && typeof input.filter !== "string") throw new Error("filter: a text.");
  return { recordId: input.recordId.trim(), filter: input.filter ?? "" };
}

/** The open record as the tool's result, with `next` and `notes` for the agent. */
export function openResult(recordId: string, title: string, services: ShownService[]) {
  const next: string[] = [];
  const notes: string[] = [];
  const tickable = services.flatMap((s) => s.layers.filter((l) => !l.disabled).map((l) => ({ ...l, s })));
  const addable = tickable.filter((l) => l.s.buttons.some((b) => /^(Add to map|Select a layer|Add features)/.test(b)));
  if (addable.length) {
    const drawn = (l: (typeof addable)[number]) => l.s.buttons.some((b) => /^(Add to map|Select a layer)/.test(b));
    const loaded = (l: (typeof addable)[number]) => l.s.buttons.some((b) => /^Add features/.test(b));
    const pick = (ok: (l: (typeof addable)[number]) => boolean) => addable.find((l) => ok(l) && l.ticked) ?? addable.find(ok);
    const map = pick(drawn);
    const data = pick(loaded);
    if (map) next.push(`To show it: call add_layers with recordId "${recordId}", service ${map.s.service}, layers ["${map.name}"], as "map".`);
    if (data) next.push(`For the data: move the map to the record's area, then call add_layers with recordId "${recordId}", service ${data.s.service}, layers ["${data.name}"], as "features".`);
    if (addable.some((l) => l.ticked)) notes.push("ticked is what the panel preselects: the layer the record names, or whose title matches the record's; usually the one wanted.");
  } else if (!services.some((s) => s.loading)) {
    next.push("Nothing of this record can be added from the panel: try another record of the search, or give the user the record's page.");
  }
  if (services.some((s) => s.loading)) {
    next.push("Some services are still loading: their server is slow or does not answer (the panel tries for about 20 s). Tell the user; call open_record again in a while, or pick a record of another server. Do not open other records of the same server meanwhile.");
  }
  if (services.some((s) => s.messages.some((m) => /cannot reach|does not exist/.test(m)))) {
    next.push("A server does not answer: tell the user. Other records on the same server will likely fail too: prefer records of another publisher.");
  }
  if (services.some((s) => s.more)) next.push("Some layers are not listed (more): call open_record again with filter.");
  if (services.some((s) => s.buttons.some((b) => /^Add features/.test(b)))) {
    notes.push('as "features" downloads the data into the project, only in the current map view (the panel\'s default); above 10,000 features the panel asks the user.');
  }
  if (services.some((s) => s.buttons.some((b) => /^(Add to map|Select a layer)/.test(b)))) {
    notes.push('as "map" adds a layer the server draws: nothing is downloaded, and it shows only where the server has data.');
  }
  if (!services.length) notes.push("The record lists no service.");
  notes.push("messages are the panel's own: an error there is what the user sees too.");
  return { recordId, title, services, next, notes };
}

export interface AssistantAdd {
  recordId: string;
  service: number;
  layers: string[];
  as: "map" | "features";
}

export const ADD_TOOL_NAME = "add_layers";

export const ADD_TOOL_DESCRIPTION =
  "Add layers of an RNDT record to the map through the openrndt-geolibre panel, as by hand: in the record's detail view it ticks the given layers of one service and presses Add to map (as map) or Add features (as features). " +
  "Returns the panel's message. With features above 10,000 the panel asks the user, and the result says it waits for that choice. Call open_record first for service numbers and names.";

export const ADD_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["recordId", "service", "layers"],
  properties: {
    recordId: { type: "string", description: "Record id." },
    service: { type: "integer", minimum: 1, description: "Service number, from open_record." },
    layers: { type: "array", items: { type: "string" }, minItems: 1, description: "Layer names (not titles), from open_record. One only with features." },
    as: { type: "string", enum: ["map", "features"], description: "map (default): drawn by the server; features: data downloaded into the project." },
  },
};

export function parseAddInput(input: unknown): AssistantAdd {
  if (!isObject(input)) throw new Error("The input must be an object with recordId, service and layers.");
  checkKeys(input, ["recordId", "service", "layers", "as"]);
  if (!isText(input.recordId)) throw new Error("recordId: the id of a record, from search.");
  if (typeof input.service !== "number" || !Number.isInteger(input.service) || input.service < 1) throw new Error("service: the service number from open_record.");
  if (!Array.isArray(input.layers) || !input.layers.length || !input.layers.every(isText)) throw new Error("layers: one or more layer names from open_record.");
  const as = input.as ?? "map";
  if (as !== "map" && as !== "features") throw new Error('as: "map" or "features".');
  if (as === "features" && input.layers.length > 1) throw new Error("layers: one layer at a time with features.");
  return { recordId: input.recordId.trim(), service: input.service, layers: input.layers as string[], as };
}

export const CHOOSE_TOOL_NAME = "choose";

export const CHOOSE_TOOL_DESCRIPTION =
  "Answer the question the openrndt-geolibre panel is asking the user (above 10,000 features: Download all, First 10,000 only, Cancel), when the user answers in the chat: it presses that choice's button, as a click on it. Returns the panel's message that follows.";

export const CHOOSE_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["choice"],
  properties: {
    choice: { type: "string", description: "The label of one choice exactly as add_layers listed it, e.g. \"First 10,000 only\"." },
  },
};

export function parseChooseInput(input: unknown): string {
  if (!isObject(input)) throw new Error("The input must be an object with choice.");
  checkKeys(input, ["choice"]);
  if (!isText(input.choice)) throw new Error("choice: the label of one choice, as add_layers listed it.");
  return input.choice;
}

/** What add_layers or choose did, with `next` for the agent. */
export function addResult(outcome: PressOutcome) {
  const next = {
    done: "Tell the user what was added; the layer is in GeoLibre's Layers panel. More layers: call add_layers again.",
    error: "Tell the user the panel's message; try another layer, service or record.",
    waiting: "The panel asks the user to choose (choices): tell them. When they answer in the chat, call choose with their choice; they may also click it in the panel. Do not call add_layers again for this layer.",
    running: "The download still runs in the panel: tell the user, its message appears there when done.",
  }[outcome.status];
  return { ...outcome, next: [next] };
}

/** Text added to the assistant's system prompt while the plugin is on: when and how to use the tools. */
export const ASSISTANT_GUIDANCE = `openrndt-geolibre: the RNDT panel searches RNDT, the Italian national catalogue of geospatial metadata (about 24,000 records of Italian public bodies), and adds its WMS, WFS and ArcGIS services to the map.

Your job with its tools is to turn what the user asks into the panel's form and gestures: the tools fill the search form, open a record, tick and add layers as the user would by hand, and the user watches the panel. Do not answer from memory about what RNDT holds: search. Use them for Italian geographic data (cadastre, hydrography, land use, hazards, geology, orthophotos, protected sites, monumental trees, transport, boundaries), not for data outside Italy.

Order: search, open_record with a record id, add_layers with the service number and layer names. Follow next and notes in each result.

Searching:
- start with text and area only; add theme, availableAs, ipa, organisation or dates only when the user asks, or when next says there are too many records. Filters are in AND: river network of Tuscany, text and box give 95 records; adding theme hy, availableAs WMS and ipa r_toscan gives 0.
- text in Italian, few words: "alberi monumentali".
- a place the user names always goes in area, as a coarse box [west, south, east, north] you know for it, never a street; not in text, not as the region's ipa. Parcels in Bari: theme cp, ipa age and Bari's box give 13 records; without the box, 7,693.
- without area the search uses the current map view; area "anywhere" is all of Italy. National records always match an area.
- ipa or organisation only when the user names who publishes, never on your own: ipa with the IPA code (r_lombar, r_toscan, age Agenzia delle Entrate, ispra_rm ISPRA), else organisation with the full name, not an acronym. A region's code keeps only its own records: monumental trees in Lombardy's box 17, with r_lombar 2. A municipality often publishes through the region or metropolitan city.
- theme with an INSPIRE code (hy, cp, lu, lc, nz, oi orthoimagery, ps protected sites) when the user names the theme or to narrow a long list. When a theme covers the request, leave the text out: text matches the catalogue's words, not the user's (Bari: "particelle catastali" with cp gives 0, records say "Cartografia catastale").
- no records: widen one filter at a time as next says; tell the user what you tried.
- same data in several records (years, editions): prefer the newest recordDate, or ask.
- the panel shows your last search: when you answer from an earlier one, run it again last.

Adding:
- as "map" (WMS, ArcGIS images): the server draws it, nothing downloaded. Use it to show or see data.
- as "features" (WFS, ArcGIS): the data are downloaded into the project, one layer at a time, only those in the current map view. Use it when the user asks for the data: "scarica", "come dati", "vettoriale", "le geometrie", "gli attributi". First move the map to the record's area (zoom_to its bbox).
- above 10,000 features the panel asks the user: say so, do not repeat add_layers; when the user answers in the chat ("primi 10.000", "tutto", "annulla"), call choose with the matching label.
- report the panel's messages as they are.
- a slow or dead server (loading, "cannot reach"): tell the user and move to another server's records; each try costs about 20 s and the user cannot stop a running tool.

The data never reach you: only records, layer names, counts and messages. Name records by title, with their id when useful.`;

/** The panel's side of the tools: what each gesture does on screen. */
export interface AssistantPanel {
  runSearch(search: AssistantSearch): Promise<SearchOutcome>;
  openRecord(recordId: string): Promise<{ detail: HTMLElement; record: RndtRecord } | { error: string }>;
  addFromRecord(input: AssistantAdd): Promise<PressOutcome | { error: string }>;
  choose(choice: string): Promise<PressOutcome | { error: string }>;
}

/** The host's registration calls (GeoLibre 3.0 and 3.1), as the activation scope gives them. */
export interface AssistantHost {
  registerAssistantToolSpec?: (spec: AssistantToolSpec) => () => void;
  registerAssistantGuidance?: (text: string) => () => void;
}

/**
 * Register the tools and the guidance while the plugin is on; returns the
 * call that removes them. A host without the API gets nothing: the panel
 * works as before. GeoLibre scopes each one to the plugin and removes them
 * when it turns the plugin off.
 */
export function registerAssistantTools(host: AssistantHost, panel: AssistantPanel): () => void {
  if (!host.registerAssistantToolSpec) return () => {};
  const fail = (outcome: { error: string } | null): never => {
    throw new Error(outcome ? outcome.error : "A newer search replaced this one in the panel.");
  };
  const disposers = [
    host.registerAssistantToolSpec({
      name: SEARCH_TOOL_NAME,
      description: SEARCH_TOOL_DESCRIPTION,
      inputSchema: SEARCH_TOOL_SCHEMA,
      callback: async (input) => {
        const search = parseSearchInput(input);
        const outcome = await panel.runSearch(search);
        if (!outcome || "error" in outcome) return fail(outcome);
        return searchResult(outcome, PAGE_SIZE, search.area);
      },
    }),
    host.registerAssistantToolSpec({
      name: OPEN_TOOL_NAME,
      description: OPEN_TOOL_DESCRIPTION,
      inputSchema: OPEN_TOOL_SCHEMA,
      callback: async (input) => {
        const { recordId, filter } = parseOpenInput(input);
        const opened = await panel.openRecord(recordId);
        if ("error" in opened) return fail(opened);
        return openResult(opened.record.id, opened.record.title, readDetail(opened.detail, filter));
      },
    }),
    host.registerAssistantToolSpec({
      name: ADD_TOOL_NAME,
      description: ADD_TOOL_DESCRIPTION,
      inputSchema: ADD_TOOL_SCHEMA,
      callback: async (input) => {
        const outcome = await panel.addFromRecord(parseAddInput(input));
        if ("error" in outcome) return fail(outcome);
        return addResult(outcome);
      },
    }),
    host.registerAssistantToolSpec({
      name: CHOOSE_TOOL_NAME,
      description: CHOOSE_TOOL_DESCRIPTION,
      inputSchema: CHOOSE_TOOL_SCHEMA,
      callback: async (input) => {
        const outcome = await panel.choose(parseChooseInput(input));
        if ("error" in outcome) return fail(outcome);
        return addResult(outcome);
      },
    }),
    host.registerAssistantGuidance?.(ASSISTANT_GUIDANCE) ?? (() => {}),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
