import type { FeatureCollection } from "geojson";
import {
  DATE_FIELDS,
  INSPIRE_THEMES,
  PAGE_SIZE,
  RNDT_BASE_URL,
  SEARCH_FIELDS,
  SERVICE_TYPES,
  SORT_OPTIONS,
  WFS_MAX_FEATURES,
  type Option,
} from "./constants";
import { FootprintsLayer } from "./footprints-layer";
import { browserNeedsHttp, drawnBbox, fetchJson, fetchText, fetchTextFrom, GEO_EDITOR_PLUGIN_ID, type RndtHost } from "./host";
import {
  bestMatchingLayer,
  buildGetFeatureUrl,
  buildHitsUrl,
  parseHitsCount,
  capabilitiesUrl,
  fixAxisOrder,
  parseWfsCapabilities,
  parseWmsCapabilities,
  pickJsonFormat,
  preselectedName,
  serviceBaseUrl,
  supportsWebMercator,
  upgradeToHttps,
  type WfsCapabilities,
} from "./ogc";
import { bboxError, buildCurlCommand, buildSearchUrl, clampBbox, emptyForm, type Bbox, type ResourceKind, type LinkKind, type SearchForm, type SpatialRel, type TextMode } from "./query";
import { footprints, parseSearchResponse, type RndtRecord, type RndtService } from "./records";
import {
  appendErrorLog,
  clearErrorLog,
  errorLogJsonl,
  loadSettings,
  readErrorLog,
  saveSettings,
  type Settings,
} from "./settings";
import {
  findTitle,
  lookupLayerTitleByCode,
  lookupLayerTitles,
  lookupOneLayerTitle,
  readableTitle,
} from "./layer-names";

type Child = Node | string | null | undefined | false;
type Where = "anywhere" | "view" | "drawn" | "box";

/** Minimal DOM builder: `on*` props become listeners, the rest are properties or attributes. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "className" || key === "textContent" || key === "value" || key === "checked" || key === "disabled" || key === "selected") {
      (el as unknown as Record<string, unknown>)[key] = value;
      // form.reset() goes back to the defaults, not to the current state.
      if (key === "checked") (el as unknown as HTMLInputElement).defaultChecked = value === true;
      if (key === "selected") (el as unknown as HTMLOptionElement).defaultSelected = value === true;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

function select(options: Option[], value: string, props: Record<string, unknown> = {}): HTMLSelectElement {
  return h(
    "select",
    { className: "ordt-input", ...props },
    ...options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)),
  );
}

function radioGroup(name: string, options: Option[], value: string, onChange: () => void, className = "ordt-radios"): HTMLElement {
  return h(
    "div",
    { className, role: "radiogroup" },
    ...options.map((o) =>
      h(
        "label",
        { className: "ordt-radio" },
        h("input", { type: "radio", name, value: o.value, checked: o.value === value, onchange: onChange }),
        o.label,
      ),
    ),
  );
}

function checkedValue(root: HTMLElement, name: string): string {
  return root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? "";
}

/** Show a question with one button per choice inside `container`; resolves with the chosen value. */
function askChoice(container: HTMLElement, message: string, choices: Option[]): Promise<string> {
  return new Promise((resolve) => {
    container.dataset.kind = "info";
    container.replaceChildren(
      message,
      h(
        "span",
        { className: "ordt-row ordt-choices" },
        ...choices.map((c) =>
          h("button", { className: "ordt-button", type: "button", onclick: () => resolve(c.value) }, c.label),
        ),
      ),
    );
  });
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFeatureCollection(value: unknown): value is FeatureCollection {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; features?: unknown };
  return v.type === "FeatureCollection" && Array.isArray(v.features);
}

function isGeoJsonUrl(url: string): boolean {
  return /\.(geo)?json(\?|#|$)/i.test(url) || /[?&](f|format|outputformat)=[^&]*json/i.test(url);
}

/** A service as shown in the panel: OGC links to the same endpoint are merged. */
interface ServiceGroup extends RndtService {
  /** Layer or feature type named by any of the merged links. */
  layerHint: string | null;
}

/**
 * Records often list the same WMS/WFS twice (a GetCapabilities link and a
 * GetMap/GetFeature link naming the layer). Merge them by endpoint and keep the
 * layer name as a hint for preselection.
 */
export function groupServices(services: RndtService[]): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  for (const service of services) {
    let key = service.url;
    if (["WMS", "WFS", "WCS", "WMTS"].includes(service.kind)) {
      try {
        // The scheme is left out: a record may declare the same endpoint as
        // http:// and https:// (Emilia-Romagna WMS, 2026-09-27). A final
        // /ows, /wms, /wfs... is one GeoServer endpoint: Liguria records list
        // both geoserver/M1440/ows?service=WMS and geoserver/M1440/wms.
        const base = serviceBaseUrl(service.url).replace(/^https?:\/\//i, "").toLowerCase();
        key = `${service.kind} ${base.replace(/\/(?:ows|wms|wfs|wcs|wmts)(?=$|\?)/, "/ows")}`;
      } catch {
        // Not a parseable URL: keep it on its own.
      }
    }
    const hint = preselectedName(service.url);
    const existing = groups.get(key);
    if (existing) {
      existing.layerHint ??= hint;
      if (/^http:/i.test(existing.url) && /^https:/i.test(service.url)) existing.url = service.url;
    } else {
      groups.set(key, { ...service, layerHint: hint });
    }
  }
  return Array.from(groups.values());
}

/** "3 layers", "1 layer". */
function layerCount(n: number): string {
  return `${n.toLocaleString("en")} ${n === 1 ? "layer" : "layers"}`;
}

/** Scroll a layer list to its first ticked row: the preselected layer may be far down. */
function showTicked(list: HTMLElement): void {
  const row = list.querySelector("input:checked")?.closest<HTMLElement>(".ordt-layer");
  if (row) list.scrollTop = row.offsetTop - 4;
}

/** Layers that can be ticked. */
function enabledCount(layers: { name: string }[], disabledReason: (name: string) => string | null): number {
  return layers.filter((l) => !disabledReason(l.name)).length;
}

/** RNDT contact, from the footer of geodati.gov.it (AgID). */
const RNDT_EMAIL = "info@rndt.gov.it";

/**
 * A report on a service that failed to load, with what is needed to check it:
 * record, service, error, time (UTC). It is addressed to the record's point of
 * contact, who runs the service, with RNDT in copy; to RNDT alone when the
 * record names no contact. In Italian, the language of the catalogue.
 */
export function errorReport(
  record: RndtRecord,
  service: RndtService,
  error: string,
  now = new Date(),
): { to: string[]; cc: string[]; subject: string; body: string } {
  const toContact = record.contactEmails.length > 0;
  const intro = toContact
    ? `vi scrivo come referenti del servizio ${service.kind} indicato in una scheda del Repertorio Nazionale dei Dati Territoriali (RNDT). Ho provato ad aggiungerlo a una mappa (GeoLibre Desktop, plugin openrndt-geolibre), ma il caricamento ha dato errore. Metto in copia il RNDT.`
    : `vi ringrazio per il catalogo RNDT. Ho provato ad aggiungere a una mappa un servizio ${service.kind} indicato in una scheda del catalogo (GeoLibre Desktop, plugin openrndt-geolibre), ma il caricamento ha dato errore.`;
  return {
    to: toContact ? record.contactEmails : [RNDT_EMAIL],
    cc: toContact ? [RNDT_EMAIL] : [],
    subject: `Errore nel caricamento del servizio ${service.kind} - ${record.title}`,
    body: [
      "Buongiorno,",
      "",
      intro,
      "",
      `Scheda: ${record.title}`,
      `Identificativo: ${record.id}`,
      `Pagina della scheda: ${record.htmlUrl}`,
      ...(record.organisation ? [`Ente: ${record.organisation}`] : []),
      `Servizio: ${service.url}`,
      `Errore: ${error}`,
      `Data e ora (UTC): ${now.toISOString().slice(0, 16).replace("T", " ")}`,
      "",
      "Vi segnalo il problema nel caso sia utile per verificare il servizio o la scheda.",
      "",
      "Grazie e buon lavoro",
    ].join("\n"),
  };
}

/** The report as text to paste into a new email: recipients and subject first. */
export function errorReportText(report: ReturnType<typeof errorReport>): string {
  return [
    `A: ${report.to.join(", ")}`,
    ...(report.cc.length ? [`Cc: ${report.cc.join(", ")}`] : []),
    `Oggetto: ${report.subject}`,
    "",
    report.body,
  ].join("\n");
}

/** Layers above which the layer menu gets a filter field (Veneto WFS: 1,068). */
const FILTER_THRESHOLD = 30;

const LINK_KINDS: LinkKind[] = ["WMS", "WFS"];
const KIND_OPTIONS: Option[] = [
  { value: "all", label: "All" },
  { value: "data", label: "Data" },
  { value: "services", label: "Services" },
];
const TEXT_MODES: Option[] = [
  { value: "all", label: "All words" },
  { value: "any", label: "Any word" },
  { value: "lucene", label: "Lucene" },
];

/** A help example: clicking it fills text, mode and field, then searches. */
interface SearchExample {
  mode: TextMode;
  text: string;
  /** "Search in" value; "" is Anywhere. */
  field?: string;
  note: string;
}

const SEARCH_EXAMPLES: SearchExample[] = [
  {
    mode: "all",
    text: "catastale comune misiliscemi",
    note: "every word must appear",
  },
  {
    mode: "any",
    text: "idrografia fiumi",
    note: "one word is enough: more results",
  },
  { mode: "lucene", text: '"comune di misiliscemi"', note: "exact phrase" },
  { mode: "lucene", text: "catastale AND NOT comune", note: "exclude a word" },
  {
    mode: "lucene",
    text: 'catastale AND NOT EnteResponsabile_s:"Agenzia delle Entrate"',
    note: "leave out an organisation (from about 8,100 records to about 440); the name must be exact, case included",
  },
  { mode: "all", text: "misilis*", note: "* truncates a word, in every mode" },
];

/** One entry per "Search in" option, same order as SEARCH_FIELDS. */
const FIELD_EXAMPLES: SearchExample[] = [
  { mode: "all", text: "ortofoto", field: "", note: "the whole record" },
  { mode: "all", text: "ortofoto", field: "title", note: "the title only" },
  {
    mode: "all",
    text: "ortofoto",
    field: "description",
    note: "the abstract, the description of the resource",
  },
  {
    mode: "all",
    text: "ortofoto",
    field: "apiso_Lineage_txt",
    note: "how the data were produced: sources, methods, processing",
  },
  {
    mode: "all",
    text: "*CC*",
    field: "apiso_AccessConstraints_s",
    note: "conditions of use and access, e.g. the licence. The statement is stored as one exact, case-sensitive value: a plain word matches only if it is the whole statement, so surround words with *",
  },
];

/** One entry per "Where" option, same order as WHERE_OPTIONS (defined below). */
const WHERE_HELP: { value: Where; note: string; box?: string }[] = [
  { value: "anywhere", note: "no area filter, the whole catalogue" },
  {
    value: "view",
    note: "the part of the map visible when you press Search; moving the map afterwards does not search again",
  },
  {
    value: "drawn",
    note: "the rectangle around all the shapes drawn with GeoEditor, not their exact outline; a single point becomes a square of about 100 m. Choosing it turns GeoEditor on",
  },
  {
    value: "box",
    note: "four numbers in degrees (WGS84): west, south, east, north. Example, the province of Palermo:",
    box: "12.95, 37.60, 14.30, 38.30",
  },
];

/** A "?" button that shows and hides `box`, an inline help panel. */
/** Shortcuts under the date range: days back from today. */
const DATE_PRESETS: [string, number][] = [
  ["Last week", 7],
  ["Last month", 30],
  ["Last year", 365],
];

/** yyyy-mm-dd in local time (`toISOString` would give the UTC day). */
function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function helpToggle(box: HTMLElement, label: string): HTMLButtonElement {
  const button = h(
    "button",
    {
      className: "ordt-help-toggle",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": box.id,
      "aria-label": label,
      title: label,
      onclick: () => {
        box.hidden = !box.hidden;
        button.setAttribute("aria-expanded", String(!box.hidden));
      },
    },
    "?",
  );
  return button;
}

/** An inline help panel, hidden until its "?" is pressed. */
function helpBox(id: string, ...children: (Node | string)[]): HTMLElement {
  return h("div", { className: "ordt-help", id, hidden: true }, ...children);
}

/** A ⋯ button with its menu; picking an item closes the menu. */
function menuWrap(menu: HTMLElement, label: string): HTMLElement {
  const button = h(
    "button",
    {
      className: "ordt-button ordt-menu-button",
      type: "button",
      "aria-label": label,
      title: label,
      "aria-haspopup": "menu",
      onclick: () => (menu.hidden = !menu.hidden),
    },
    "⋯",
  );
  menu.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button")) menu.hidden = true;
  });
  return h("span", { className: "ordt-menu-wrap" }, button, menu);
}

