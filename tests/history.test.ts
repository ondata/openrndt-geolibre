import { beforeEach, describe, expect, it } from "vitest";
import { HISTORY_LIMIT, clearHistory, loadHistory, matchesEntry, saveHistory, whenLabel, withEntry, withTopUpdated, withoutEntry, type HistoryEntry } from "../src/rndt/history";
import { emptyForm, type Bbox } from "../src/rndt/query";
import { loadSettings, saveSettings } from "../src/rndt/settings";

const search = (text: string, patch: Partial<HistoryEntry> = {}, bbox: Bbox | null = null): HistoryEntry => ({
  kind: "search",
  form: { ...emptyForm(), text, bbox },
  filters: bbox ? ["Map view"] : [],
  recordId: null,
  title: "",
  total: 10,
  time: "2026-10-03T14:00:00.000Z",
  ...patch,
});
const record = (id: string, title: string): HistoryEntry => ({ ...search(`fileid:"${id}"`), kind: "record", recordId: id, title, total: 1 });

describe("history of searches (#25)", () => {
  beforeEach(() => localStorage.clear());

  it("puts a new search on top, and a repeated one back on top with its newer area, total and time", () => {
    let list = withEntry([], search("alberi"));
    list = withEntry(list, search("ortofoto", {}, [1, 2, 3, 4]));
    expect(list.map((e) => e.form.text)).toEqual(["ortofoto", "alberi"]);
    list = withEntry(list, search("alberi", { total: 12, time: "2026-10-03T15:00:00.000Z" }));
    expect(list.map((e) => [e.form.text, e.total])).toEqual([["alberi", 12], ["ortofoto", 10]]);
    // The same text and filters over another area are the same search: the newer area stays.
    list = withEntry(list, search("ortofoto", {}, [5, 6, 7, 8]));
    expect(list.map((e) => e.form.text)).toEqual(["ortofoto", "alberi"]);
    expect(list[0].form.bbox).toEqual([5, 6, 7, 8]);
    // Another filter makes another search.
    list = withEntry(list, search("ortofoto", { form: { ...emptyForm(), text: "ortofoto", availableAs: ["WMS"] } }));
    expect(list).toHaveLength(3);
  });

  it("keeps a record by its id, apart from the searches", () => {
    let list = withEntry([], record("x:1", "Carta"));
    list = withEntry(list, search("alberi"));
    list = withEntry(list, record("x:1", "Carta, nuovo titolo"));
    expect(list.map((e) => [e.kind, e.title || e.form.text])).toEqual([["record", "Carta, nuovo titolo"], ["search", "alberi"]]);
  });

  it("keeps the last 20, updates the one on top, removes one", () => {
    let list: HistoryEntry[] = [];
    for (let i = 1; i <= HISTORY_LIMIT + 1; i++) list = withEntry(list, search(`s${i}`));
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect([list[0].form.text, list.at(-1)!.form.text]).toEqual(["s21", "s2"]);
    // A change of the search on screen takes the place of the entry on top, and of an older copy of itself.
    list = withTopUpdated(list, search("s5", { total: 3 }));
    expect(list).toHaveLength(HISTORY_LIMIT - 1);
    expect([list[0].form.text, list[0].total, list[1].form.text]).toEqual(["s5", 3, "s20"]);
    expect(withTopUpdated([], search("a")).map((e) => e.form.text)).toEqual(["a"]);
    expect(withoutEntry(list, list[1]).map((e) => e.form.text).slice(0, 2)).toEqual(["s5", "s19"]);
  });

  it("is stored on the computer, and a broken or foreign value gives an empty list", () => {
    expect(loadHistory()).toEqual([]);
    saveHistory([record("x:1", "Carta"), search("alberi", {}, [1, 2, 3, 4])]);
    expect(loadHistory().map((e) => [e.kind, e.recordId, e.form.bbox])).toEqual([["record", "x:1", null], ["search", null, [1, 2, 3, 4]]]);
    localStorage.setItem("openrndt-geolibre:history", "{not json");
    expect(loadHistory()).toEqual([]);
    localStorage.setItem("openrndt-geolibre:history", JSON.stringify([{ kind: "search" }, 3, search("ok"), { ...search("x"), form: { text: 5, bbox: "no" } }]));
    // What can be read is kept; a field of the wrong type falls back to the default.
    expect(loadHistory().map((e) => e.form.text)).toEqual(["ok", ""]);
    clearHistory();
    expect(localStorage.getItem("openrndt-geolibre:history")).toBeNull();
  });

  it("is found by the letters of text, title, id or filters", () => {
    const entry = search("ortofoto", { filters: ["WMS", "Only: Regione Piemonte"] });
    expect([matchesEntry(entry, "orto"), matchesEntry(entry, "PIEMONTE"), matchesEntry(entry, "lazio"), matchesEntry(entry, " ")]).toEqual([true, true, false, true]);
    expect([matchesEntry(record("r_lazio:cf08", "pericolosita"), "lazio"), matchesEntry(record("r_lazio:cf08", "pericolosita"), "peric")]).toEqual([true, true]);
  });

  it("says when: the time today, Yesterday, then the date", () => {
    const now = new Date(2026, 9, 3, 17, 0);
    expect(whenLabel(new Date(2026, 9, 3, 15, 42).toISOString(), now)).toBe("15:42");
    expect(whenLabel(new Date(2026, 9, 2, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(whenLabel(new Date(2026, 9, 1, 9, 5).toISOString(), now)).toBe("2026-10-01");
  });

  it("is on by default, and can be turned off in the settings", () => {
    expect(loadSettings().rememberSearches).toBe(true);
    saveSettings({ ...loadSettings(), rememberSearches: false });
    expect(loadSettings()).toEqual({ logErrors: false, rememberSearches: false });
  });
});
