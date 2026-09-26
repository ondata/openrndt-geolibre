import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, RNDT_BASE_URL } from "../src/rndt/constants";
import { buildSearchUrl, emptyForm, type SearchForm } from "../src/rndt/query";
import { parseSearchResponse } from "../src/rndt/records";

// Hits the live RNDT catalogue: run with RUN_LIVE_TESTS=1 npx vitest --run tests/live.test.ts
const live = process.env.RUN_LIVE_TESTS === "1";

const { cases } = JSON.parse(readFileSync(join(__dirname, "fixtures", "queries.json"), "utf8")) as {
  cases: { name: string; form: Partial<SearchForm>; liveTotal?: number }[];
};

describe.skipIf(!live)("live RNDT totals", () => {
  for (const c of cases.filter((x) => x.liveTotal !== undefined)) {
    it(`${c.name} -> ${c.liveTotal}`, async () => {
      const url = buildSearchUrl(RNDT_BASE_URL, { ...emptyForm(), ...c.form }, 1, PAGE_SIZE);
      const response = await fetch(url);
      expect(response.ok).toBe(true);
      const page = parseSearchResponse(await response.json(), RNDT_BASE_URL);
      expect(page.total).toBe(c.liveTotal);
    }, 30000);
  }
});