/**
 * "Copy error report": the desktop app opens no mailto: link, so the report
 * goes to the clipboard, with the recipients also shown beside the button.
 */
function reportControl(record: RndtRecord, service: RndtService, error: string): HTMLElement {
  const report = errorReport(record, service, error);
  const label = "Copy error report";
  const button = h(
    "button",
    { className: "ordt-link ordt-report", type: "button", title: "Copy recipients, subject and text of an email about this error" },
    label,
  );
  button.addEventListener("click", () => {
    void navigator.clipboard?.writeText(errorReportText(report)).then(
      () => {
        button.textContent = "Copied: paste it into a new email";
        setTimeout(() => (button.textContent = label), 3000);
      },
      () => undefined,
    );
  });
  const to = report.cc.length ? `to ${report.to.join(", ")}, RNDT in copy` : `to ${report.to.join(", ")}`;
  return h("span", { className: "ordt-report-wrap" }, button, " ", h("span", { className: "ordt-muted" }, `(${to})`));
}

/** A titled part of "Search help": the panel inside is always shown there. */
function helpSection(title: string, box: HTMLElement): HTMLElement {
  box.hidden = false;
  return h("section", { className: "ordt-help-section" }, h("h3", {}, title), box);
}

/** A help panel made of plain paragraphs. */
function textHelp(id: string, paragraphs: string[]): HTMLElement {
  return helpBox(id, ...paragraphs.map((text) => h("p", {}, text)));
}

/** A "Label: explanation" list item, as in the "Where" help. */
function termItem(term: string, note: string): HTMLElement {
  return h("li", {}, h("strong", {}, term), `: ${note}`);
}

/*
 * Figures in the help texts were measured on geodati.gov.it on 2026-09-27
 * (23,831 records) and rounded, so they stay true as the catalogue grows.
 */
const RESOURCES_HELP: [string, string][] = [
  ["All", "data and services"],
  ["Data", "records describing datasets and dataset series, about 20,700"],
  [
    "Services",
    "records describing a web service (WMS, WFS, ATOM and others), about 3,200; a menu lets you pick the service type. INSPIRE theme and Open data only do not apply to services",
  ],
];

const RESOURCES_NOTE =
  "This is the type of the record, not what you can do with it: a dataset record often links to a WMS or WFS too. The cadastral maps are about 7,700 dataset records, each with a WMS and a WFS, while the national cadastral service is a single service record. To find what you can add to the map, use Available as.";

const AVAILABLE_AS_HELP = [
  "Keeps the records that link to a WMS or WFS, the services this plugin can add to the map, whatever the record type. With both boxes ticked, one of the two is enough: idrografia finds about 1,130 records, 590 of them with a WMS or WFS.",
  "The check looks for wms or wfs in the link address, so it matches the WMS and WFS badges of the results in about 99 cases out of 100.",
];

const THEME_HELP = [
  "One of the 34 INSPIRE themes, as declared by the publisher. Almost every dataset has one; services have none, so with Services this filter is ignored.",
];

const KEYWORDS_HELP = [
  "Keywords as the publisher wrote them. The match is exact and case-sensitive: opendata finds thousands of records, OpenData only a few.",
  "Separate several keywords with commas: a record needs just one of them.",
];

const ORGANISATION_HELP = [
  "The owner of the resource, with its name as in the IPA index of public administrations, not the metadata contact. Part of the name is enough and case does not matter: piemonte finds Regione Piemonte.",
  "Data are listed under whoever published them: data commissioned by a municipality but published by its Region appear under the Region.",
  "Separate several organisations with commas. Hide these hides them instead: entrate hides Agenzia delle Entrate, which alone publishes about a third of the catalogue (its municipal cadastral maps).",
  "In the results, the ⋯ menu of a record keeps only its organisation or hides it.",
];

const OPEN_DATA_HELP = [
  "Records whose publisher filled in the open data field. It is a declaration, not a check: the field may hold a licence (CC BY 4.0), just the words open data, or even a non-commercial licence.",
  "Records that state an open licence only in another field are left out. Ignored with Services.",
];

const DATE_HELP: [string, string][] = [
  ["Revision", "the last update of the resource"],
  ["Publication", "when the resource was published"],
  ["Creation", "when the resource was produced"],
  [
    "Added to catalogue",
    "when the record entered the RNDT catalogue, not a date of the resource. Every record has it, but 23,342 records carry 25 April 2026, when the catalogue was loaded in bulk: it tells new records only after that day",
  ],
];

const SORT_HELP: [string, string][] = [
  ["Relevance", "the records that best match the words searched come first"],
  ["Title", "alphabetical order"],
  [
    "Metadata date",
    "when the record was last updated in the catalogue. It is not one of the dates of the Date filter",
  ],
];

const SORT_NOTE =
  "The catalogue cannot sort by the resource dates (revision, publication, creation): it ignores that request.";
/** The search bar's text box and button join the form through this id. */
const FORM_ID = "ordt-search-form";

const WHERE_OPTIONS: Option[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "view", label: "Current map view" },
  { value: "drawn", label: "Drawn shapes (GeoEditor)" },
  { value: "box", label: "Box (west, south, east, north)" },
];
const ORG_MODES: Option[] = [
  { value: "only", label: "Show only these" },
  { value: "hide", label: "Hide these" },
];
const SPATIAL_RELS: Option[] = [
  { value: "Intersects", label: "Touches the area" },
  { value: "Within", label: "Inside the area" },
];

/**
 * The RNDT search panel. Renders into the container GeoLibre hands to
 * `registerRightPanel`, owns the footprints layer and talks to the host API.
 */
export class RndtPanel {
  private root: HTMLElement | undefined;
  private formEl!: HTMLFormElement;
  private statusEl!: HTMLElement;
  private listEl!: HTMLElement;
  private pagerEl!: HTMLElement;
  /** The same pager above the list (#12), so the next page needs no scrolling. */
  private pagerTopEl!: HTMLElement;
  /** Text box and Search button, kept at the top while the panel scrolls. */
  private searchBarEl!: HTMLElement;
  /** One line with the filters of the last search, shown while the form is folded. */
  private summaryEl!: HTMLElement;
  private summaryTextEl!: HTMLElement;
  private summaryToggleEl!: HTMLButtonElement;
  private chipsEl!: HTMLElement;
  private clearAllEl!: HTMLButtonElement;
  /** Number of active advanced filters, next to "Advanced filters". */
  private advancedCountEl!: HTMLElement;
  /** "Search help": the help of the fields that have no "?" of their own. */
  private helpEl!: HTMLElement;
  /** Pager, curl, sort and the ⋯ menu, kept below the search bar. */
  private resultsHeadEl!: HTMLElement;
  private resultActionsEl!: HTMLElement;
  private sortEl!: HTMLSelectElement;
  private zoomRowEl!: HTMLElement;
  private helpToggleEl!: HTMLButtonElement;
  private footerEl!: HTMLElement;
  /** "Settings": per-user options, stored on this computer only. */
  private settingsEl!: HTMLElement;
  private settingsToggleEl!: HTMLButtonElement;
  private logCountEl!: HTMLElement;
  private settings: Settings = loadSettings();
  private footprintsLayer: FootprintsLayer | null = null;
  private records: RndtRecord[] = [];
  private total = 0;
  private start = 1;
  /** The record shown in the detail view, or null while the list is shown. */
  private detailId: string | null = null;
  private detailEl!: HTMLElement;
  private requestSeq = 0;
  private lastForm: SearchForm | null = null;
  /** Gives each layer list its own radio group name. */
  private layerListSeq = 0;
  private copyQueryEl!: HTMLButtonElement;
  private footprintsToggleEl!: HTMLButtonElement;

  constructor(private readonly app: RndtHost) {}

  /**
   * Render into the host container. GeoLibre calls `render` every time the
   * panel becomes active and empties the container on close, so the same DOM
   * (form, results) is reused: closing and reopening keeps the state.
   */
  mount(container: HTMLElement): () => void {
    if (!this.root) {
      this.root = h("div", { className: "ordt-panel" });
      this.formEl = this.buildForm();
      this.searchBarEl = this.buildSearchBar();
      this.summaryEl = this.buildSummary();
      this.statusEl = h("div", { className: "ordt-status", role: "status", "aria-live": "polite" });
      this.listEl = h("ol", { className: "ordt-results" });
      this.pagerEl = h("div", { className: "ordt-pager" });
      this.pagerTopEl = h("div", { className: "ordt-pager ordt-pager-top" }, this.statusEl);
      this.resultsHeadEl = this.buildResultsHead();
      this.settingsEl = this.buildSettings();
      this.detailEl = h("section", { className: "ordt-detail-view", hidden: true, "aria-label": "Record details" });
      this.footerEl = this.buildFooter();
      this.root.append(
        this.searchBarEl,
        this.formEl,
        this.helpEl,
        this.settingsEl,
        this.summaryEl,
        this.resultsHeadEl,
        this.listEl,
        this.pagerEl,
        this.detailEl,
        this.footerEl,
      );
      // The desktop app keeps target="_blank" links in an in-app window: hand
      // them to the system browser when the host can.
      this.root.addEventListener("click", (event) => {
        const link = (event.target as HTMLElement).closest?.<HTMLAnchorElement>('a[target="_blank"]');
        if (!link || !this.app.openExternalUrl || !/^https?:/i.test(link.href)) return;
        event.preventDefault();
        this.app.openExternalUrl(link.href);
      });
      // A click anywhere else closes the open ⋯ menus.
      this.root.addEventListener("click", (event) => {
        for (const menu of this.root!.querySelectorAll<HTMLElement>(".ordt-menu:not([hidden])")) {
          if (!menu.parentElement!.contains(event.target as Node)) menu.hidden = true;
        }
      });
      this.trackStickyHeights();
      this.setStatus("Search the Italian national catalogue of spatial data (RNDT).");
    }
    container.append(this.root);
    return () => this.root?.remove();
  }

