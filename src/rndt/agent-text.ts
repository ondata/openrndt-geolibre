/**
 * "Copy for an agent": a search made in the panel as Markdown, to hand to an
 * AI agent (or to a colleague): what was searched, in words and numbers, the
 * request that repeats it, the records of the page and how to go on outside
 * GeoLibre. Structure in English, the catalogue's content in Italian.
 */
import { DATE_FIELDS, RNDT_BASE_URL, SEARCH_FIELDS, SERVICE_TYPES, SORT_OPTIONS } from "./constants";
import { buildCurlCommand, type SearchForm } from "./query";
import type { RndtRecord } from "./records";

export interface AgentPage {
  form: SearchForm;
  records: RndtRecord[];
  total: number;
  /** 1-based index of the first record of the page. */
  start: number;
  /** Records asked per page. */
  num: number;
}

const TEXT_MODES: Record<SearchForm["textMode"], string> = {
  all: "all words",
  any: "any word",
  lucene: "Lucene syntax",
};

function labelOf(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** The filters of a form, one row each, in words: what the chips of the panel say, with the numbers. */
function filterRows(form: SearchForm): string[] {
  const rows: string[] = [];
  const text = form.text.trim();
  if (text) {
    const where = form.field ? `in: ${labelOf(SEARCH_FIELDS, form.field)}` : "anywhere in the record";
    rows.push(`Text: ${text} (${TEXT_MODES[form.textMode]}${form.textMode === "lucene" ? "" : `, ${where}`})`);
  }
  if (form.kind === "data") rows.push("Type: data (datasets and series)");
  if (form.kind === "services") {
    const types = form.serviceTypes.map((t) => labelOf(SERVICE_TYPES, t));
    rows.push(`Type: services${types.length ? ` (${types.join(", ")})` : ""}`);
  }
  if (form.bbox) {
    const rel = form.spatialRel === "Within" ? "records entirely inside it" : "records that touch it";
    rows.push(`Area: bbox ${form.bbox.join(",")} (west,south,east,north, EPSG:4326), ${rel}`);
  }
  if (form.availableAs.length) rows.push(`Available as: ${form.availableAs.join(" or ")}`);
  if (form.kind !== "services") {
    if (form.inspireThemes.length) rows.push(`INSPIRE theme: ${form.inspireThemes.join(", ")}`);
    if (form.openDataOnly) rows.push("Open data only: records whose publisher filled in the open data field");
  }
  if (form.keywords.trim()) rows.push(`Keywords (exact): ${form.keywords.trim()}`);
  if (form.ipa.trim()) rows.push(`IPA code of the owner (record id prefix): ${form.ipa.trim()}`);
  if (form.organisation.trim()) {
    rows.push(`Organisation ${form.invertOrganisation ? "left out" : "kept"} (name contains): ${form.organisation.trim()}`);
  }
  if (form.dateFrom || form.dateTo) {
    rows.push(`${labelOf(DATE_FIELDS, form.dateField)} date: from ${form.dateFrom || "any"} to ${form.dateTo || "any"}`);
  }
  rows.push(`Sort: ${form.sort ? labelOf(SORT_OPTIONS, form.sort) : "relevance"}`);
  return rows;
}

/** A value inside a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

export function agentText(page: AgentPage, now = new Date()): string {
  const { form, records, total, start, num } = page;
  const text = form.text.trim();
  const end = start + records.length - 1;
  const base = RNDT_BASE_URL.replace(/\/+$/, "");
  return [
    text ? `# RNDT search: "${text}"` : "# RNDT search",
    "",
    "RNDT (Repertorio Nazionale dei Dati Territoriali) is the Italian national catalogue of geospatial metadata, run by AgID. Records are ISO 19115 metadata of datasets and services published by Italian public bodies; their content is in Italian.",
    "",
    `Search made in the openrndt-geolibre panel (GeoLibre), ${now.toISOString().slice(0, 16).replace("T", " ")} UTC:`,
    ...filterRows(form).map((row) => `- ${row}`),
    `- Results: ${total.toLocaleString("en")}; this is page ${Math.floor((start - 1) / num) + 1} (records ${start}-${end})`,
    "",
    "## Same request",
    "",
    "```sh",
    buildCurlCommand(RNDT_BASE_URL, form, start, num),
    "```",
    "",
    `- Next page: start=${start + num}, then steps of ${num}. A larger num gives more records in one answer.`,
    '- One record: q=fileid:"<id>", with no other filter.',
    `- ISO XML of a record: ${base}/rest/metadata/item/<id>/xml (the id URL-encoded)`,
    "",
    "## Results on this page",
    "",
    "| id | title | organisation | available as |",
    "|---|---|---|---|",
    ...records.map((r) => {
      const kinds = Array.from(new Set(r.services.map((s) => s.kind)));
      return `| ${cell(r.id)} | ${cell(r.title)} | ${cell(r.organisation)} | ${cell(kinds.join(", "))} |`;
    }),
    "",
    "## Going further",
    "",
    "openrndt is a command line tool for the same catalogue (https://github.com/ondata/openrndt): many records as CSV or JSON, footprints as GeoJSON, a record in full, the services of a record checked. If it is installed, prefer it to raw requests.",
  ].join("\n");
}
