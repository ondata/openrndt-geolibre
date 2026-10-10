import { bboxError, emptyForm, type Bbox, type SearchForm } from "./query";

/**
 * What the panel saves in a GeoLibre project (`plugins.settings[<plugin id>]`):
 * the last search, its page and the open record. The results are not saved:
 * the search runs again when the project is reopened. The area is the box the
 * search used, so "Current map view" comes back as that box and finds the
 * same records in a window of another size.
 */
export interface PanelState {
  v: 1;
  form: SearchForm;
  /** First result of the page, from 1. */
  start: number;
  /** The record open in the detail view, or null. */
  recordId: string | null;
}

const KINDS = ["all", "data", "services"];
const TEXT_MODES = ["all", "any", "lucene"];
const SPATIAL_RELS = ["Intersects", "Within"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;

/**
 * Read a saved state. A project file can be edited by anyone: a value of the
 * wrong type falls back to the form's default, a state of another version or
 * shape gives null.
 */
export function parsePanelState(raw: unknown): PanelState | null {
  if (!isObject(raw) || raw.v !== 1 || !isObject(raw.form)) return null;
  const saved = raw.form;
  const form = emptyForm();
  const target = form as unknown as Record<string, unknown>;
  for (const key of ["text", "field", "keywords", "organisation", "ipa", "dateField", "dateFrom", "dateTo", "sort"]) {
    if (typeof saved[key] === "string") target[key] = saved[key];
  }
  for (const key of ["invertOrganisation", "openDataOnly"]) {
    if (typeof saved[key] === "boolean") target[key] = saved[key];
  }
  for (const key of ["serviceTypes", "availableAs", "inspireThemes"]) {
    const list = strings(saved[key]);
    if (list) target[key] = list;
  }
  if (KINDS.includes(saved.kind as string)) target.kind = saved.kind;
  if (TEXT_MODES.includes(saved.textMode as string)) target.textMode = saved.textMode;
  if (SPATIAL_RELS.includes(saved.spatialRel as string)) target.spatialRel = saved.spatialRel;
  if (Array.isArray(saved.bbox) && !bboxError(saved.bbox as Bbox)) form.bbox = saved.bbox as Bbox;
  const start = Number.isInteger(raw.start) && (raw.start as number) >= 1 ? (raw.start as number) : 1;
  const recordId = typeof raw.recordId === "string" && raw.recordId ? raw.recordId : null;
  return { v: 1, form, start, recordId };
}
