import { describe, expect, it } from "vitest";
import { parsePanelState, type PanelState } from "../src/rndt/project-state";
import { emptyForm } from "../src/rndt/query";

const state = (): PanelState => ({
  v: 1,
  form: {
    ...emptyForm(),
    kind: "services",
    serviceTypes: ["view"],
    availableAs: ["WMS"],
    text: "catastale",
    textMode: "any",
    field: "title",
    keywords: "catasto",
    organisation: "Agenzia delle Entrate",
    invertOrganisation: true,
    inspireThemes: ["Parcelle catastali"],
    openDataOnly: true,
    dateFrom: "2024-01-01",
    dateTo: "2025-01-01",
    bbox: [12.95, 37.6, 14.3, 38.3],
    spatialRel: "Within",
    sort: "title_sort:asc",
  },
  start: 21,
  recordId: "c_l219:a883ab12",
});

describe("parsePanelState", () => {
  it("gives back a state that went through JSON", () => {
    expect(parsePanelState(JSON.parse(JSON.stringify(state())))).toEqual(state());
  });

  it("refuses what is not a state of this version", () => {
    for (const raw of [undefined, null, "x", 3, [], {}, { v: 2, form: {} }, { v: 1 }, { v: 1, form: [] }]) {
      expect(parsePanelState(raw)).toBeNull();
    }
  });

  it("falls back to the form's defaults for missing fields and wrong types", () => {
    const parsed = parsePanelState({
      v: 1,
      form: { text: 5, kind: "everything", textMode: "regex", availableAs: "WMS", openDataOnly: "yes", bbox: [1, 2, 3], spatialRel: "Near" },
      start: 0,
      recordId: 7,
    });
    expect(parsed).toEqual({ v: 1, form: emptyForm(), start: 1, recordId: null });
    expect(parsePanelState({ v: 1, form: { text: "ortofoto" } })).toEqual({
      v: 1,
      form: { ...emptyForm(), text: "ortofoto" },
      start: 1,
      recordId: null,
    });
  });

  it("drops a box that is not valid", () => {
    expect(parsePanelState({ v: 1, form: { bbox: [13, 37, 12, 38] } })!.form.bbox).toBeNull();
    expect(parsePanelState({ v: 1, form: { bbox: [12, 37, 200, 38] } })!.form.bbox).toBeNull();
    expect(parsePanelState({ v: 1, form: { bbox: ["12", 37, 13, 38] } })!.form.bbox).toBeNull();
  });
});
