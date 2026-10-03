/**
 * The recent searches of the panel: whole searches (text and filters, with the
 * box the search used) and records opened by id, newest first. They live in the
 * webview's localStorage, per user and per computer, never in a project.
 */
import { PLUGIN_ID } from "./constants";
import { parsePanelState } from "./project-state";
import type { SearchForm } from "./query";

export const HISTORY_KEY = `${PLUGIN_ID}:history`;
export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  /** A search, or a record opened by its id. */
  kind: "search" | "record";
  /** What to search again: always from page 1. */
  form: SearchForm;
  /** The filters in words, as the chips of the panel said them. */
  filters: string[];
  /** For a record: its id and the title read when it was opened. */
  recordId: string | null;
  title: string;
  /** Records found then. */
  total: number;
  /** ISO 8601, UTC. */
  time: string;
}

/**
 * The same record, or the same text and filters: the area is left out, or
 * "Map view" searched again after moving the map would fill the list with
 * entries that look the same.
 */
function sameSearch(a: HistoryEntry, b: HistoryEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "record") return a.recordId === b.recordId;
  return JSON.stringify({ ...a.form, bbox: null }) === JSON.stringify({ ...b.form, bbox: null });
}

/** The list with an entry on top: an older copy of the same search leaves, the oldest past the limit too. */
export function withEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...list.filter((e) => !sameSearch(e, entry))].slice(0, HISTORY_LIMIT);
}

/** The list with its first entry replaced: for a change of the search on screen (a page, the order, a filter removed). */
export function withTopUpdated(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return withEntry(list.slice(1), entry);
}

export function withoutEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return list.filter((e) => e !== entry);
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read the stored list. It can be edited by hand: what cannot be read is dropped. */
export function loadHistory(): HistoryEntry[] {
  let stored: unknown;
  try {
    stored = JSON.parse(storage()?.getItem(HISTORY_KEY) ?? "null");
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const list: HistoryEntry[] = [];
  for (const raw of stored) {
    const state = parsePanelState({ v: 1, form: (raw as { form?: unknown } | null)?.form });
    if (!state) continue;
    const item = raw as Record<string, unknown>;
    const recordId = item.kind === "record" && typeof item.recordId === "string" && item.recordId ? item.recordId : null;
    list.push({
      kind: recordId ? "record" : "search",
      form: state.form,
      filters: Array.isArray(item.filters) ? item.filters.filter((f): f is string => typeof f === "string") : [],
      recordId,
      title: typeof item.title === "string" ? item.title : "",
      total: typeof item.total === "number" && item.total >= 0 ? item.total : 0,
      time: typeof item.time === "string" && !Number.isNaN(Date.parse(item.time)) ? item.time : new Date(0).toISOString(),
    });
  }
  return list.slice(0, HISTORY_LIMIT);
}

export function saveHistory(list: HistoryEntry[]): void {
  try {
    storage()?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the list lasts for this session only.
  }
}

export function clearHistory(): void {
  try {
    storage()?.removeItem(HISTORY_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** Whether an entry holds the letters typed, in its text, title, id or filters. */
export function matchesEntry(entry: HistoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = entry.kind === "record" ? "" : entry.form.text;
  return [text, entry.title, entry.recordId ?? "", ...entry.filters].join(" ").toLowerCase().includes(q);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "15:42" today, "Yesterday", then the date, in the time of the computer. */
export function whenLabel(time: string, now = new Date()): string {
  const then = new Date(time);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days <= 0) return `${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (days === 1) return "Yesterday";
  return `${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())}`;
}
