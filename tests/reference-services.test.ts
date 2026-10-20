import { describe, expect, it } from "vitest";
import { reference } from "./reference-services";

/** Kinds of try and how many references each needs; the two with one are known gaps (#60). */
const NEEDED: Record<string, number> = {
  wms: 2,
  "wfs-small": 2,
  "wfs-large": 2,
  "arcgis-image": 2,
  "arcgis-features": 2,
  "no-cors": 2,
  "gml-only": 2,
  "host-missing": 2,
  "no-answer": 2,
  "not-3857": 1,
  "http-only": 1,
};

describe("reference services (#60)", () => {
  const entries = [...reference.services, ...reference.failures];

  it("has unique ids and dated checks", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of entries) expect(e.checked, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers every kind of try, twice where found", () => {
    for (const [use, count] of Object.entries(NEEDED)) {
      expect(entries.filter((e) => e.uses.includes(use)).length, use).toBeGreaterThanOrEqual(count);
    }
    for (const e of entries) for (const use of e.uses) expect(Object.keys(NEEDED), `${e.id}: ${use}`).toContain(use);
  });

  it("gives what a try needs: a record, a layer to draw, a feature count", () => {
    for (const s of reference.services) {
      expect(s.recordId, s.id).toMatch(/^[^\s:]+:\S+$/);
      // Only the http-only reference is plain http: an https page cannot load it.
      expect(new URL(s.url).protocol, s.id).toBe(s.uses.includes("http-only") ? "http:" : "https:");
      if (s.uses.includes("wms") || s.uses.includes("not-3857")) {
        expect(s.layer, s.id).toBeTruthy();
        expect(s.bbox3857, s.id).toHaveLength(4);
      }
      if (s.uses.some((u) => u === "wfs-small" || u === "wfs-large")) {
        expect(s.layer, s.id).toBeTruthy();
        expect(s.features, s.id).toBeGreaterThan(0);
      }
      if (s.uses.includes("wfs-small")) expect(s.features!, s.id).toBeLessThan(1000);
      if (s.uses.includes("wfs-large")) expect(s.features!, s.id).toBeGreaterThan(10_000);
      if (s.uses.includes("no-cors")) expect(s.cors, s.id).toBe(false);
      if (s.uses.some((u) => u === "wms" || u.startsWith("wfs-") || u.startsWith("arcgis-"))) expect(s.cors, s.id).toBe(true);
    }
  });
});
