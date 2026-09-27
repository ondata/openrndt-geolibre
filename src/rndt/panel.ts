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
import { drawnBbox, fetchJson, fetchTextFrom, GEO_EDITOR_PLUGIN_ID, type RndtHost } from "./host";
import {
  bestMatchingLayer,
  buildGetFeatureUrl,
  capabilitiesUrl,
  fixAxisOrder,
  parseWfsCapabilities,
  parseWmsCapabilities,
  pickJsonFormat,
  preselectedName,
  serviceBaseUrl,
  supportsWebMercator,
  upgradeToHttps,
} from "./ogc";
import { bboxError, buildSearchUrl, clampBbox, emptyForm, type Bbox, type ResourceKind, type SearchForm, type TextMode } from "./query";
import { footprints, parseSearchResponse, type RndtRecord, type RndtService } from "./records";

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
        key = `${service.kind} ${serviceBaseUrl(service.url).toLowerCase()}`;
      } catch {
        // Not a parseable URL: keep it on its own.
      }
    }
    const hint = preselectedName(service.url);
    const existing = groups.get(key);
    if (existing) {
      existing.layerHint ??= hint;
    } else {
      groups.set(key, { ...service, layerHint: hint });
    }
  }
  return Array.from(groups.values());
}

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
    note: "four numbers in degrees (WGS84): west, south, east, north. Example, Palermo:",
    box: "13.30, 38.08, 13.40, 38.16",
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
const WHERE_OPTIONS: Option[] = [
  { value: "anywhere", label: "Anywhere" },
  { value: "view", label: "Current map view" },
  { value: "drawn", label: "Drawn shapes (GeoEditor)" },
  { value: "box", label: "Box (west, south, east, north)" },
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
  private footprintsLayer: FootprintsLayer | null = null;
  private records: RndtRecord[] = [];
  private total = 0;
  private start = 1;
  private expandedId: string | null = null;
  private requestSeq = 0;
  private lastForm: SearchForm | null = null;

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
      this.root.append(this.formEl, this.statusEl, this.listEl, this.pagerEl);
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
    const whereSelect = select(WHERE_OPTIONS, "anywhere", {
      name: "where",
      "aria-label": "Where",
      onchange: () => {
        boxInput.hidden = whereSelect.value !== "box";
        if (whereSelect.value === "drawn") void this.prepareDrawing();
      },
    });

    const themes = select([{ value: "", label: "Any theme" }, ...INSPIRE_THEMES], "", { name: "theme" });

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
        "A record is found when its extent, a rectangle, touches the area: national and regional records show up too. In the Palermo box, catastale finds the Palermo cadastral map and the national cadastral services.",
      ),
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
      h("div", { className: "ordt-label" }, "Resources", radioGroup("kind", KIND_OPTIONS, "all", toggleServiceTypes)),
      serviceTypes,
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
      h(
        "details",
        { className: "ordt-more" },
        h("summary", {}, "More filters"),
        h("label", { className: "ordt-label" }, "INSPIRE theme", themes),
        h(
          "label",
          { className: "ordt-label" },
          "Keywords (comma-separated, exact)",
          h("input", { className: "ordt-input", name: "keywords", placeholder: "opendata, Idrografia" }),
        ),
        h(
          "label",
          { className: "ordt-label" },
          "Organisation",
          h("input", { className: "ordt-input", name: "organisation", placeholder: "Regione Piemonte" }),
        ),
        h(
          "label",
          { className: "ordt-check" },
          h("input", { type: "checkbox", name: "openData" }),
          "Open data only",
        ),
        h(
          "fieldset",
          { className: "ordt-fieldset" },
          h("legend", {}, "Date"),
          select(DATE_FIELDS, "apiso_RevisionDate_dt", { name: "dateField", "aria-label": "Date type" }),
          h(
            "div",
            { className: "ordt-row" },
            h("input", { className: "ordt-input ordt-grow", type: "date", name: "dateFrom", "aria-label": "From" }),
            h("input", { className: "ordt-input ordt-grow", type: "date", name: "dateTo", "aria-label": "To" }),
          ),
          h(
            "label",
            { className: "ordt-check" },
            h("input", { type: "checkbox", name: "includeMissing", checked: true }),
            "Include records without this date",
          ),
        ),
        h("label", { className: "ordt-label" }, "Sort by", select(SORT_OPTIONS, "", { name: "sort" })),
      ),
      h(
        "div",
        { className: "ordt-row ordt-small" },
        h("button", { className: "ordt-link", type: "reset", onclick: () => setTimeout(() => this.afterReset(), 0) }, "Reset"),
        h("button", { className: "ordt-link", type: "button", onclick: () => this.clearResults() }, "Clear results"),
        h("button", { className: "ordt-link", type: "button", onclick: () => this.zoomToResults() }, "Zoom to results"),
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
    form.serviceTypes = Array.from(
      this.formEl.querySelectorAll<HTMLInputElement>('input[name="serviceType"]:checked'),
      (el) => el.value,
    );
    const theme = this.field<HTMLSelectElement>("theme").value;
    form.inspireThemes = theme ? [theme] : [];
    form.keywords = this.field<HTMLInputElement>("keywords").value;
    form.organisation = this.field<HTMLInputElement>("organisation").value;
    form.openDataOnly = this.field<HTMLInputElement>("openData").checked;
    form.dateField = this.field<HTMLSelectElement>("dateField").value;
    form.dateFrom = this.field<HTMLInputElement>("dateFrom").value;
    form.dateTo = this.field<HTMLInputElement>("dateTo").value;
    form.includeMissingDates = this.field<HTMLInputElement>("includeMissing").checked;
    form.sort = this.field<HTMLSelectElement>("sort").value;
    form.bbox = this.readWhere(this.field<HTMLSelectElement>("where").value as Where);
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
      const page = parseSearchResponse(await fetchJson(this.app, url), RNDT_BASE_URL);
      if (seq !== this.requestSeq) return; // a newer search is running
      this.lastForm = current;
      this.records = page.records;
      this.total = page.total;
      this.start = start;
      this.expandedId = null;
      this.footprintsOverlay()?.setData(footprints(page.records));
      this.renderResults();
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
    if (!this.root) return;
    this.listEl.replaceChildren();
    this.pagerEl.replaceChildren();
    this.setStatus("Results cleared.");
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

    const prev = h("button", {
      className: "ordt-button",
      type: "button",
      disabled: this.start <= 1,
      onclick: () => void this.search(Math.max(1, this.start - PAGE_SIZE), this.lastForm ?? undefined),
    }, "Previous");
    const next = h("button", {
      className: "ordt-button",
      type: "button",
      disabled: end >= this.total,
      onclick: () => void this.search(this.start + PAGE_SIZE, this.lastForm ?? undefined),
    }, "Next");
    this.pagerEl.replaceChildren(...(this.total > PAGE_SIZE ? [prev, next] : []));
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
        record.organisation && h("span", {}, record.organisation),
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
        : h("p", { className: "ordt-muted" }, "No services or downloads declared in this record."),
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

  private async openWms(record: RndtRecord, service: ServiceGroup, area: HTMLElement): Promise<void> {
    this.note(area, "Reading the WMS capabilities…", "busy");
    try {
      const fetched = await fetchTextFrom(this.app, capabilitiesUrl(service.url, "WMS"));
      const caps = parseWmsCapabilities(fetched.text, fetched.url);
      caps.getMapUrl = upgradeToHttps(caps.getMapUrl, fetched.url);
      if (!caps.layers.length) {
        this.note(area, "The WMS lists no named layers.", "error");
        return;
      }
      const wanted = service.layerHint ?? bestMatchingLayer(record.title, caps.layers);
      const picker = select(
        caps.layers.map((l) => ({ value: l.name, label: l.title === l.name ? l.name : `${l.title} (${l.name})` })),
        caps.layers.some((l) => l.name === wanted) ? wanted! : caps.layers[0].name,
        { "aria-label": "WMS layer" },
      );
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
          this.app.addWmsLayer!(layer.title, {
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
      area.replaceChildren(h("div", { className: "ordt-row" }, picker, add), warning);
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
      const picker = select(
        caps.featureTypes.map((f) => ({ value: f.name, label: f.title === f.name ? f.name : `${f.title} (${f.name})` })),
        caps.featureTypes.some((f) => f.name === wanted) ? wanted! : caps.featureTypes[0].name,
        { "aria-label": "WFS feature type" },
      );
      const inView = h("input", { type: "checkbox", checked: true });
      const add = h("button", { className: "ordt-button ordt-primary", type: "button" }, "Add features");
      const result = h("p", { className: "ordt-note", hidden: true });
      add.addEventListener("click", () => {
        void (async () => {
          const name = picker.value;
          const bbox = inView.checked ? this.app.getViewBounds?.() ?? null : null;
          const url = buildGetFeatureUrl(caps, name, {
            format,
            maxFeatures: WFS_MAX_FEATURES,
            bbox: bbox ? clampBbox(bbox) : null,
          });
          add.disabled = true;
          result.hidden = false;
          result.dataset.kind = "busy";
          result.textContent = "Downloading features…";
          try {
            const data = await fetchJson(this.app, url);
            if (!isFeatureCollection(data)) throw new Error("the response is not a GeoJSON FeatureCollection");
            if (!data.features.length) {
              result.dataset.kind = "info";
              result.textContent = inView.checked
                ? "No features in the current map view."
                : "The service returned no features.";
              return;
            }
            const title = caps.featureTypes.find((f) => f.name === name)?.title ?? name;
            this.app.addGeoJsonLayer!(title || record.title, fixAxisOrder(data));
            result.dataset.kind = "info";
            result.textContent =
              data.features.length >= WFS_MAX_FEATURES
                ? `Added ${data.features.length} features: limit reached, zoom in for complete data.`
                : `Added ${data.features.length} features.`;
          } catch (error) {
            result.dataset.kind = "error";
            result.textContent = `WFS error: ${errorMessage(error)}`;
          } finally {
            add.disabled = false;
          }
        })();
      });
      area.replaceChildren(
        h("div", { className: "ordt-row" }, picker, add),
        h("label", { className: "ordt-check ordt-small" }, inView, "Only features in the current map view"),
        result,
      );
    } catch (error) {
      this.note(area, `WFS error: ${errorMessage(error)}`, "error");
    }
  }

  private async addGeoJson(record: RndtRecord, service: RndtService, area: HTMLElement): Promise<void> {
    this.note(area, "Downloading GeoJSON…", "busy");
    try {
      const data = await fetchJson(this.app, service.url);
      if (!isFeatureCollection(data)) throw new Error("the file is not a GeoJSON FeatureCollection");
      this.app.addGeoJsonLayer!(record.title, fixAxisOrder(data));
      this.note(area, `Added ${data.features.length} features.`);
    } catch (error) {
      this.note(area, `Could not add the file: ${errorMessage(error)}`, "error");
    }
  }
}