  /** Remove the panel DOM and the footprints (plugin deactivation). */
  destroy(): void {
    this.requestSeq++;
    this.footprintsLayer?.remove();
    this.footprintsLayer = null;
    this.root?.remove();
    this.root = undefined;
  }

  /**
   * The footprints overlay, created on first use: at startup a project can
   * reactivate the plugin before the map exists.
   */
  private footprintsOverlay(): FootprintsLayer | null {
    if (!this.footprintsLayer) {
      const map = this.app.getMap?.();
      if (map) {
        this.footprintsLayer = new FootprintsLayer(
          map,
          (id) => this.openDetail(id),
          (id) => this.markHovered(id),
        );
      }
    }
    return this.footprintsLayer;
  }

  // ---------------------------------------------------------------- form

  /**
   * Put an organisation in the Organisation filter and search again, keeping
   * the other filters. "More filters" opens so the active filter is visible.
   */
  private filterByOrganisation(name: string): void {
    this.field<HTMLInputElement>("organisation").value = name;
    this.setOrgMode("only");
    this.syncClearButtons();
    this.formEl.querySelector<HTMLDetailsElement>(".ordt-more")!.open = true;
    this.formEl.requestSubmit();
  }

  /** "Show only these" or "Hide these" under Organisation. */
  private setOrgMode(mode: "only" | "hide"): void {
    this.formEl.querySelector<HTMLInputElement>(`input[name="orgMode"][value="${mode}"]`)!.checked = true;
  }

  /** Hide an organisation (Organisation + Hide these) and search again. */
  private excludeOrganisation(name: string): void {
    const input = this.field<HTMLInputElement>("organisation");
    // Already hiding: add to the list. Keeping some: switch to hiding this one.
    const names = checkedValue(this.formEl, "orgMode") === "hide" ? input.value.split(",").map((n) => n.trim()).filter(Boolean) : [];
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    input.value = names.join(", ");
    this.setOrgMode("hide");
    this.syncClearButtons();
    this.formEl.querySelector<HTMLDetailsElement>(".ordt-more")!.open = true;
    this.formEl.requestSubmit();
  }

  /** Search in a help example's box, keeping the rest of the form. */
  private runBoxExample(box: string): void {
    const where = this.formEl.querySelector<HTMLSelectElement>(
      'select[name="where"]',
    )!;
    where.value = "box";
    where.dispatchEvent(new Event("change"));
    this.formEl.querySelector<HTMLInputElement>('input[name="box"]')!.value =
      box;
    this.formEl.requestSubmit();
  }

  /** Fill text, mode and "Search in" from a help example, then search. */
  private runExample(example: SearchExample): void {
    this.field<HTMLInputElement>("text").value = example.text;
    this.formEl.querySelector<HTMLInputElement>(
      `input[name="textMode"][value="${example.mode}"]`,
    )!.checked = true;
    this.formEl.querySelector<HTMLSelectElement>(
      'select[name="field"]',
    )!.value = example.field ?? "";
    this.formEl.requestSubmit();
  }

  private buildForm(): HTMLFormElement {
    const serviceTypes = h(
      "fieldset",
      { className: "ordt-fieldset ordt-service-types", hidden: true },
      h("legend", {}, "Service type"),
      ...SERVICE_TYPES.map((o) =>
        h("label", { className: "ordt-check" }, h("input", { type: "checkbox", name: "serviceType", value: o.value }), o.label),
      ),
    );
    const toggleServiceTypes = () => {
      serviceTypes.hidden = checkedValue(this.formEl, "kind") !== "services";
    };

    const boxInput = h("input", {
      className: "ordt-input",
      name: "box",
      placeholder: "12.3, 41.7, 12.7, 42.0",
      hidden: true,
      "aria-label": "Box as west, south, east, north",
    });
    const spatialRel = radioGroup("spatialRel", SPATIAL_RELS, "Intersects", () => undefined);
    spatialRel.classList.add("ordt-spatial-rel", "ordt-small");
    spatialRel.setAttribute("aria-label", "Records whose extent");
    const whereSelect = select(WHERE_OPTIONS, "view", {
      name: "where",
      "aria-label": "Where",
      onchange: () => {
        boxInput.hidden = whereSelect.value !== "box";
        spatialRel.hidden = whereSelect.value === "anywhere";
        if (whereSelect.value === "drawn") void this.prepareDrawing();
      },
    });

    const themes = select([{ value: "", label: "Any theme" }, ...INSPIRE_THEMES], "", {
      name: "theme",
      "aria-label": "INSPIRE theme",
    });

    const exampleButton = (example: SearchExample) =>
      h(
        "button",
        {
          className: "ordt-link ordt-example",
          type: "button",
          onclick: () => this.runExample(example),
        },
        example.text,
      );
    const modeHelp = h(
      "div",
      { className: "ordt-help", id: "ordt-search-help", hidden: true },
      h("p", {}, "Click an example to try it."),
      h(
        "ul",
        {},
        ...SEARCH_EXAMPLES.map((example) =>
          h(
            "li",
            {},
            exampleButton(example),
            ` ${TEXT_MODES.find((o) => o.value === example.mode)!.label}: ${example.note}`,
          ),
        ),
      ),
      h(
        "p",
        {},
        'Lucene sends the text as it is, so characters such as / : ( ) " are query syntax: 42/2004 works in All words but is an error in Lucene.',
      ),
    );
    const fieldHelp = h(
      "div",
      { className: "ordt-help", id: "ordt-field-help", hidden: true },
      h("p", {}, "Where the words are looked for. Click an example to try it."),
      h(
        "ul",
        {},
        ...FIELD_EXAMPLES.map((example) =>
          h(
            "li",
            {},
            h(
              "strong",
              {},
              SEARCH_FIELDS.find((o) => o.value === example.field)!.label,
            ),
            `: ${example.note}. `,
            exampleButton(example),
          ),
        ),
      ),
      h(
        "p",
        {},
        "Lucene ignores this choice: write the field in the query, e.g. title:ortofoto.",
      ),
    );
    const fieldSelect = select(SEARCH_FIELDS, "", {
      name: "field",
      "aria-label": "Search in",
    });
    const whereHelp = h(
      "div",
      { className: "ordt-help", id: "ordt-where-help", hidden: true },
      h(
        "ul",
        {},
        ...WHERE_HELP.map((entry) =>
          h(
            "li",
            {},
            h(
              "strong",
              {},
              WHERE_OPTIONS.find((o) => o.value === entry.value)!.label,
            ),
            `: ${entry.note}`,
            entry.box
              ? h(
                  "span",
                  {},
                  " ",
                  h(
                    "button",
                    {
                      className: "ordt-link ordt-example",
                      type: "button",
                      onclick: () => this.runBoxExample(entry.box!),
                    },
                    entry.box,
                  ),
                )
              : null,
          ),
        ),
      ),
      h(
        "p",
        {},
        "A record's extent is a rectangle. With Touches the area a record is found when its extent touches the area, so national and regional records show up too: in the Palermo box, catastale finds 125 records, the cadastral maps of the municipalities (a rectangle also touches the neighbouring provinces) and the national cadastral services.",
      ),
      h(
        "p",
        {},
        "With Inside the area only records whose extent lies entirely within the area are kept: catastale in the Palermo box finds 85, all municipal cadastral maps. Regional records that reach beyond the area are left out too.",
      ),
    );

    const resourcesHelp = helpBox(
      "ordt-resources-help",
      h("ul", {}, ...RESOURCES_HELP.map(([term, note]) => termItem(term, note))),
      h("p", {}, RESOURCES_NOTE),
    );
    const availableAsHelp = textHelp("ordt-available-as-help", AVAILABLE_AS_HELP);
    const themeHelp = textHelp("ordt-theme-help", THEME_HELP);
    const keywordsHelp = textHelp("ordt-keywords-help", KEYWORDS_HELP);
    const organisationHelp = textHelp("ordt-organisation-help", ORGANISATION_HELP);
    const openDataHelp = textHelp("ordt-open-data-help", OPEN_DATA_HELP);
    const dateHelp = helpBox(
      "ordt-date-help",
      h("p", {}, "The first three are dates of the resource, not of its metadata:"),
      h("ul", {}, ...DATE_HELP.map(([term, note]) => termItem(term, note))),
      h(
        "p",
        {},
        "Publishers usually fill in only one of the first three: depending on the type, 44% to 64% of the records lack it, and a date range leaves them out. If you get few results, try another date type. With both dates empty there is no date filter.",
      ),
    );
    const sortHelp = helpBox(
      "ordt-sort-help",
      h("ul", {}, ...SORT_HELP.map(([term, note]) => termItem(term, note))),
      h("p", {}, SORT_NOTE),
    );

    this.copyQueryEl = h(
      "button",
      {
        className: "ordt-button ordt-curl",
        type: "button",
        disabled: true,
        title: "Copy query as curl",
        "aria-label": "Copy query as curl",
        onclick: () => this.copyQuery(),
      },
      "curl",
    );

    this.footprintsToggleEl = h(
      "button",
      { className: "ordt-link", type: "button", disabled: true, onclick: () => this.toggleFootprints() },
      "Hide footprints",
    );

    this.advancedCountEl = h("span", { className: "ordt-count", hidden: true });
    this.helpEl = h(
      "div",
      { className: "ordt-help-all", id: "ordt-help-all", hidden: true },
      helpSection("Search modes", modeHelp),
      helpSection("Search in", fieldHelp),
      helpSection("Type", resourcesHelp),
      helpSection("Where", whereHelp),
      helpSection("Available as", availableAsHelp),
      helpSection("Sort by", sortHelp),
    );

    const form = h(
      "form",
      {
        className: "ordt-form",
        id: FORM_ID,
        onsubmit: (event: Event) => {
          event.preventDefault();
          void this.search(1);
        },
        onchange: () => this.updateAdvancedCount(),
        oninput: () => this.updateAdvancedCount(),
      },
      h("div", { className: "ordt-label" }, "Type", radioGroup("kind", KIND_OPTIONS, "all", toggleServiceTypes, "ordt-segmented")),
      serviceTypes,
      h("div", { className: "ordt-label" }, "Where", whereSelect),
      boxInput,
      spatialRel,
      h(
        "div",
        { className: "ordt-label" },
        "Available as",
        h(
          "div",
          { className: "ordt-pills", role: "group", "aria-label": "Available as" },
          ...LINK_KINDS.map((kind) =>
            h("label", { className: "ordt-pill" }, h("input", { type: "checkbox", name: "availableAs", value: kind }), kind),
          ),
        ),
      ),
      h(
        "details",
        { className: "ordt-more" },
        h(
          "summary",
          {},
          h("span", {}, "Advanced filters ", this.advancedCountEl),
          h("span", { className: "ordt-more-hint" }, "text, theme, organisation, dates, sort"),
        ),
        h("div", { className: "ordt-label" }, "Match", radioGroup("textMode", TEXT_MODES, "all", () => undefined, "ordt-segmented")),
        h("div", { className: "ordt-label" }, "Search in", fieldSelect),
        h(
          "div",
          { className: "ordt-label" },
          h("span", { className: "ordt-label-head" }, "INSPIRE theme", helpToggle(themeHelp, "Help on INSPIRE themes")),
          themeHelp,
          themes,
        ),
        h(
          "div",
          { className: "ordt-label" },
          h(
            "span",
            { className: "ordt-label-head" },
            "Keywords ",
            h("span", { className: "ordt-hint" }, "· exact, case-sensitive, comma-separated"),
            helpToggle(keywordsHelp, "Help on keywords"),
          ),
          keywordsHelp,
          h("input", {
            className: "ordt-input",
            name: "keywords",
            placeholder: "opendata, Idrografia",
            "aria-label": "Keywords",
          }),
        ),
        h(
          "div",
          { className: "ordt-label" },
          h(
            "span",
            { className: "ordt-label-head" },
            "Organisation ",
            h("span", { className: "ordt-hint" }, "· comma-separated"),
            helpToggle(organisationHelp, "Help on organisation"),
          ),
          organisationHelp,
          h(
            "div",
            { className: "ordt-row" },
            h("input", {
              className: "ordt-input ordt-grow",
              name: "organisation",
              placeholder: "Regione Piemonte",
              "aria-label": "Organisation",
              oninput: () => this.syncClearButtons(),
            }),
            this.clearButton("organisation", "organisation"),
          ),
          radioGroup("orgMode", ORG_MODES, "only", () => undefined, "ordt-segmented"),
        ),
        h(
          "div",
          { className: "ordt-row" },
          h("label", { className: "ordt-check" }, h("input", { type: "checkbox", name: "openData" }), "Open data only"),
          helpToggle(openDataHelp, "Help on open data"),
        ),
        openDataHelp,
        h(
          "div",
          { className: "ordt-label" },
          h("span", { className: "ordt-label-head" }, "Date", helpToggle(dateHelp, "Help on dates")),
          dateHelp,
          h(
            "div",
            { className: "ordt-date-row" },
            select(DATE_FIELDS, "apiso_RevisionDate_dt", { name: "dateField", "aria-label": "Date type" }),
            h("input", { className: "ordt-input", type: "date", name: "dateFrom", "aria-label": "From" }),
            h("input", { className: "ordt-input", type: "date", name: "dateTo", "aria-label": "To" }),
          ),
          h(
            "div",
            { className: "ordt-row ordt-small ordt-date-presets" },
            ...DATE_PRESETS.map(([label, days]) =>
              h("button", { className: "ordt-link", type: "button", onclick: () => this.setDateFrom(days) }, label),
            ),
          ),
          h("span", { className: "ordt-hint" }, "Most records carry only one of the three resource dates."),
        ),
        h("div", { className: "ordt-label" }, "Sort by", select(SORT_OPTIONS, "", { name: "sort", "aria-label": "Sort by" })),
        h(
          "div",
          { className: "ordt-row ordt-small" },
          h("button", { className: "ordt-button ordt-primary", type: "submit" }, "Search"),
          h("button", { className: "ordt-link", type: "button", onclick: () => this.clearFilters() }, "Clear all"),
        ),
      ),
    );
    return form;
  }

