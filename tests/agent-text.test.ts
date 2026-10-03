import { describe, expect, it } from "vitest";
import { agentText } from "../src/rndt/agent-text";
import { RNDT_BASE_URL } from "../src/rndt/constants";
import { buildCurlCommand, emptyForm } from "../src/rndt/query";
import type { RndtRecord } from "../src/rndt/records";

const record = (patch: Partial<RndtRecord>): RndtRecord => ({
  id: "x:1",
  title: "Carta",
  abstract: "Un abstract lungo che non va nel testo.",
  type: "dataset",
  organisation: "Regione Esempio",
  contactEmails: [],
  modified: "",
  bbox: null,
  services: [],
  otherLinks: [],
  htmlUrl: "",
  xmlUrl: "",
  ...patch,
});
const now = new Date("2026-10-03T14:20:30Z");

describe("copy for an agent (#23)", () => {
  it("writes the search in words, the same curl as the button, and the records as a table", () => {
    const form = {
      ...emptyForm(),
      text: "idrografia fiumi",
      bbox: [1.0835, 34.3633, 23.9165, 49.0617] as [number, number, number, number],
      availableAs: ["WMS" as const],
    };
    const records = [
      record({ id: "r_sardeg:1", title: "FIUMI | TORRENTI", services: [{ kind: "WFS", url: "a" }, { kind: "WMS", url: "b" }, { kind: "WMS", url: "c" }] }),
      record({ id: "r_vda:2", title: "Idrografia\nlineare", organisation: "" }),
    ];
    const text = agentText({ form, records, total: 412, start: 21, num: 20 }, now);
    const lines = text.split("\n");
    expect(lines[0]).toBe('# RNDT search: "idrografia fiumi"');
    expect(text).toContain("Search made in the openrndt-geolibre panel (GeoLibre), 2026-10-03 14:20 UTC:");
    expect(text).toContain("- Text: idrografia fiumi (all words, anywhere in the record)");
    // The map view is given as numbers: an agent does not see the map.
    expect(text).toContain("- Area: bbox 1.0835,34.3633,23.9165,49.0617 (west,south,east,north, EPSG:4326), records that touch it");
    expect(text).toContain("- Available as: WMS");
    expect(text).toContain("- Sort: relevance");
    expect(text).toContain("- Results: 412; this is page 2 (records 21-22)");
    expect(text).toContain(`\`\`\`sh\n${buildCurlCommand(RNDT_BASE_URL, form, 21, 20)}\n\`\`\``);
    expect(text).toContain("- Next page: start=41, then steps of 20.");
    expect(text).toContain("- ISO XML of a record: https://geodati.gov.it/RNDT/rest/metadata/item/<id>/xml");
    // One row per record: no abstract, each kind once, a | and a line break kept out of the table.
    expect(text).toContain("| r_sardeg:1 | FIUMI \\| TORRENTI | Regione Esempio | WFS, WMS |");
    expect(text).toContain("| r_vda:2 | Idrografia lineare |  |  |");
    expect(text).not.toContain("abstract lungo");
    expect(text).toContain("https://github.com/ondata/openrndt");
  });

  it("names every filter of the form, and has a plain title with no text", () => {
    const form = {
      ...emptyForm(),
      kind: "data" as const,
      textMode: "any" as const,
      inspireThemes: ["Idrografia"],
      keywords: "opendata",
      organisation: "entrate",
      invertOrganisation: true,
      openDataOnly: true,
      dateField: "apiso_PublicationDate_dt",
      dateFrom: "2024-01-01",
      sort: "title:asc",
      bbox: [12, 41, 13, 42] as [number, number, number, number],
      spatialRel: "Within" as const,
    };
    const text = agentText({ form, records: [record({})], total: 1, start: 1, num: 20 }, now);
    expect(text.split("\n")[0]).toBe("# RNDT search");
    expect(text).not.toContain("- Text:");
    for (const row of [
      "- Type: data (datasets and series)",
      "- Area: bbox 12,41,13,42 (west,south,east,north, EPSG:4326), records entirely inside it",
      "- INSPIRE theme: Idrografia",
      "- Open data only: records whose publisher filled in the open data field",
      "- Keywords (exact): opendata",
      "- Organisation left out (name contains): entrate",
      "- Publication date: from 2024-01-01 to any",
      "- Sort: Title A-Z",
      "- Results: 1; this is page 1 (records 1-1)",
    ]) {
      expect(text).toContain(row);
    }
  });
});
