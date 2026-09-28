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
import { findTitle, lookupLayerTitles, lookupOneLayerTitle, optionLabel, readableTitle } from "./layer-names";

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

function radioGroup(name: string, options: Option[], value: string, onChange: () => void): HTMLElement {
  return h(
    "div",
    { className: "ordt-radios", role: "radiogroup" },
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
  "Separate several organisations with commas. Invert hides them instead: entrate hides Agenzia delle Entrate, which alone publishes about a third of the catalogue (its municipal cadastral maps).",
  "In the results, clicking an organisation name keeps only that organisation; Hide next to it hides it.",
];

const OPEN_DATA_HELP = [
  "Records whose publisher filled in the open data field. It is a declaration, not a check: the field may hold a licence (CC BY 4.0), just the words open data, or even a non-commercial licence.",
  "Records that state an open licence only in another field are left out. Ignored with Services.",
];

const DATE_HELP: [string, string][] = [
  ["Revision", "the last update of the resource"],
  ["Publication", "when the resource was published"],
  ["Creation", "when the resource was produced"],
];

const SORT_HELP: [string, string][] = [
  ["Relevance", "the records that best match the words searched come first"],
  ["Title", "alphabetical order"],
  [
    "Metadata date",
    "when the record was last updated in the catalogue. It is not one of the three dates of the Date filter",
  ],
];

const SORT_NOTE =
  "The catalogue cannot sort by the resource dates (revision, publication, creation): it ignores that request.";
const WHERE_OPTIONS: Option[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "view", label: "Current map view" },
  { value: "drawn", label: "Drawn shapes (GeoEditor)" },
  { value: "box", label: "Box (west, south, east, north)" },
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
  private footprintsLayer: FootprintsLayer | null = null;
  private records: RndtRecord[] = [];
  private total = 0;
  private start = 1;
  private expandedId: string | null = null;
  private requestSeq = 0;
  private lastForm: SearchForm | null = null;
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
      this.statusEl = h("div", { className: "ordt-status", role: "status", "aria-live": "polite" });
      this.listEl = h("ol", { className: "ordt-results" });
      this.pagerEl = h("div", { className: "ordt-pager" });
      this.pagerTopEl = h("div", { className: "ordt-pager ordt-pager-top" });
      this.root.append(this.formEl, this.statusEl, this.pagerTopEl, this.listEl, this.pagerEl);
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
      if (map) this.footprintsLayer = new FootprintsLayer(map, (id) => this.focusRecord(id, true));
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
    this.field<HTMLInputElement>("invertOrganisation").checked = false;
    this.syncClearButtons();
    this.formEl.querySelector<HTMLDetailsElement>(".ordt-more")!.open = true;
    this.formEl.requestSubmit();
  }

  /** Hide an organisation (Organisation + Invert) and search again. */
  private excludeOrganisation(name: string): void {
    const input = this.field<HTMLInputElement>("organisation");
    const invert = this.field<HTMLInputElement>("invertOrganisation");
    // Already hiding: add to the list. Keeping some: switch to hiding this one.
    const names = invert.checked ? input.value.split(",").map((n) => n.trim()).filter(Boolean) : [];
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    input.value = names.join(", ");
    invert.checked = true;
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
    this.formEl.querySelector<HTMLInputElement>('input[name="text"]')!.value =
      example.text;
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
    spatialRel.hidden = true;
    spatialRel.setAttribute("aria-label", "Records whose extent");
    const whereSelect = select(WHERE_OPTIONS, "anywhere", {
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
      h("p", {}, "Dates of the resource, not of its metadata:"),
      h("ul", {}, ...DATE_HELP.map(([term, note]) => termItem(term, note))),
      h(
        "p",
        {},
        "Publishers usually fill in only one of the three: depending on the type, 44% to 64% of the records lack it, and a date range leaves them out. If you get few results, try another date type. With both dates empty there is no date filter.",
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
        className: "ordt-link",
        type: "button",
        disabled: true,
        title: "Copy a curl command that repeats this search in a terminal",
        onclick: () => this.copyQuery(),
      },
      "Copy query",
    );

    this.footprintsToggleEl = h(
      "button",
      { className: "ordt-link", type: "button", disabled: true, onclick: () => this.toggleFootprints() },
      "Hide footprints",
    );

    const form = h(
      "form",
      {
        className: "ordt-form",
        onsubmit: (event: Event) => {
          event.preventDefault();
          void this.search(1);
        },
      },
      h(
        "div",
        { className: "ordt-row" },
        h("input", {
          className: "ordt-input ordt-grow",
          name: "text",
          type: "search",
          placeholder: "Search titles, abstracts, keywords…",
          "aria-label": "Free text",
        }),
        h("button", { className: "ordt-button ordt-primary", type: "submit" }, "Search"),
      ),
      h(
        "div",
        { className: "ordt-row ordt-small" },
        radioGroup("textMode", TEXT_MODES, "all", () => undefined),
        helpToggle(modeHelp, "Help on search modes"),
      ),
      modeHelp,
      h(
        "div",
        { className: "ordt-label" },
        "Search in",
        h(
          "div",
          { className: "ordt-row" },
          fieldSelect,
          helpToggle(fieldHelp, "Help on search fields"),
        ),
      ),
      fieldHelp,
      h(
        "div",
        { className: "ordt-label" },
        "Record type",
        h(
          "div",
          { className: "ordt-row" },
          radioGroup("kind", KIND_OPTIONS, "all", toggleServiceTypes),
          helpToggle(resourcesHelp, "Help on record types"),
        ),
      ),
      resourcesHelp,
      serviceTypes,
      h(
        "div",
        { className: "ordt-label" },
        "Available as",
        h(
          "div",
          { className: "ordt-row" },
          h(
            "div",
            { className: "ordt-radios", role: "group", "aria-label": "Available as" },
            ...LINK_KINDS.map((kind) =>
              h(
                "label",
                { className: "ordt-radio" },
                h("input", { type: "checkbox", name: "availableAs", value: kind }),
                kind,
              ),
            ),
          ),
          helpToggle(availableAsHelp, "Help on available as"),
        ),
      ),
      availableAsHelp,
      h(
        "div",
        { className: "ordt-label" },
        "Where",
        h(
          "div",
          { className: "ordt-row" },
          whereSelect,
          helpToggle(whereHelp, "Help on search areas"),
        ),
      ),
      whereHelp,
      boxInput,
      spatialRel,
      h(
        "details",
        { className: "ordt-more" },
        h("summary", {}, "More filters"),
        h(
          "div",
          { className: "ordt-label" },
          "INSPIRE theme",
          h("div", { className: "ordt-row" }, themes, helpToggle(themeHelp, "Help on INSPIRE themes")),
        ),
        themeHelp,
        h(
          "div",
          { className: "ordt-label" },
          "Keywords (comma-separated, exact)",
          h(
            "div",
            { className: "ordt-row" },
            h("input", {
              className: "ordt-input ordt-grow",
              name: "keywords",
              placeholder: "opendata, Idrografia",
              "aria-label": "Keywords",
            }),
            helpToggle(keywordsHelp, "Help on keywords"),
          ),
        ),
        keywordsHelp,
        h(
          "div",
          { className: "ordt-label" },
          "Organisation (comma-separated)",
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
            helpToggle(organisationHelp, "Help on organisation"),
          ),
        ),
        organisationHelp,
        h(
          "label",
          { className: "ordt-check" },
          h("input", { type: "checkbox", name: "invertOrganisation" }),
          "Invert: hide these organisations",
        ),
        h(
          "div",
          { className: "ordt-row" },
          h(
            "label",
            { className: "ordt-check" },
            h("input", { type: "checkbox", name: "openData" }),
            "Open data only",
          ),
          helpToggle(openDataHelp, "Help on open data"),
        ),
        openDataHelp,
        h(
          "fieldset",
          { className: "ordt-fieldset" },
          h("legend", {}, "Date ", helpToggle(dateHelp, "Help on dates")),
          dateHelp,
          h("p", { className: "ordt-note" }, "Often missing: most records carry only one of these three dates."),
          select(DATE_FIELDS, "apiso_RevisionDate_dt", { name: "dateField", "aria-label": "Date type" }),
          h(
            "div",
            { className: "ordt-row" },
            h("input", { className: "ordt-input ordt-grow", type: "date", name: "dateFrom", "aria-label": "From" }),
            h("input", { className: "ordt-input ordt-grow", type: "date", name: "dateTo", "aria-label": "To" }),
          ),
        ),
        h(
          "div",
          { className: "ordt-label" },
          "Sort by",
          h(
            "div",
            { className: "ordt-row" },
            select(SORT_OPTIONS, "", { name: "sort", "aria-label": "Sort by" }),
            helpToggle(sortHelp, "Help on sorting"),
          ),
        ),
        sortHelp,
      ),
      h(
        "div",
        { className: "ordt-row ordt-small" },
        h("button", { className: "ordt-link", type: "reset", onclick: () => setTimeout(() => this.afterReset(), 0) }, "Reset"),
        h("button", { className: "ordt-link", type: "button", onclick: () => this.clearResults() }, "Clear results"),
        h("button", { className: "ordt-link", type: "button", onclick: () => this.zoomToResults() }, "Zoom to results"),
        this.footprintsToggleEl,
        this.copyQueryEl,
      ),
    );
    return form;
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

  private afterReset(): void {
    this.formEl.querySelector<HTMLElement>(".ordt-service-types")!.hidden = true;
    this.formEl.querySelector<HTMLElement>('input[name="box"]')!.hidden = true;
    this.formEl.querySelector<HTMLElement>(".ordt-spatial-rel")!.hidden = true;
    this.syncClearButtons();
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
    return this.formEl.querySelector<T>(`[name="${name}"]`)!;
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
    form.invertOrganisation = this.field<HTMLInputElement>("invertOrganisation").checked;
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
      this.records = page.records;
      this.total = page.total;
      this.start = start;
      this.copyQueryEl.disabled = false;
      this.expandedId = null;
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
    this.listEl.replaceChildren();
    this.pagerEl.replaceChildren();
    this.pagerTopEl.replaceChildren();
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
    for (const button of Array.from(this.listEl.querySelectorAll<HTMLButtonElement>(".ordt-footprint-toggle"))) {
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
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy query"), 1500);
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
        : `${this.start}-${end} of ${this.total.toLocaleString("en")} records`,
    );
    this.listEl.replaceChildren(...this.records.map((r) => this.renderRecord(r)));

    const pages = this.total > PAGE_SIZE;
    this.pagerTopEl.replaceChildren(...(pages ? this.pagerButtons(end) : []));
    this.pagerEl.replaceChildren(...(pages ? this.pagerButtons(end) : []));
  }

  /** Previous/Next for the current page; built twice, for the top and the bottom pager. */
  private pagerButtons(end: number): HTMLButtonElement[] {
    const go = (start: number) =>
      void this.search(start, this.lastForm ?? undefined).then(() =>
        // The new page starts from its first record, wherever the click came from.
        this.statusEl.scrollIntoView?.({ block: "nearest" }),
      );
    return [
      h("button", {
        className: "ordt-button",
        type: "button",
        disabled: this.start <= 1,
        onclick: () => go(Math.max(1, this.start - PAGE_SIZE)),
      }, "Previous"),
      h("button", {
        className: "ordt-button",
        type: "button",
        disabled: end >= this.total,
        onclick: () => go(this.start + PAGE_SIZE),
      }, "Next"),
    ];
  }

  private focusRecord(id: string, scroll: boolean): void {
    this.expandedId = id;
    this.footprintsLayer?.select(id);
    for (const li of Array.from(this.listEl.children) as HTMLElement[]) {
      const isTarget = li.dataset.id === id;
      li.classList.toggle("ordt-expanded", isTarget);
      const detail = li.querySelector<HTMLElement>(".ordt-detail");
      if (detail) detail.hidden = !isTarget;
      if (isTarget && scroll) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  private renderRecord(record: RndtRecord): HTMLElement {
    const kinds = Array.from(new Set(record.services.map((s) => s.kind)));
    const detail = h("div", { className: "ordt-detail", hidden: true }, ...this.renderDetail(record));
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
            if (this.expandedId === record.id) {
              this.expandedId = null;
              detail.hidden = true;
              li.classList.remove("ordt-expanded");
              this.footprintsLayer?.select(null);
              return;
            }
            this.focusRecord(record.id, false);
            if (record.bbox) this.app.fitBounds?.(record.bbox);
          },
        },
        record.title,
      ),
      h(
        "div",
        { className: "ordt-meta" },
        record.type && h("span", { className: "ordt-badge" }, record.type),
        ...kinds.map((k) => h("span", { className: "ordt-badge ordt-badge-service" }, k)),
        record.organisation &&
          h(
            "button",
            {
              className: "ordt-link ordt-org",
              type: "button",
              title: "Show only results from this organisation",
              onclick: () => this.filterByOrganisation(record.organisation),
            },
            record.organisation,
          ),
        record.organisation &&
          h(
            "button",
            {
              className: "ordt-link ordt-hide-org",
              type: "button",
              title: "Hide the results from this organisation",
              onclick: () => this.excludeOrganisation(record.organisation),
            },
            "Hide",
          ),
        record.modified && h("span", { className: "ordt-muted" }, record.modified),
      ),
      detail,
    );
    return li;
  }

  private renderDetail(record: RndtRecord): Child[] {
    const abstract = record.abstract.length > 500 ? `${record.abstract.slice(0, 500)}…` : record.abstract;
    return [
      abstract && h("p", { className: "ordt-abstract" }, abstract),
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
        { className: "ordt-row ordt-small" },
        record.bbox &&
          this.app.fitBounds &&
          h(
            "button",
            { className: "ordt-link", type: "button", onclick: () => this.app.fitBounds!(record.bbox!) },
            "Zoom to extent",
          ),
        record.bbox &&
          this.footprintsLayer &&
          h(
            "button",
            {
              className: "ordt-link ordt-footprint-toggle",
              type: "button",
              "data-id": record.id,
              disabled: !this.footprintsLayer.isVisible(),
              onclick: () => this.toggleFootprint(record.id),
            },
            this.footprintsLayer.isHidden(record.id) ? "Show footprint" : "Hide footprint",
          ),
        h("a", { className: "ordt-link", href: record.htmlUrl, target: "_blank", rel: "noopener" }, "Metadata"),
        h("a", { className: "ordt-link", href: record.xmlUrl, target: "_blank", rel: "noopener" }, "ISO XML"),
        this.copyButton(record.id, "Copy id"),
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

  private renderService(record: RndtRecord, service: ServiceGroup): HTMLElement {
    const area = h("div", { className: "ordt-service-area" });
    /** Run an action with its button disabled, so a slow server is not hit twice. */
    const busy = (action: () => Promise<void>) => (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      void action().finally(() => {
        button.disabled = false;
      });
    };
    const actions: Child[] = [];
    if (service.kind === "WMS" && this.app.addWmsLayer) {
      actions.push(h("button", { className: "ordt-button", type: "button", onclick: busy(() => this.openWms(record, service, area)) }, "Add to map…"));
    } else if (service.kind === "WFS" && this.app.addGeoJsonLayer) {
      actions.push(h("button", { className: "ordt-button", type: "button", onclick: busy(() => this.openWfs(record, service, area)) }, "Add to map…"));
    } else if (service.kind === "download" && isGeoJsonUrl(service.url) && this.app.addGeoJsonLayer) {
      actions.push(h("button", { className: "ordt-button", type: "button", onclick: busy(() => this.addGeoJson(record, service, area)) }, "Add to map"));
    }
    actions.push(h("a", { className: "ordt-link", href: service.url, target: "_blank", rel: "noopener" }, "Open"));
    actions.push(this.copyButton(service.url));
    return h(
      "li",
      { className: "ordt-service" },
      h("div", { className: "ordt-row" }, h("span", { className: "ordt-badge ordt-badge-service" }, service.kind), h("span", { className: "ordt-host", title: service.url }, host(service.url))),
      h("div", { className: "ordt-row ordt-small" }, ...actions),
      area,
    );
  }

  private note(area: HTMLElement, message: string, kind: "info" | "error" | "busy" = "info"): void {
    area.replaceChildren(h("p", { className: "ordt-note", "data-kind": kind }, message));
  }

  /**
   * Layer menu for a WMS/WFS (#7). Each entry shows the layer name as the
   * service gives it, with a readable name in brackets when there is one: the
   * capabilities title if it reads as a name, else a title from RNDT, looked up
   * in the background for the layers that still lack one; the labels update in
   * place and the selected layer does not change. Above FILTER_THRESHOLD layers
   * a filter field narrows the list.
   */
  private layerPicker(
    layers: { name: string; title: string }[],
    wanted: string | null,
    serviceUrl: string,
    ariaLabel: string,
  ): { picker: HTMLSelectElement; controls: HTMLElement[]; nameOf: (name: string) => string } {
    const readable = new Map(layers.map((l) => [l.name, readableTitle(l.name, l.title)]));
    const picker = select(
      layers.map((l) => ({ value: l.name, label: optionLabel(l.name, readable.get(l.name)!) })),
      layers.some((l) => l.name === wanted) ? wanted! : layers[0].name,
      { "aria-label": ariaLabel },
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
        let firstMatch: HTMLOptionElement | null = null;
        for (const option of Array.from(picker.options)) {
          const match = !needle || option.textContent!.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
          option.hidden = !match;
          if (match && !firstMatch) firstMatch = option;
        }
        // Keep a visible selection, so "Add" acts on something the user can see.
        if (picker.selectedOptions[0]?.hidden && firstMatch) {
          picker.value = firstMatch.value;
          picker.dispatchEvent(new Event("change"));
        }
      });
      controls.push(filter);
    }

    if (layers.some((l) => !readable.get(l.name))) {
      const status = h("p", { className: "ordt-note", "data-kind": "busy" }, "Looking up readable names in RNDT…");
      controls.push(status);
      const setTitle = (option: HTMLOptionElement, title: string) => {
        readable.set(option.value, title);
        option.textContent = optionLabel(option.value, title);
      };
      void lookupLayerTitles(this.app, RNDT_BASE_URL, serviceUrl).then((lookup) => {
        if (lookup.mode === "all") {
          let found = 0;
          for (const option of Array.from(picker.options)) {
            if (readable.get(option.value)) continue;
            const title = findTitle(lookup.found, option.value);
            if (!title) continue;
            setTitle(option, title);
            found++;
          }
          if (found) {
            status.dataset.kind = "info";
            status.textContent = `Readable names from RNDT for ${found.toLocaleString("en")} of ${layers.length.toLocaleString("en")} layers.`;
          } else {
            status.remove();
          }
          return;
        }
        // Too many RNDT records to download: look up the selected layer only,
        // now and on every change; each layer is asked once.
        const asked = new Set<string>();
        const lookupSelected = async () => {
          const option = picker.selectedOptions[0];
          if (!option || readable.get(option.value) || asked.has(option.value)) return;
          asked.add(option.value);
          status.dataset.kind = "busy";
          status.textContent = "Looking up the readable name of the selected layer in RNDT…";
          const title = await lookupOneLayerTitle(this.app, RNDT_BASE_URL, serviceUrl, option.value);
          if (title) setTitle(option, title);
          status.dataset.kind = "info";
          status.textContent = "Readable names are looked up in RNDT for the selected layer only.";
        };
        picker.addEventListener("change", () => void lookupSelected());
        void lookupSelected();
      });
    }

    return { picker, controls, nameOf: (name) => optionLabel(name, readable.get(name) ?? null) };
  }

  private async openWms(record: RndtRecord, service: ServiceGroup, area: HTMLElement): Promise<void> {
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
        this.note(area, "The WMS lists no named layers.", "error");
        return;
      }
      const wanted = service.layerHint ?? bestMatchingLayer(record.title, caps.layers);
      const { picker, controls, nameOf } = this.layerPicker(caps.layers, wanted, service.url, "WMS layer");
      const warning = h("p", { className: "ordt-note", "data-kind": "error", hidden: true });
      const add = h("button", { className: "ordt-button ordt-primary", type: "button" }, "Add layer");
      const check = () => {
        const layer = caps.layers.find((l) => l.name === picker.value)!;
        const ok = supportsWebMercator(layer);
        add.disabled = !ok;
        warning.hidden = ok;
        warning.textContent = ok
          ? ""
          : `This layer is not offered in EPSG:3857 (only ${layer.crs.slice(0, 6).join(", ")}${layer.crs.length > 6 ? ", …" : ""}). GeoLibre plugins cannot display it yet.`;
      };
      picker.addEventListener("change", check);
      add.addEventListener("click", () => {
        const layer = caps.layers.find((l) => l.name === picker.value)!;
        try {
          this.app.addWmsLayer!(nameOf(layer.name), {
            url: caps.getMapUrl,
            layers: layer.name,
            version: caps.version.startsWith("1.3") ? "1.3.0" : "1.1.1",
            format: "image/png",
            transparent: true,
            bounds: layer.bbox && !bboxError(layer.bbox) ? layer.bbox : undefined,
          });
          add.textContent = "Added";
          setTimeout(() => (add.textContent = "Add layer"), 2000);
        } catch (error) {
          warning.hidden = false;
          warning.textContent = `Could not add the layer: ${errorMessage(error)}`;
        }
      });
      area.replaceChildren(...controls.filter((c) => c.tagName === "INPUT"), h("div", { className: "ordt-row" }, picker, add), ...controls.filter((c) => c.tagName !== "INPUT"), warning);
      check();
    } catch (error) {
      this.note(area, `WMS error: ${errorMessage(error)}`, "error");
    }
  }

  private async openWfs(record: RndtRecord, service: ServiceGroup, area: HTMLElement): Promise<void> {
    this.note(area, "Reading the WFS capabilities…", "busy");
    try {
      const fetched = await fetchTextFrom(this.app, capabilitiesUrl(service.url, "WFS"));
      const caps = parseWfsCapabilities(fetched.text, fetched.url);
      caps.getFeatureUrl = upgradeToHttps(caps.getFeatureUrl, fetched.url);
      if (!caps.featureTypes.length) {
        this.note(area, "The WFS lists no feature types.", "error");
        return;
      }
      const format = pickJsonFormat(caps.outputFormats);
      if (!format) {
        this.note(area, "This WFS offers no GeoJSON output, so it cannot be added directly.", "error");
        return;
      }
      const wanted = service.layerHint ?? bestMatchingLayer(record.title, caps.featureTypes);
      const { picker, controls, nameOf } = this.layerPicker(caps.featureTypes, wanted, service.url, "WFS feature type");
      const inView = h("input", { type: "checkbox", checked: true });
      const add = h("button", { className: "ordt-button ordt-primary", type: "button" }, "Add features");
      const result = h("p", { className: "ordt-note", hidden: true });
      add.addEventListener("click", () => {
        void (async () => {
          const name = picker.value;
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
          } finally {
            add.disabled = false;
          }
        })();
      });
      area.replaceChildren(
        ...controls.filter((c) => c.tagName === "INPUT"),
        h("div", { className: "ordt-row" }, picker, add),
        ...controls.filter((c) => c.tagName !== "INPUT"),
        h("label", { className: "ordt-check ordt-small" }, inView, "Only features in the current map view"),
        result,
      );
    } catch (error) {
      this.note(area, `WFS error: ${errorMessage(error)}`, "error");
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
      this.note(area, `Could not add the file: ${errorMessage(error)}`, "error");
    }
  }
}