  /** Text box and Search button: outside the form so they can stay on top, tied to it by `form`. */
  private buildSearchBar(): HTMLElement {
    return h(
      "div",
      { className: "ordt-row ordt-search-bar" },
      h("input", {
        className: "ordt-input ordt-grow",
        name: "text",
        type: "search",
        form: FORM_ID,
        placeholder: "Search titles, abstracts, keywords…",
        "aria-label": "Free text",
      }),
      h("button", { className: "ordt-button ordt-primary", type: "submit", form: FORM_ID }, "Search"),
    );
  }

  /** Active filters as removable chips, "Edit filters" and "Clear all". */
  private buildSummary(): HTMLElement {
    this.chipsEl = h("div", { className: "ordt-chips" });
    this.summaryTextEl = h("span", { className: "ordt-summary-text ordt-muted" });
    this.summaryToggleEl = h(
      "button",
      { className: "ordt-link", type: "button", onclick: () => this.showFilters(this.formEl.hidden === true) },
      "Edit filters",
    );
    this.clearAllEl = h(
      "button",
      {
        className: "ordt-link",
        type: "button",
        title: "Remove all filters and search again; the text stays",
        onclick: () => {
          this.clearFilters();
          this.formEl.requestSubmit();
        },
      },
      "Clear all",
    );
    return h(
      "div",
      { className: "ordt-summary ordt-small", hidden: true },
      this.chipsEl,
      this.summaryTextEl,
      h("span", { className: "ordt-summary-links" }, this.summaryToggleEl, this.clearAllEl),
    );
  }

  /** Pager with the status between its arrows, curl, sort, the ⋯ menu; below, Zoom to results and Hide footprints. */
  private buildResultsHead(): HTMLElement {
    this.sortEl = select(SORT_OPTIONS, "", {
      className: "ordt-input ordt-sort",
      "aria-label": "Sort results",
      onchange: () => this.changeSort(),
    });
    const menu = h(
      "div",
      { className: "ordt-menu", role: "menu", hidden: true },
      h("button", { className: "ordt-menu-item ordt-danger", type: "button", onclick: () => this.clearResults() }, "Clear results"),
    );
    this.resultActionsEl = h(
      "div",
      { className: "ordt-head-tools", hidden: true },
      this.copyQueryEl,
      this.sortEl,
      menuWrap(menu, "More actions"),
    );
    this.zoomRowEl = h(
      "div",
      { className: "ordt-row ordt-small", hidden: true },
      this.app.fitBounds && h("button", { className: "ordt-link", type: "button", onclick: () => this.zoomToResults() }, "Zoom to results"),
      this.footprintsToggleEl,
    );
    return h(
      "div",
      { className: "ordt-results-head" },
      h("div", { className: "ordt-head-row" }, this.pagerTopEl, this.resultActionsEl),
      this.zoomRowEl,
    );
  }

  private buildFooter(): HTMLElement {
    this.helpToggleEl = h(
      "button",
      {
        className: "ordt-link",
        type: "button",
        "aria-expanded": "false",
        "aria-controls": this.helpEl.id,
        onclick: () => this.showHelp(this.helpEl.hidden === true),
      },
      "Search help",
    );
    this.settingsToggleEl = h(
      "button",
      {
        className: "ordt-link",
        type: "button",
        "aria-expanded": "false",
        "aria-controls": this.settingsEl.id,
        onclick: () => this.showSettings(this.settingsEl.hidden === true),
      },
      "⚙ Settings",
    );
    return h(
      "div",
      { className: "ordt-footer ordt-small" },
      h(
        "a",
        { className: "ordt-link", href: "https://geodati.gov.it/geoportale/", target: "_blank", rel: "noopener" },
        "Italian national catalogue (RNDT)",
      ),
      h("span", { className: "ordt-footer-links" }, this.settingsToggleEl, this.helpToggleEl),
    );
  }

  private buildSettings(): HTMLElement {
    const logBox = h("input", {
      type: "checkbox",
      name: "logErrors",
      checked: this.settings.logErrors,
      onchange: () => {
        this.settings = { ...this.settings, logErrors: logBox.checked };
        saveSettings(this.settings);
      },
    });
    this.logCountEl = h("span", { className: "ordt-muted" });
    return h(
      "section",
      { className: "ordt-settings", id: "ordt-settings", hidden: true },
      h("h3", {}, "Settings"),
      h("label", { className: "ordt-check" }, logBox, "Log service URLs that fail (unreachable or errors)"),
      h(
        "p",
        { className: "ordt-note" },
        "Each failure adds a line: time (UTC), record, organisation, service type, URL, error. Up to 1,000 lines, the oldest leave first. Settings and log stay on this computer.",
      ),
      h(
        "div",
        { className: "ordt-row ordt-small" },
        this.logCountEl,
        h("button", { className: "ordt-link", type: "button", onclick: () => this.exportErrorLog() }, "Export JSON Lines"),
        h(
          "button",
          {
            className: "ordt-link",
            type: "button",
            onclick: () => {
              clearErrorLog();
              this.updateLogCount();
            },
          },
          "Clear log",
        ),
      ),
    );
  }

  private showSettings(show: boolean): void {
    this.settingsEl.hidden = !show;
    this.settingsToggleEl.setAttribute("aria-expanded", String(show));
    if (!show) return;
    // The footer stays in the detail view, the settings box does not: back to the list.
    this.closeDetail(false);
    this.updateLogCount();
    this.settingsEl.scrollIntoView?.({ block: "start" });
  }

  private updateLogCount(): void {
    const count = readErrorLog().length;
    this.logCountEl.textContent = `${count.toLocaleString("en")} ${count === 1 ? "entry" : "entries"}`;
  }

