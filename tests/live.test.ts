import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, RNDT_BASE_URL } from "../src/rndt/constants";
import { buildSearchUrl, emptyForm, type SearchForm } from "../src/rndt/query";
import { parseSearchResponse } from "../src/rndt/records";
import { reference, type ReferenceService } from "./reference-services";

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

/** The answer to a request made as the web version makes it, with its CORS headers. */
async function asWeb(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Origin: reference.origin }, signal: AbortSignal.timeout(30_000) });
  const body = new Uint8Array(await response.arrayBuffer());
  // Headers joins repeated values with ", ": two Access-Control-Allow-Origin headers read as one with a comma.
  return { response, body, cors: response.headers.get("access-control-allow-origin") };
}

/** Width, height and whether any pixel byte is set, from a PNG's IHDR and IDAT chunks. */
function png(body: Uint8Array): { width: number; height: number; drawn: boolean } | null {
  if (body.length < 33 || body[0] !== 0x89 || body[1] !== 0x50) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  for (let i = 8; i + 8 <= body.length; ) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(...body.subarray(i + 4, i + 8));
    if (type === "IHDR") [width, height] = [view.getUint32(i + 8), view.getUint32(i + 12)];
    if (type === "IDAT") idat.push(body.subarray(i + 8, i + 8 + length));
    i += 12 + length;
  }
  const pixels = inflateSync(Buffer.concat(idat));
  return { width, height, drawn: pixels.some((b) => b !== 0) };
}

function expectCors(cors: string | null, service: ReferenceService) {
  if (service.cors) expect([reference.origin, "*"], `${service.id}: Access-Control-Allow-Origin`).toContain(cors);
  else expect(cors, `${service.id}: no CORS`).toBeNull();
}

const wmsMap = (s: ReferenceService, size: number) =>
  `${s.url}${s.url.includes("?") ? "&" : "?"}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(s.layer!)}&STYLES=&SRS=EPSG:3857&BBOX=${s.bbox3857!.join(",")}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=true`;
const wfs = (s: ReferenceService, query: string) => `${s.url}?SERVICE=WFS&VERSION=2.0.0&${query}`;

// Re-checks the reference services (#60): RUN_LIVE_TESTS=1 npx vitest --run tests/live.test.ts
describe.skipIf(!live)("live reference services (#60)", () => {
  for (const s of reference.services) {
    it(`${s.id} (${s.uses.join(", ")})`, async () => {
      if (s.uses.includes("http-only")) {
        const https = await fetch(s.url.replace(/^http:/, "https:"), { redirect: "manual", signal: AbortSignal.timeout(30_000) });
        expect(https.status, "https redirects").toBeGreaterThanOrEqual(300);
        expect(https.headers.get("location") ?? "", "to http").toMatch(/^http:/);
        return;
      }
      if (s.kind === "wms") {
        const size = 128;
        const { response, body, cors } = await asWeb(wmsMap(s, size));
        expect(response.status).toBe(200);
        expectCors(cors, s);
        const image = png(body);
        expect(image, "a PNG").not.toBeNull();
        if (s.uses.includes("not-3857")) {
          // The server ignores the request and sends a fixed picture: the panel's "other-size".
          expect(image!.width, "not the size asked").not.toBe(size);
        } else {
          expect([image!.width, image!.height]).toEqual([size, size]);
          expect(image!.drawn, "pixels drawn").toBe(true);
        }
      }
      if (s.kind === "wfs") {
        const caps = await asWeb(wfs(s, "REQUEST=GetCapabilities"));
        expect(caps.response.status).toBe(200);
        expectCors(caps.cors, s);
        const text = new TextDecoder().decode(caps.body);
        if (s.uses.includes("gml-only")) {
          expect(text, "no GeoJSON output").not.toMatch(/json/i);
          return;
        }
        const hits = new TextDecoder().decode((await asWeb(wfs(s, `REQUEST=GetFeature&TYPENAMES=${s.layer}&RESULTTYPE=hits`))).body);
        const matched = Number(/numberMatched="(\d+)"/.exec(hits)?.[1]);
        if (s.uses.includes("wfs-small")) expect(matched).toBeLessThan(1000);
        if (s.uses.includes("wfs-large")) expect(matched).toBeGreaterThan(10_000);
        const { body, cors } = await asWeb(wfs(s, `REQUEST=GetFeature&TYPENAMES=${s.layer}&COUNT=2&OUTPUTFORMAT=application/json`));
        expectCors(cors, s);
        const fc = JSON.parse(new TextDecoder().decode(body));
        expect(fc.type).toBe("FeatureCollection");
        expect(fc.features.length).toBeGreaterThan(0);
      }
      if (s.kind === "arcgis") {
        const description = await asWeb(`${s.url}?f=json`);
        expect(description.response.status).toBe(200);
        expectCors(description.cors, s);
        if (s.uses.includes("arcgis-image")) {
          const image = s.url.endsWith("ImageServer") ? "exportImage" : "export";
          const { body, cors } = await asWeb(`${s.url}/${image}?bbox=${s.bbox3857!.join(",")}&bboxSR=3857&imageSR=3857&size=128,128&format=png32&transparent=true&f=image`);
          expectCors(cors, s);
          expect(png(body)?.drawn, "pixels drawn").toBe(true);
        }
        if (s.uses.includes("arcgis-features")) {
          const { body, cors } = await asWeb(`${s.url}/${s.layer}/query?where=1%3D1&outFields=*&resultRecordCount=2&f=geojson`);
          expectCors(cors, s);
          const fc = JSON.parse(new TextDecoder().decode(body));
          expect(fc.features.length).toBeGreaterThan(0);
        }
      }
    }, 90_000);
  }

  for (const f of reference.failures) {
    it(`${f.id} (${f.uses.join(", ")})`, async () => {
      const started = Date.now();
      const error = await fetch(f.url, { signal: AbortSignal.timeout(5000) }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(error, "no answer").not.toBeNull();
      if (f.uses.includes("no-answer")) expect(error!.name).toBe("TimeoutError");
      else expect(Date.now() - started, "fails before the timeout").toBeLessThan(5000);
    }, 30_000);
  }
});