  /** Save the log through the host's "Save as" dialog, or as a download on the web. */
  private exportErrorLog(): void {
    const content = errorLogJsonl(readErrorLog());
    const filename = "openrndt-errors.jsonl";
    if (this.app.exportTextFile) {
      this.app.exportTextFile(filename, content, { description: "JSON Lines", extensions: ["jsonl"], mimeType: "application/jsonl" });
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: "application/jsonl" }));
    h("a", { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Add a failing service to the log, when the user turned it on. */
  private logError(record: RndtRecord, service: RndtService, error: string): void {
    if (!this.settings.logErrors) return;
    appendErrorLog({
      time: new Date().toISOString(),
      recordId: record.id,
      recordTitle: record.title,
      organisation: record.organisation,
      serviceKind: service.kind,
      url: service.url,
      error,
    });
    if (!this.settingsEl.hidden) this.updateLogCount();
  }

  /** Show "Search help" above the results, with the filters it explains; or hide it. */
  private showHelp(show: boolean): void {
    this.helpEl.hidden = !show;
    this.helpToggleEl.setAttribute("aria-expanded", String(show));
    if (!show) return;
    // As for Settings: the help sits with the filters, outside the detail view.
    this.closeDetail(false);
    this.showFilters(true);
    this.helpEl.scrollIntoView?.({ block: "start" });
  }

  /** Sort from the results header: the same search again, from the first page. */
  private changeSort(): void {
    this.field<HTMLSelectElement>("sort").value = this.sortEl.value;
    this.updateAdvancedCount();
    if (this.lastForm) void this.search(1, { ...this.lastForm, sort: this.sortEl.value });
  }

  /** Empty every filter, the area too (Anywhere); the text and the sort order stay. Nothing is searched. */
  private clearFilters(): void {
    const text = this.field<HTMLInputElement>("text").value;
    const sort = this.field<HTMLSelectElement>("sort").value;
    this.formEl.reset();
    this.field<HTMLInputElement>("text").value = text;
    this.field<HTMLSelectElement>("sort").value = sort;
    this.field<HTMLSelectElement>("where").value = "anywhere";
    this.afterReset();
  }

  /** Unfold or fold the filters; the chip line stays as their handle. */
  private showFilters(show: boolean): void {
    this.formEl.hidden = !show;
    this.summaryToggleEl.textContent = show ? "Hide filters" : "Edit filters";
    // Filters set in the advanced part must be visible when editing.
    if (show && this.advancedCount() > 0) this.formEl.querySelector<HTMLDetailsElement>(".ordt-more")!.open = true;
  }

  /**
   * The results header sticks just below the search bar, and a record scrolled
   * into view must clear both: their heights go into CSS variables.
   */
  private trackStickyHeights(): void {
    if (typeof ResizeObserver === "undefined") return;
    const update = () => {
      this.root!.style.setProperty("--ordt-bar-h", `${this.searchBarEl.offsetHeight}px`);
      this.root!.style.setProperty("--ordt-head-h", `${this.resultsHeadEl.offsetHeight}px`);
      this.root!.style.setProperty("--ordt-foot-h", `${this.footerEl.offsetHeight}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(this.searchBarEl);
    observer.observe(this.resultsHeadEl);
    observer.observe(this.footerEl);
  }

  /** Filters set in "Advanced filters", sort order included. */
  private advancedCount(): number {
    const mode = checkedValue(this.formEl, "textMode");
    return [
      mode && mode !== "all",
      this.field("field").value,
      this.field("theme").value,
      this.field("keywords").value.trim(),
      this.field("organisation").value.trim(),
      this.field<HTMLInputElement>("openData").checked,
      this.field("dateFrom").value || this.field("dateTo").value,
      this.field("sort").value,
    ].filter(Boolean).length;
  }

  private updateAdvancedCount(): void {
    const count = this.advancedCount();
    this.advancedCountEl.hidden = count === 0;
    this.advancedCountEl.textContent = String(count);
  }

  /**
   * One chip per active filter, each with the way to remove it. Read from the
   * form, so a chip always matches what the next search sends. The text has
   * no chip (it is in the search bar), nor has the sort order (in the header).
   */
  private activeChips(): { label: string; clear: () => void }[] {
    const selected = (name: string) => this.field<HTMLSelectElement>(name).selectedOptions[0]?.text ?? "";
    const setRadio = (name: string, value: string) =>
      (this.formEl.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.checked = true);
    const chips: { label: string; clear: () => void }[] = [];

    const mode = checkedValue(this.formEl, "textMode");
    if (mode && mode !== "all") {
      chips.push({ label: TEXT_MODES.find((o) => o.value === mode)!.label, clear: () => setRadio("textMode", "all") });
    }
    if (this.field("field").value) {
      chips.push({ label: `In ${selected("field")}`, clear: () => (this.field("field").value = "") });
    }
    const kind = checkedValue(this.formEl, "kind");
    if (kind && kind !== "all") {
      chips.push({
        label: KIND_OPTIONS.find((o) => o.value === kind)!.label,
        clear: () => {
          setRadio("kind", "all");
          for (const box of this.formEl.querySelectorAll<HTMLInputElement>('input[name="serviceType"]')) box.checked = false;
          this.formEl.querySelector<HTMLElement>(".ordt-service-types")!.hidden = true;
        },
      });
    }
    for (const box of this.formEl.querySelectorAll<HTMLInputElement>('input[name="serviceType"]:checked, input[name="availableAs"]:checked')) {
      chips.push({ label: box.closest("label")!.textContent!.trim(), clear: () => (box.checked = false) });
    }
    const where = this.field<HTMLSelectElement>("where");
    if (where.value !== "anywhere") {
      const area = where.value === "box" ? `Box ${this.field("box").value.trim()}` : where.value === "view" ? "Map view" : "Drawn shapes";
      chips.push({
        label: checkedValue(this.formEl, "spatialRel") === "Within" ? `Inside: ${area}` : area,
        clear: () => {
          where.value = "anywhere";
          where.dispatchEvent(new Event("change"));
        },
      });
    }
    if (this.field("theme").value) {
      chips.push({ label: selected("theme"), clear: () => (this.field("theme").value = "") });
    }
    const keywords = this.field("keywords").value.trim();
    if (keywords) {
      chips.push({ label: `Keywords: ${keywords}`, clear: () => (this.field("keywords").value = "") });
    }
    const organisation = this.field<HTMLInputElement>("organisation");
    const names = organisation.value.split(",").map((n) => n.trim()).filter(Boolean);
    const hiding = checkedValue(this.formEl, "orgMode") === "hide";
    for (const name of names) {
      chips.push({
        label: `${hiding ? "Hiding" : "Only"}: ${name}`,
        clear: () => {
          organisation.value = names.filter((n) => n !== name).join(", ");
          this.syncClearButtons();
        },
      });
    }
    if (this.field<HTMLInputElement>("openData").checked) {
      chips.push({ label: "Open data only", clear: () => (this.field<HTMLInputElement>("openData").checked = false) });
    }
    const from = this.field("dateFrom").value;
    const to = this.field("dateTo").value;
    if (from || to) {
      chips.push({
        label: `${selected("dateField")} ${from || "…"} to ${to || "…"}`,
        clear: () => {
          this.field("dateFrom").value = "";
          this.field("dateTo").value = "";
        },
      });
    }
    return chips;
  }

  /** Rebuild the chip line from the form; × removes one filter and searches again. */
  private renderChips(): void {
    const chips = this.activeChips();
    this.chipsEl.replaceChildren(
      ...chips.map((chip) =>
        h(
          "span",
          { className: "ordt-chip" },
          chip.label,
          h(
            "button",
            {
              className: "ordt-chip-remove",
              type: "button",
              "aria-label": `Remove ${chip.label}`,
              title: "Remove this filter and search again",
              onclick: () => {
                chip.clear();
                this.formEl.requestSubmit();
              },
            },
            "×",
          ),
        ),
      ),
    );
    this.updateAdvancedCount();
    this.summaryTextEl.textContent = chips.length ? "" : "No filters";
    this.summaryTextEl.hidden = chips.length > 0;
    this.clearAllEl.hidden = chips.length < 2;
  }

  /** Turn on GeoEditor when "Drawn shapes" is picked and nothing is drawn yet. */
  private async prepareDrawing(): Promise<void> {
    if (drawnBbox(this.app)) {
      this.setStatus("Search will use the shapes drawn with GeoEditor.");
      return;
    }
    const activated = (await this.app.activatePlugin?.(GEO_EDITOR_PLUGIN_ID).catch(() => false)) ?? false;
    this.setStatus(
      activated
        ? "GeoEditor is on: draw a rectangle or polygon on the map, then press Search."
        : "Turn on GeoEditor (Plugins > GeoEditor), draw a shape, then press Search.",
    );
  }

  /** A preset: From goes back the given days from today, To is left open. */
  private setDateFrom(days: number): void {
    const date = new Date();
    date.setDate(date.getDate() - days);
    this.field<HTMLInputElement>("dateFrom").value = localIsoDate(date);
    this.field<HTMLInputElement>("dateTo").value = "";
    this.updateAdvancedCount();
  }

  private afterReset(): void {
    this.formEl.querySelector<HTMLElement>(".ordt-service-types")!.hidden = true;
    // Box and Touches/Inside follow the default area (the map view).
    const where = this.field<HTMLSelectElement>("where").value;
    this.formEl.querySelector<HTMLElement>('input[name="box"]')!.hidden = where !== "box";
    this.formEl.querySelector<HTMLElement>(".ordt-spatial-rel")!.hidden = where === "anywhere";
    this.syncClearButtons();
    this.updateAdvancedCount();
  }

  /** The × that empties a text field; hidden while the field is empty. */
  private clearButton(field: string, label: string): HTMLButtonElement {
    return h(
      "button",
      {
        className: "ordt-clear",
        type: "button",
        hidden: true,
        "data-field": field,
        "aria-label": `Clear ${label}`,
        title: `Clear ${label} and search again`,
        onclick: () => this.clearField(field),
      },
      "×",
    );
  }

  /** Show each × only when its field has a value. */
  private syncClearButtons(): void {
    for (const button of this.formEl.querySelectorAll<HTMLElement>(".ordt-clear[data-field]")) {
      button.hidden = !this.field<HTMLInputElement>(button.dataset.field!).value.trim();
    }
  }

  /** Empty a filter field and, after a search, search again without it. */
  private clearField(name: string): void {
    const input = this.field<HTMLInputElement>(name);
    input.value = "";
    this.syncClearButtons();
    input.focus();
    if (this.lastForm) this.formEl.requestSubmit();
  }

  private field<T extends HTMLInputElement | HTMLSelectElement>(name: string): T {
    // The text box sits outside the <form> (in the search bar), tied to it by `form`.
    return this.root!.querySelector<T>(`[name="${name}"]`)!;
  }

  /** Read the form. Throws with a user-facing message on invalid input. */
  private readForm(): SearchForm {
    const form = emptyForm();
    form.text = this.field<HTMLInputElement>("text").value;
    form.textMode = (checkedValue(this.formEl, "textMode") || "all") as TextMode;
    form.field = this.field<HTMLSelectElement>("field").value;
    form.kind = (checkedValue(this.formEl, "kind") || "all") as ResourceKind;
    form.availableAs = Array.from(
      this.formEl.querySelectorAll<HTMLInputElement>('input[name="availableAs"]:checked'),
      (el) => el.value as LinkKind,
    );
    form.serviceTypes = Array.from(
      this.formEl.querySelectorAll<HTMLInputElement>('input[name="serviceType"]:checked'),
      (el) => el.value,
    );
    const theme = this.field<HTMLSelectElement>("theme").value;
    form.inspireThemes = theme ? [theme] : [];
    form.keywords = this.field<HTMLInputElement>("keywords").value;
    form.organisation = this.field<HTMLInputElement>("organisation").value;
    form.invertOrganisation = checkedValue(this.formEl, "orgMode") === "hide";
    form.openDataOnly = this.field<HTMLInputElement>("openData").checked;
    form.dateField = this.field<HTMLSelectElement>("dateField").value;
    form.dateFrom = this.field<HTMLInputElement>("dateFrom").value;
    form.dateTo = this.field<HTMLInputElement>("dateTo").value;
    form.sort = this.field<HTMLSelectElement>("sort").value;
    form.bbox = this.readWhere(this.field<HTMLSelectElement>("where").value as Where);
    form.spatialRel = (checkedValue(this.formEl, "spatialRel") || "Intersects") as SpatialRel;
    return form;
  }

  private readWhere(where: Where): Bbox | null {
    if (where === "anywhere") return null;
    if (where === "view") {
      const view = this.app.getViewBounds?.();
      if (!view) throw new Error("The map view is not available.");
      return clampBbox(view);
    }
    if (where === "drawn") {
      const box = drawnBbox(this.app);
      if (!box) throw new Error("Draw a shape first with the GeoEditor plugin (Plugins > GeoEditor), or pick another area.");
      return clampBbox(box);
    }
    const parts = this.field<HTMLInputElement>("box").value.split(/[\s,;]+/).filter(Boolean).map(Number);
    const box = parts as Bbox;
    const error = parts.length === 4 ? bboxError(box) : "The box needs four numbers: west, south, east, north.";
    if (error) throw new Error(error);
    return box;
  }

  // ---------------------------------------------------------------- search

  private setStatus(message: string, kind: "info" | "error" | "busy" = "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.kind = kind;
  }

  private async search(start: number, form?: SearchForm): Promise<void> {
    let current: SearchForm;
    try {
      current = form ?? this.readForm();
    } catch (error) {
      this.setStatus(errorMessage(error), "error");
      return;
    }
    let url: string;
    try {
      url = buildSearchUrl(RNDT_BASE_URL, current, start, PAGE_SIZE);
    } catch (error) {
      this.setStatus(errorMessage(error), "error");
      return;
    }
    const seq = ++this.requestSeq;
    this.setStatus("Searching the RNDT catalogue…", "busy");
    try {
      // A page of 20 results weighs about 1 MB (each carries its whole ISO XML,
      // which the catalogue cannot leave out): past the 8 s native budget of
      // the small-document path on a slow day (2026-09-27), so take the long one.
      const page = parseSearchResponse(await fetchJson(this.app, url, { download: true }), RNDT_BASE_URL);
      if (seq !== this.requestSeq) return; // a newer search is running
      this.lastForm = current;
      if (!form) {
        // A search from the form: fold the filters so the results get the room.
        this.renderChips();
        this.summaryEl.hidden = false;
        this.showFilters(false);
        this.showHelp(false);
      }
      this.sortEl.value = current.sort;
      this.closeDetail(false);
      this.records = page.records;
      this.total = page.total;
      this.start = start;
      this.copyQueryEl.disabled = false;
      this.footprintsOverlay()?.setData(footprints(page.records));
      this.renderResults();
      this.updateFootprintControls();
    } catch (error) {
      if (seq !== this.requestSeq) return;
      this.setStatus(`Search failed: ${errorMessage(error)}`, "error");
    }
  }

  clearResults(): void {
    this.requestSeq++;
    this.records = [];
    this.total = 0;
    this.lastForm = null;
    this.footprintsLayer?.clear();
    if (this.copyQueryEl) this.copyQueryEl.disabled = true;
    if (this.footprintsToggleEl) this.updateFootprintControls();
    if (!this.root) return;
    this.closeDetail(false);
    this.listEl.replaceChildren();
    this.pagerEl.replaceChildren();
    this.pagerTopEl.replaceChildren(this.statusEl);
    this.resultActionsEl.hidden = true;
    this.zoomRowEl.hidden = true;
    this.summaryEl.hidden = true;
    this.showFilters(true);
    this.setStatus("Results cleared.");
  }

  /** Hide all footprints, or show them all again (also those hidden one by one). */
  toggleFootprints(): void {
    const layer = this.footprintsLayer;
    if (!layer) return;
    layer.setVisible(!layer.isVisible());
    this.updateFootprintControls();
  }

  private toggleFootprint(recordId: string): void {
    const layer = this.footprintsLayer;
    if (!layer) return;
    layer.setHidden(recordId, !layer.isHidden(recordId));
    this.updateFootprintControls();
  }

  /** Sync the global and per-record footprint links with the layer state. */
  private updateFootprintControls(): void {
    const layer = this.footprintsLayer;
    const allVisible = layer?.isVisible() ?? true;
    this.footprintsToggleEl.disabled = !layer || !this.records.some((r) => r.bbox);
    this.footprintsToggleEl.textContent = allVisible ? "Hide footprints" : "Show footprints";
    // In the list (⋯ of each card) and in the detail view.
    for (const button of Array.from(this.root?.querySelectorAll<HTMLButtonElement>(".ordt-footprint-toggle") ?? [])) {
      const id = button.dataset.id!;
      button.textContent = layer?.isHidden(id) ? "Show footprint" : "Hide footprint";
      button.disabled = !allVisible;
      button.title = allVisible ? "" : "All footprints are hidden: use Show footprints first";
    }
  }

  /** Copy a curl command that repeats the search page on screen. */
  private copyQuery(): void {
    if (!this.lastForm) return;
    const command = buildCurlCommand(RNDT_BASE_URL, this.lastForm, this.start, PAGE_SIZE);
    const button = this.copyQueryEl;
    void navigator.clipboard?.writeText(command).then(
      () => {
        button.textContent = "✓ copied";
        setTimeout(() => (button.textContent = "curl"), 1500);
      },
      () => this.setStatus("Could not copy to the clipboard.", "error"),
    );
  }

  private zoomToResults(): void {
    const boxes = this.records.map((r) => r.bbox).filter((b): b is Bbox => !!b);
    if (!boxes.length || !this.app.fitBounds) return;
    this.app.fitBounds([
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ]);
  }

  private renderResults(): void {
    const end = this.start + this.records.length - 1;
    this.setStatus(
      this.total === 0
        ? "No records found."
        : `${this.start}-${end} of ${this.total.toLocaleString("en")}`,
    );
    this.listEl.replaceChildren(...this.records.map((r) => this.renderRecord(r)));
    this.resultActionsEl.hidden = false;
    this.zoomRowEl.hidden = !this.records.some((r) => r.bbox);

    if (this.total > PAGE_SIZE) {
      const [previous, next] = this.pagerButtons(end, true);
      this.pagerTopEl.replaceChildren(previous, this.statusEl, next);
      this.pagerEl.replaceChildren(...this.pagerButtons(end, false));
    } else {
      this.pagerTopEl.replaceChildren(this.statusEl);
      this.pagerEl.replaceChildren();
    }
  }

  /** Previous/Next for the current page: compact arrows in the header, words below the list. */
  private pagerButtons(end: number, compact: boolean): HTMLButtonElement[] {
    const go = (start: number) =>
      void this.search(start, this.lastForm ?? undefined).then(() =>
        // The new page starts from its first record, wherever the click came from.
        this.listEl.firstElementChild?.scrollIntoView?.({ block: "start" }),
      );
    return [
      h("button", {
        className: "ordt-button",
        type: "button",
        "aria-label": "Previous page",
        disabled: this.start <= 1,
        onclick: () => go(Math.max(1, this.start - PAGE_SIZE)),
      }, compact ? "‹" : "‹ Previous"),
      h("button", {
        className: "ordt-button",
        type: "button",
        "aria-label": "Next page",
        disabled: end >= this.total,
        onclick: () => go(this.start + PAGE_SIZE),
      }, compact ? "›" : "Next ›"),
    ];
  }

  /**
   * Show one record in its own view, in place of filters and list (from its
   * title in the list or its footprint on the map). The search bar and the
   * footer stay.
   */
  private openDetail(id: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record || !this.root) return;
    this.detailId = id;
    this.footprintsLayer?.select(id);
    this.detailEl.replaceChildren(...this.renderDetail(record).filter((c): c is Node | string => !!c));
    this.detailEl.hidden = false;
    this.root.classList.add("ordt-in-detail");
    this.searchBarEl.scrollIntoView?.({ block: "start" });
  }

  /** Back to the list; with `scroll`, to the card of the record that was open. */
  private closeDetail(scroll: boolean): void {
    if (this.detailId === null) return;
    const id = this.detailId;
    this.detailId = null;
    this.detailEl.hidden = true;
    this.detailEl.replaceChildren();
    this.root?.classList.remove("ordt-in-detail");
    this.footprintsLayer?.select(null);
    if (!scroll) return;
    const card = Array.from(this.listEl.children).find((li) => (li as HTMLElement).dataset.id === id);
    card?.scrollIntoView?.({ block: "nearest" });
  }

  /** Mark the result whose footprint is hovered on the map. */
  private markHovered(id: string | null): void {
    for (const li of Array.from(this.listEl.children) as HTMLElement[]) {
      li.classList.toggle("ordt-hovered", li.dataset.id === id);
    }
  }

  private renderRecord(record: RndtRecord): HTMLElement {
    const kinds = Array.from(new Set(record.services.map((s) => s.kind)));
    const li = h(
      "li",
      { className: "ordt-result", "data-id": record.id },
      h(
        "button",
        {
          className: "ordt-result-title",
          type: "button",
          title: "Show details and zoom to the extent",
          onclick: () => {
            this.openDetail(record.id);
            if (record.bbox) this.app.fitBounds?.(record.bbox);
          },
        },
        record.title,
      ),
      this.recordMenu(record),
      h(
        "div",
        { className: "ordt-meta" },
        record.type && h("span", { className: "ordt-muted" }, record.type),
        ...kinds.map((k) => h("span", { className: "ordt-badge ordt-badge-service" }, k)),
      ),
      h(
        "div",
        { className: "ordt-meta ordt-meta-org" },
        h("span", { className: "ordt-org-name", title: record.organisation }, record.organisation),
        record.modified && h("span", { className: "ordt-muted ordt-date" }, `Metadata ${record.modified}`),
      ),
    );
    if (record.bbox) {
      li.addEventListener("mouseenter", () => this.footprintsLayer?.highlight(record.id));
      li.addEventListener("mouseleave", () => this.footprintsLayer?.highlight(null));
    }
    return li;
  }

  /** The ⋯ of a result: keep or hide its organisation, zoom, hide its footprint. */
  private recordMenu(record: RndtRecord): HTMLElement {
    const items: Child[] = [];
    if (record.organisation) {
      items.push(
        h(
          "button",
          { className: "ordt-menu-item ordt-hide-org", type: "button", onclick: () => this.excludeOrganisation(record.organisation) },
          "Hide results from ",
          h("strong", {}, record.organisation),
        ),
        h(
          "button",
          { className: "ordt-menu-item ordt-org", type: "button", onclick: () => this.filterByOrganisation(record.organisation) },
          "Show only this organisation",
        ),
      );
    }
    if (record.bbox && this.app.fitBounds) {
      items.push(
        h("button", { className: "ordt-menu-item", type: "button", onclick: () => this.app.fitBounds!(record.bbox!) }, "Zoom to extent"),
      );
    }
    if (record.bbox && this.footprintsLayer) {
      items.push(
        h(
          "button",
          {
            className: "ordt-menu-item ordt-footprint-toggle",
            type: "button",
            "data-id": record.id,
            disabled: !this.footprintsLayer.isVisible(),
            onclick: () => this.toggleFootprint(record.id),
          },
          this.footprintsLayer.isHidden(record.id) ? "Show footprint" : "Hide footprint",
        ),
      );
    }
    return menuWrap(h("div", { className: "ordt-menu", role: "menu", hidden: true }, ...items), "Record actions");
  }

  private renderDetail(record: RndtRecord): Child[] {
    const kinds = Array.from(new Set(record.services.map((s) => s.kind)));
    const more: Child[] = [
      h("a", { className: "ordt-menu-item", href: record.xmlUrl, target: "_blank", rel: "noopener" }, "ISO XML"),
      h(
        "button",
        {
          className: "ordt-menu-item",
          type: "button",
          title: record.id,
          onclick: () => void navigator.clipboard?.writeText(record.id).catch(() => undefined),
        },
        "Copy id",
      ),
    ];
    if (record.bbox && this.footprintsLayer) {
      more.push(
        h(
          "button",
          {
            className: "ordt-menu-item ordt-footprint-toggle",
            type: "button",
            "data-id": record.id,
            disabled: !this.footprintsLayer.isVisible(),
            onclick: () => this.toggleFootprint(record.id),
          },
          this.footprintsLayer.isHidden(record.id) ? "Show footprint" : "Hide footprint",
        ),
      );
    }
    return [
      h(
        "button",
        { className: "ordt-link ordt-back", type: "button", onclick: () => this.closeDetail(true) },
        `← ${this.total.toLocaleString("en")} results`,
      ),
      h("h2", { className: "ordt-detail-title" }, record.title),
      h(
        "div",
        { className: "ordt-meta" },
        record.type && h("span", { className: "ordt-muted" }, record.type),
        ...kinds.map((k) => h("span", { className: "ordt-badge ordt-badge-service" }, k)),
      ),
      record.organisation && h("div", { className: "ordt-small" }, record.organisation),
      record.modified && h("div", { className: "ordt-small ordt-muted" }, `Metadata updated ${record.modified}`),
      record.abstract && h("p", { className: "ordt-abstract" }, record.abstract),
      record.services.length
        ? h("ul", { className: "ordt-services" }, ...groupServices(record.services).map((g) => this.renderService(record, g)))
        : !record.otherLinks.length && h("p", { className: "ordt-muted" }, "No services or downloads declared in this record."),
      record.otherLinks.length > 0 &&
        h(
          "div",
          { className: "ordt-other-links" },
          h("p", { className: "ordt-muted" }, "Other links (web pages, folders: the plugin cannot add them to the map)"),
          h(
            "ul",
            {},
            ...record.otherLinks.map((url) => {
              const parsed = new URL(url);
              return h(
                "li",
                {},
                h("a", { className: "ordt-link", href: url, target: "_blank", rel: "noopener" }, `${parsed.host}${parsed.pathname}`),
                " ",
                this.copyButton(url),
              );
            }),
          ),
        ),
      h(
        "div",
        { className: "ordt-row ordt-small ordt-detail-actions" },
        record.bbox &&
          this.app.fitBounds &&
          h("button", { className: "ordt-link", type: "button", onclick: () => this.app.fitBounds!(record.bbox!) }, "Zoom to extent"),
        h("a", { className: "ordt-link", href: record.htmlUrl, target: "_blank", rel: "noopener" }, "Metadata"),
        menuWrap(h("div", { className: "ordt-menu", role: "menu", hidden: true }, ...more), "More record actions"),
      ),
    ];
  }

  private copyButton(value: string, label = "Copy URL"): HTMLButtonElement {
    const button = h("button", { className: "ordt-link", type: "button", title: value }, label);
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(value).then(
        () => {
          button.textContent = "Copied";
          setTimeout(() => (button.textContent = label), 1500);
        },
        () => undefined,
      );
    });
    return button;
  }

  // ---------------------------------------------------------------- services

  /**
   * One service of the record. A WMS or WFS reads its capabilities as soon as
   * the detail view opens and lists its layers; a GeoJSON download gets an
   * "Add to map" button; every service gets Open and Copy URL.
   */
  private renderService(record: RndtRecord, service: ServiceGroup): HTMLElement {
    const area = h("div", { className: "ordt-service-area" });
    const countEl = h("strong", { className: "ordt-layer-count" });
    const actions: Child[] = [];
    if (service.kind === "download" && isGeoJsonUrl(service.url) && this.app.addGeoJsonLayer) {
      const add = h("button", { className: "ordt-button", type: "button" }, "Add to map");
      // Disabled while it runs, so a slow server is not hit twice.
      add.addEventListener("click", () => {
        add.disabled = true;
        void this.addGeoJson(record, service, area).finally(() => (add.disabled = false));
      });
      actions.push(add);
    }
    actions.push(h("a", { className: "ordt-link", href: service.url, target: "_blank", rel: "noopener" }, "Open"));
    actions.push(this.copyButton(service.url));
    if (service.kind === "WMS" && this.app.addWmsLayer) void this.openWms(record, service, area, countEl);
    else if (service.kind === "WFS" && this.app.addGeoJsonLayer) void this.openWfs(record, service, area, countEl);
    return h(
      "li",
      { className: "ordt-service" },
      h(
        "div",
        { className: "ordt-row ordt-service-head" },
        h("span", { className: "ordt-badge ordt-badge-service" }, service.kind),
        countEl,
        h("span", { className: "ordt-host", title: service.url }, host(service.url)),
        h("span", { className: "ordt-row ordt-small ordt-service-actions" }, ...actions),
      ),
      area,
    );
  }

  private note(
    area: HTMLElement,
    message: string,
    kind: "info" | "error" | "busy" = "info",
    report?: { record: RndtRecord; service: RndtService },
  ): void {
    if (report) this.logError(report.record, report.service, message);
    area.replaceChildren(
      h("p", { className: "ordt-note", "data-kind": kind }, message, report && " ", report && reportControl(report.record, report.service, message)),
    );
  }

  /**
   * Layer list for a WMS/WFS (#7): one row per layer, its readable name on
   * top (the capabilities title if it reads as a name, else a title from RNDT)
   * and the code below. Several rows can be checked for a WMS, one for a WFS
   * (each WFS add is a download of its own). RNDT titles are looked up in the
   * background and replace the labels in place; the per-layer lookups wait
   * for the first pointer or focus on the list, as they waited for the old
   * menu to open. Above FILTER_THRESHOLD layers a filter field narrows the
   * rows; hidden rows keep their tick.
   */
  private layerList(
    layers: { name: string; title: string }[],
    wanted: string | null,
    serviceUrl: string,
    mode: "multi" | "single",
    ariaLabel: string,
    disabledReason: (name: string) => string | null = () => null,
  ): { list: HTMLElement; controls: HTMLElement[]; selected: () => string[]; nameOf: (name: string) => string } {
    const readable = new Map(layers.map((l) => [l.name, readableTitle(l.name, l.title)]));
    const enabled = layers.filter((l) => !disabledReason(l.name));
    const first = enabled.some((l) => l.name === wanted) ? wanted : (enabled[0]?.name ?? null);
    const group = `ordt-layers-${++this.layerListSeq}`;
    const rows = new Map<string, { row: HTMLElement; input: HTMLInputElement; title: HTMLElement; code: HTMLElement }>();
    for (const layer of layers) {
      const reason = disabledReason(layer.name);
      const name = readable.get(layer.name);
      const input = h("input", {
        type: mode === "multi" ? "checkbox" : "radio",
        name: group,
        value: layer.name,
        disabled: !!reason,
        checked: layer.name === first,
      });
      const title = h("span", { className: "ordt-layer-title" }, name || layer.name);
      const code = h("span", { className: "ordt-layer-code", hidden: !name }, layer.name);
      const row = h(
        "label",
        { className: "ordt-layer", title: reason ?? "" },
        input,
        h("span", { className: "ordt-layer-text" }, title, code, reason && h("span", { className: "ordt-layer-reason" }, reason)),
      );
      rows.set(layer.name, { row, input, title, code });
    }
    const list = h(
      "div",
      { className: "ordt-layers", role: mode === "single" ? "radiogroup" : "group", "aria-label": ariaLabel },
      ...Array.from(rows.values(), (r) => r.row),
    );
    const controls: HTMLElement[] = [];

    if (layers.length > FILTER_THRESHOLD) {
      const filter = h("input", {
        className: "ordt-input",
        type: "search",
        placeholder: `Filter ${layers.length.toLocaleString("en")} layers…`,
        "aria-label": "Filter layers",
      });
      filter.addEventListener("input", () => {
        const needle = filter.value.trim().toLowerCase();
        let firstMatch: HTMLInputElement | null = null;
        for (const [name, r] of rows) {
          const match = !needle || r.title.textContent!.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
          r.row.hidden = !match;
          if (match && !firstMatch && !r.input.disabled) firstMatch = r.input;
        }
        // One choice only: keep it on a row the user can see.
        if (mode === "single" && firstMatch && !Array.from(rows.values()).some((r) => r.input.checked && !r.row.hidden)) {
          firstMatch.checked = true;
          list.dispatchEvent(new Event("change"));
        }
      });
      controls.push(filter);
    }

    const setTitle = (name: string, title: string) => {
      readable.set(name, title);
      const r = rows.get(name)!;
      r.title.textContent = title;
      r.code.hidden = false;
    };
    if (layers.some((l) => !readable.get(l.name))) {
      const status = h("p", { className: "ordt-note", "data-kind": "busy" }, "Looking up readable names in RNDT…");
      controls.push(status);
      void lookupLayerTitles(this.app, RNDT_BASE_URL, serviceUrl).then((lookup) => {
        if (lookup.mode === "all") {
          let found = 0;
          for (const name of rows.keys()) {
            if (readable.get(name)) continue;
            const title = findTitle(lookup.found, name);
            if (!title) continue;
            setTitle(name, title);
            found++;
          }
          const report = () => {
            status.hidden = found === 0;
            status.dataset.kind = "info";
            status.textContent = `Readable names from RNDT for ${found.toLocaleString("en")} of ${layers.length.toLocaleString("en")} layers.`;
          };
          report();
          const missing = Array.from(rows.keys()).filter((name) => !readable.get(name));
          if (!missing.length) return;
          // Some records name the layer only inside their ISO XML: when the
          // user reaches the list, search RNDT for each layer still without a
          // name, four at a time.
          const onReach = () => {
            list.removeEventListener("pointerenter", onReach);
            list.removeEventListener("focusin", onReach);
            status.hidden = false;
            status.dataset.kind = "busy";
            status.textContent = `Looking up readable names in RNDT for ${missing.length.toLocaleString("en")} layers…`;
            const worker = async () => {
              for (let name = missing.shift(); name; name = missing.shift()) {
                const title = await lookupLayerTitleByCode(this.app, RNDT_BASE_URL, serviceUrl, name);
                if (!title) continue;
                setTitle(name, title);
                found++;
              }
            };
            void Promise.all(Array.from({ length: 4 }, worker)).then(report);
          };
          list.addEventListener("pointerenter", onReach);
          list.addEventListener("focusin", onReach);
          return;
        }
        // Too many RNDT records to download: look up the ticked layers only,
        // now and on every change; each layer is asked once.
        const asked = new Set<string>();
        const lookupTicked = async () => {
          const todo = Array.from(rows).filter(([name, r]) => r.input.checked && !readable.get(name) && !asked.has(name));
          if (!todo.length) return;
          status.dataset.kind = "busy";
          status.textContent = "Looking up the readable name of the selected layer in RNDT…";
          for (const [name] of todo) {
            asked.add(name);
            const title =
              (await lookupOneLayerTitle(this.app, RNDT_BASE_URL, serviceUrl, name)) ??
              (await lookupLayerTitleByCode(this.app, RNDT_BASE_URL, serviceUrl, name));
            if (title) setTitle(name, title);
          }
          status.dataset.kind = "info";
          status.textContent = "Readable names are looked up in RNDT for the selected layer only.";
        };
        list.addEventListener("change", () => void lookupTicked());
        void lookupTicked();
      });
    }

    return {
      list,
      controls,
      selected: () => Array.from(rows).filter(([, r]) => r.input.checked && !r.input.disabled).map(([name]) => name),
      nameOf: (name) => readable.get(name) || name,
    };
  }

  private async openWms(record: RndtRecord, service: ServiceGroup, area: HTMLElement, countEl: HTMLElement): Promise<void> {
    this.note(area, "Reading the WMS capabilities…", "busy");
    try {
      const fetched = await fetchTextFrom(this.app, capabilitiesUrl(service.url, "WMS"));
      const caps = parseWmsCapabilities(fetched.text, fetched.url);
      const declared = caps.getMapUrl;
      caps.getMapUrl = upgradeToHttps(declared, fetched.url);
      // https was our own guess (the record says http): keep the declared http
      // URL when only that one is reachable from the browser, or GeoLibre's
      // identify on the layer fails.
      if (caps.getMapUrl !== declared && /^http:/i.test(service.url) && (await browserNeedsHttp(fetched.url))) {
        caps.getMapUrl = declared;
      }
      if (!caps.layers.length) {
        this.note(area, "The WMS lists no named layers.", "error", { record, service });
        return;
      }
      countEl.textContent = layerCount(caps.layers.length);
      const byName = new Map(caps.layers.map((l) => [l.name, l]));
      const outside3857 = (name: string) => {
        const layer = byName.get(name)!;
        return supportsWebMercator(layer)
          ? null
          : `Not offered in EPSG:3857 (only ${layer.crs.slice(0, 6).join(", ")}${layer.crs.length > 6 ? ", …" : ""}): GeoLibre plugins cannot display it yet.`;
      };
      const wanted = service.layerHint ?? bestMatchingLayer(record.title, caps.layers);
      const { list, controls, selected, nameOf } = this.layerList(caps.layers, wanted, service.url, "multi", "WMS layers", outside3857);
      const add = h("button", { className: "ordt-button ordt-primary", type: "button" });
      const result = h("p", { className: "ordt-note", hidden: true });
      const sync = () => {
        const count = selected().length;
        add.disabled = count === 0;
        add.textContent = count ? `Add to map (${count})` : "Select a layer";
      };
      if (controls.some((c) => c.tagName === "INPUT")) add.title = "Ticked layers hidden by the filter are added too";
      list.addEventListener("change", sync);
      add.addEventListener("click", () => {
        const names = selected();
        const failed: string[] = [];
        for (const name of names) {
          const layer = byName.get(name)!;
          try {
            this.app.addWmsLayer!(nameOf(name), {
              url: caps.getMapUrl,
              layers: name,
              version: caps.version.startsWith("1.3") ? "1.3.0" : "1.1.1",
              format: "image/png",
              transparent: true,
              bounds: layer.bbox && !bboxError(layer.bbox) ? layer.bbox : undefined,
            });
          } catch (error) {
            failed.push(`${nameOf(name)}: ${errorMessage(error)}`);
          }
        }
        const added = names.length - failed.length;
        result.hidden = false;
        result.dataset.kind = failed.length ? "error" : "info";
        result.textContent = [
          `Added ${added} of ${names.length} ${names.length === 1 ? "layer" : "layers"}, named with their titles.`,
          ...failed.map((f) => `Could not add ${f}`),
        ].join(" ");
      });
      const note = enabledCount(caps.layers, outside3857) === 0
        ? h("p", { className: "ordt-note", "data-kind": "error" }, "No layer of this WMS is offered in EPSG:3857: GeoLibre plugins cannot display them yet.")
        : null;
      area.replaceChildren(
        ...controls.filter((c) => c.tagName === "INPUT"),
        list,
        ...controls.filter((c) => c.tagName !== "INPUT"),
        ...(note ? [note] : []),
        h("div", { className: "ordt-row ordt-small" }, add, h("span", { className: "ordt-muted" }, "added with their titles as layer names")),
        result,
      );
      showTicked(list);
      sync();
    } catch (error) {
      this.note(area, `WMS error: ${errorMessage(error)}`, "error", { record, service });
    }
  }

  private async openWfs(record: RndtRecord, service: ServiceGroup, area: HTMLElement, countEl: HTMLElement): Promise<void> {
    this.note(area, "Reading the WFS capabilities…", "busy");
    try {
      const fetched = await fetchTextFrom(this.app, capabilitiesUrl(service.url, "WFS"));
      const caps = parseWfsCapabilities(fetched.text, fetched.url);
      caps.getFeatureUrl = upgradeToHttps(caps.getFeatureUrl, fetched.url);
      if (!caps.featureTypes.length) {
        this.note(area, "The WFS lists no feature types.", "error", { record, service });
        return;
      }
      const format = pickJsonFormat(caps.outputFormats);
      if (!format) {
        this.note(area, "This WFS offers no GeoJSON output, so it cannot be added directly.", "error");
        return;
      }
      countEl.textContent = layerCount(caps.featureTypes.length);
      const wanted = service.layerHint ?? bestMatchingLayer(record.title, caps.featureTypes);
      const { list, controls, selected, nameOf } = this.layerList(caps.featureTypes, wanted, service.url, "single", "WFS feature types");
      const inView = h("input", { type: "checkbox", checked: true });
      const add = h("button", { className: "ordt-button ordt-primary", type: "button" }, "Add features");
      const result = h("p", { className: "ordt-note", hidden: true });
      add.addEventListener("click", () => {
        void (async () => {
          const name = selected()[0];
          if (!name) return;
          const view = inView.checked ? this.app.getViewBounds?.() ?? null : null;
          const bbox = view ? clampBbox(view) : null;
          add.disabled = true;
          result.hidden = false;
          result.dataset.kind = "busy";
          result.textContent = "Counting features…";
          try {
            const total = await this.countFeatures(caps, name, bbox);
            let limit = WFS_MAX_FEATURES;
            if (total !== null && total > WFS_MAX_FEATURES) {
              const choice = await askChoice(
                result,
                `${total.toLocaleString("en")} features in this area. Downloading them all can be slow and use a lot of memory.`,
                [
                  { value: "all", label: "Download all" },
                  { value: "first", label: `First ${WFS_MAX_FEATURES.toLocaleString("en")} only` },
                  { value: "cancel", label: "Cancel" },
                ],
              );
              if (choice === "cancel") {
                result.dataset.kind = "info";
                result.textContent = "Download cancelled.";
                return;
              }
              if (choice === "all") limit = total;
            }
            result.dataset.kind = "busy";
            result.textContent = "Downloading features…";
            const url = buildGetFeatureUrl(caps, name, { format, maxFeatures: limit, bbox });
            const data = await fetchJson(this.app, url, { download: true });
            if (!isFeatureCollection(data)) throw new Error("the response is not a GeoJSON FeatureCollection");
            if (!data.features.length) {
              result.dataset.kind = "info";
              result.textContent = inView.checked
                ? "No features in the current map view."
                : "The service returned no features.";
              return;
            }
            this.app.addGeoJsonLayer!(nameOf(name) || record.title, fixAxisOrder(data));
            result.dataset.kind = "info";
            const added = data.features.length;
            result.textContent =
              total !== null && added < total
                ? `Added ${added.toLocaleString("en")} of ${total.toLocaleString("en")} features: the map is incomplete, zoom in for the rest.`
                : total === null && added >= limit
                  ? `Added ${added.toLocaleString("en")} features: limit reached, the map may be incomplete; zoom in for the rest.`
                  : `Added ${added.toLocaleString("en")} features.`;
          } catch (error) {
            result.dataset.kind = "error";
            // A server that does not answer in time is usually sending a big
            // layer: say what to try, not only what failed.
            const message = errorMessage(error);
            result.textContent = message.startsWith("cannot reach")
              ? `WFS error: ${message}. Large layers can be slow: zoom in and keep "Only features in the current map view" checked.`
              : `WFS error: ${message}`;
            result.append(" ", reportControl(record, service, `WFS error: ${message}`));
            this.logError(record, service, `WFS error: ${message}`);
          } finally {
            add.disabled = false;
          }
        })();
      });
      area.replaceChildren(
        ...controls.filter((c) => c.tagName === "INPUT"),
        list,
        ...controls.filter((c) => c.tagName !== "INPUT"),
        h("label", { className: "ordt-check ordt-small" }, inView, "Only features in the current map view"),
        h("div", { className: "ordt-row ordt-small" }, add),
        result,
      );
      showTicked(list);
    } catch (error) {
      this.note(area, `WFS error: ${errorMessage(error)}`, "error", { record, service });
    }
  }

  /** How many features a download would match, or null when the server cannot tell. */
  private async countFeatures(caps: WfsCapabilities, typeName: string, bbox: Bbox | null): Promise<number | null> {
    const url = buildHitsUrl(caps, typeName, bbox);
    if (!url) return null;
    try {
      return parseHitsCount(await fetchText(this.app, url));
    } catch {
      return null; // A failed count must not block the download.
    }
  }

  private async addGeoJson(record: RndtRecord, service: RndtService, area: HTMLElement): Promise<void> {
    this.note(area, "Downloading GeoJSON…", "busy");
    try {
      const data = await fetchJson(this.app, service.url, { download: true });
      if (!isFeatureCollection(data)) throw new Error("the file is not a GeoJSON FeatureCollection");
      this.app.addGeoJsonLayer!(record.title, fixAxisOrder(data));
      this.note(area, `Added ${data.features.length} features.`);
    } catch (error) {
      this.note(area, `Could not add the file: ${errorMessage(error)}`, "error", { record, service });
    }
  }
}
