import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openResult, parseAddInput, parseOpenInput, parseSearchInput, readDetail, registerAssistantTools, searchResult, type AssistantPanel } from "../src/rndt/assistant";
import type { AssistantToolSpec } from "../src/rndt/host";
import { PAGE_SIZE, RNDT_BASE_URL } from "../src/rndt/constants";
import type { RndtHost } from "../src/rndt/host";
import { RndtPanel } from "../src/rndt/panel";
import { parseSearchResponse } from "../src/rndt/records";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("search tool input (#58)", () => {
  it("defaults to the map view and the first page, as the panel", () => {
    const search = parseSearchInput({ text: "alberi monumentali" });
    expect(search.area).toBe("view");
    expect(search.start).toBe(1);
    expect(search.form.text).toBe("alberi monumentali");
    expect(search.form.bbox).toBeNull();
    expect(parseSearchInput(undefined).area).toBe("view");
  });

  it("reads the words of a link", () => {
    const { form, area } = parseSearchInput({
      text: "fiumi",
      theme: "hy",
      sort: "newest",
      ipa: "r_toscan",
      availableAs: ["WMS", "ArcGIS"],
      openDataOnly: true,
      dateField: "modified",
      dateFrom: "2024-01-01",
      area: "anywhere",
      start: 21,
    });
    expect(area).toBe("anywhere");
    expect(form.inspireThemes).toEqual(["Idrografia"]);
    expect(form.sort).toBe("apiso_Modified_dt:desc");
    expect(form.ipa).toBe("r_toscan");
    expect(form.availableAs).toEqual(["WMS", "ArcGIS REST"]);
    expect(form.openDataOnly).toBe(true);
    expect(form.dateField).toBe("apiso_Modified_dt");
    expect(form.dateFrom).toBe("2024-01-01");
  });

  it("takes a box as the area", () => {
    const search = parseSearchInput({ area: [8.5, 44.7, 11.4, 46.6], within: true });
    expect(search.area).toBe("box");
    expect(search.form.bbox).toEqual([8.5, 44.7, 11.4, 46.6]);
    expect(search.form.spatialRel).toBe("Within");
  });

  it.each([
    [{ colour: "red" }, /Unknown field colour/],
    [{ theme: "zz" }, /^theme: not an INSPIRE theme code/],
    [{ sort: "random" }, /^sort: not one of title, title-desc, newest, oldest/],
    [{ dateFrom: "1 Jan 2024" }, /^dateFrom: not a yyyy-mm-dd date/],
    [{ area: "Lombardia" }, /^area:/],
    [{ area: [12, 46, 11, 47] }, /^area:/],
    [{ start: 0 }, /^start:/],
    [{ text: 3 }, /^text:/],
    ["fiumi", /must be an object/],
  ])("rejects %j with a message the model can act on", (input, message) => {
    expect(() => parseSearchInput(input)).toThrow(message);
  });
});

describe("search tool result (#58)", () => {
  const page = parseSearchResponse(JSON.parse(fixture("search-alberi.json")), RNDT_BASE_URL);
  const { form } = parseSearchInput({ text: "alberi" });

  it("gives the page as metadata, with the next start", () => {
    const result = searchResult({ form, total: 45, start: 1, records: page.records }, PAGE_SIZE, "view");
    expect(result.records.map((r) => r.id)).toEqual(page.records.map((r) => r.id));
    expect(result.end).toBe(page.records.length);
    expect(result.nextStart).toBe(1 + PAGE_SIZE);
    expect(result.filters).toContain("Text: alberi (all words, anywhere in the record)");
    for (const record of result.records) expect(record.abstract.length).toBeLessThanOrEqual(301);
  });

  it("tells the agent what to call next and how to read the page", () => {
    const result = searchResult({ form, total: 45, start: 1, records: page.records }, PAGE_SIZE, "view");
    expect(result.next.join(" ")).toMatch(/call search with the same input and start: 21/);
    expect(result.notes.join(" ")).toMatch(/current map view/);
    expect(result.notes.join(" ")).toMatch(/same page in the RNDT panel/);
    expect(searchResult({ form, total: 45, start: 1, records: page.records }, PAGE_SIZE, "anywhere").notes.join(" ")).not.toMatch(/map view/);
  });

  it("says which filters to widen when nothing is found", () => {
    const narrow = parseSearchInput({ text: "alberi monumentali", organisation: "comune di bologna", theme: "ps", openDataOnly: true }).form;
    const { next } = searchResult({ form: narrow, total: 0, start: 1, records: [] }, PAGE_SIZE, "view");
    expect(next[0]).toMatch(/^No records/);
    expect(next.join("\n")).toMatch(/area: "anywhere"/);
    expect(next.join("\n")).toMatch(/textMode: "any"/);
    expect(next.join("\n")).toMatch(/metropolitan city/);
    expect(next.join("\n")).toMatch(/drop theme/);
    expect(next.join("\n")).toMatch(/drop openDataOnly/);
    const wide = searchResult({ form: parseSearchInput({ text: "zzz" }).form, total: 0, start: 1, records: [] }, PAGE_SIZE, "anywhere");
    expect(wide.next).toEqual(["No records. Widen one filter at a time and search again:"]);
  });

  it("names ArcGIS services as open_record shows them", () => {
    const record = { ...page.records[0], services: [{ kind: "ArcGIS REST", url: "https://example.org/arcgis/rest/services/a/MapServer" }] };
    const result = searchResult({ form, total: 1, start: 1, records: [record] }, PAGE_SIZE, "anywhere");
    expect(result.records[0].services[0].kind).toBe("ArcGIS");
    expect(result.next.join(" ")).toMatch(/call open_record with its recordId/);
  });

  it("has no next page at the end, and no end with no record", () => {
    expect(searchResult({ form, total: page.records.length, start: 1, records: page.records }, PAGE_SIZE, "view").nextStart).toBeNull();
    const empty = searchResult({ form, total: 0, start: 1, records: [] }, PAGE_SIZE, "view");
    expect(empty.end).toBeNull();
    expect(empty.nextStart).toBeNull();
  });
});

describe("panel search from the assistant (#58)", () => {
  function mount() {
    const requested: string[] = [];
    const host: RndtHost = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      openRightPanel: vi.fn(() => true),
      fetchArrayBuffer: vi.fn(async (url: string) => {
        requested.push(url);
        return encode(fixture("search-services.json"));
      }),
      getViewBounds: () => [12, 41, 13, 42],
    };
    const panel = new RndtPanel(host);
    const container = document.createElement("div");
    document.body.append(container);
    panel.mount(container);
    return { host, panel, container, requested };
  }

  it("runs in the panel as by hand and gives back the list shown", async () => {
    const { host, panel, container, requested } = mount();
    const outcome = await panel.runSearch(parseSearchInput({ text: "fiumi", theme: "hy" }));

    expect(host.openRightPanel).toHaveBeenCalled();
    const url = new URL(requested[0]);
    expect(url.searchParams.get("q")).toContain("Idrografia");
    expect(url.searchParams.get("bbox")).toBe("12,41,13,42");
    expect(container.querySelector<HTMLInputElement>('input[name="text"]')!.value).toBe("fiumi");
    expect(container.querySelector<HTMLSelectElement>('select[name="where"]')!.value).toBe("view");
    expect(container.querySelector<HTMLSelectElement>('select[name="theme"]')!.value).toBe("Idrografia");
    const shown = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result"), (li) => li.dataset.id);
    expect(outcome && "records" in outcome ? outcome.records.map((r) => r.id) : null).toEqual(shown);
    panel.destroy();
  });

  it("searches anywhere and from a later page when asked", async () => {
    const { panel, container, requested } = mount();
    await panel.runSearch(parseSearchInput({ text: "fiumi", area: "anywhere", start: 21 }));

    const url = new URL(requested[0]);
    expect(url.searchParams.get("bbox")).toBeNull();
    expect(url.searchParams.get("start")).toBe("21");
    expect(container.querySelector<HTMLSelectElement>('select[name="where"]')!.value).toBe("anywhere");
    panel.destroy();
  });

  it("gives back the error the panel shows", async () => {
    const { host, panel } = mount();
    host.fetchArrayBuffer = vi.fn(async () => {
      throw new Error("cannot reach the catalogue");
    });
    expect(await panel.runSearch(parseSearchInput({ text: "fiumi" }))).toEqual({
      error: expect.stringMatching(/^Search failed: .*cannot reach the catalogue/),
    });
    panel.destroy();
  });

  it("says when the panel was never opened", async () => {
    const panel = new RndtPanel({ addMapControl: () => true, removeMapControl: () => undefined });
    expect(await panel.runSearch(parseSearchInput({ text: "fiumi" }))).toEqual({ error: expect.stringMatching(/not open/) });
  });
});

describe("open_record and add_layers input (#58)", () => {
  it("reads a record id, a service number, layer names and how to add", () => {
    expect(parseOpenInput({ recordId: " r:1 " })).toEqual({ recordId: "r:1", filter: "" });
    expect(parseAddInput({ recordId: "r:1", service: 2, layers: ["a", "b"] })).toEqual({ recordId: "r:1", service: 2, layers: ["a", "b"], as: "map" });
    expect(parseAddInput({ recordId: "r:1", service: 1, layers: ["a"], as: "features" }).as).toBe("features");
  });

  it.each([
    [parseOpenInput, {}, /^recordId:/],
    [parseOpenInput, { recordId: "r", service: 1 }, /Unknown field service/],
    [parseAddInput, { recordId: "r", service: 0, layers: ["a"] }, /^service:/],
    [parseAddInput, { recordId: "r", service: 1, layers: [] }, /^layers:/],
    [parseAddInput, { recordId: "r", service: 1, layers: ["a"], as: "image" }, /^as:/],
    [parseAddInput, { recordId: "r", service: 1, layers: ["a", "b"], as: "features" }, /one layer at a time/],
  ] as const)("rejects %#", (parse, input, message) => {
    expect(() => parse(input)).toThrow(message);
  });
});

describe("open_record result (#58)", () => {
  it("offers both ways when a record can be shown and downloaded", () => {
    const layer = (name: string) => ({ name, title: name, ticked: true });
    const { next } = openResult("c:1", "Catasto 1810", [
      { service: 1, kind: "WMS", url: "https://a/wms", layers: [layer("V_1810")], buttons: ["Add to map (1)"], messages: [] },
      { service: 2, kind: "WFS", url: "https://a/wfs", layers: [layer("S:V_1810")], buttons: ["Add features"], messages: [] },
    ]);
    expect(next[0]).toContain('service 1, layers ["V_1810"], as "map"');
    expect(next[1]).toMatch(/^For the data: move the map to the record's area/);
    expect(next[1]).toContain('service 2, layers ["S:V_1810"], as "features"');
  });
});

describe("the panel driven as by hand (#58)", () => {
  const hits = (n: number) => `<wfs:FeatureCollection numberMatched="${n}" numberReturned="0"/>`;
  const features = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [13, 46] } }] });

  async function mount(matched = 1) {
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")));
    const requested: string[] = [];
    const host: RndtHost = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      openRightPanel: vi.fn(() => true),
      getViewBounds: () => [12, 41, 13, 42],
      fetchArrayBuffer: vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes("/rest/metadata/search")) return encode(fixture(/WFS|fvg/i.test(url) ? "search-alberi.json" : "search-services.json"));
        if (/service=WMS/i.test(url)) return encode(fixture("wms-piemonte-111.xml"));
        if (/RESULTTYPE=hits/i.test(url)) return encode(hits(matched));
        if (/REQUEST=GetFeature/i.test(url)) return encode(features);
        return encode(fixture("wfs-fvg-200.xml"));
      }),
      addWmsLayer: vi.fn(() => "wms-1"),
      addGeoJsonLayer: vi.fn(() => "geojson-1"),
    };
    const panel = new RndtPanel(host);
    const container = document.createElement("div");
    document.body.append(container);
    panel.mount(container);
    return { host, panel, container, requested };
  }

  /** Search, then the id of the first record with a service of this kind. */
  async function recordWith(panel: RndtPanel, container: HTMLElement, kind: string, text: string) {
    await panel.runSearch(parseSearchInput({ text }));
    const card = Array.from(container.querySelectorAll<HTMLElement>(".ordt-result")).find((li) =>
      Array.from(li.querySelectorAll(".ordt-badge-service")).some((b) => b.textContent === kind),
    )!;
    return card.dataset.id!;
  }

  it("opens a record and returns what its detail view shows", async () => {
    const { panel, container } = await mount();
    const id = await recordWith(panel, container, "WMS", "catasto");
    const opened = await panel.openRecord(id);
    vi.unstubAllGlobals();
    if ("error" in opened) throw new Error(opened.error);

    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(false);
    const services = readDetail(opened.detail);
    const wms = services.find((s) => s.kind === "WMS")!;
    expect(wms.layers.length).toBeGreaterThan(0);
    expect(wms.layers.every((l) => typeof l.ticked === "boolean")).toBe(true);
    expect(wms.buttons.some((b) => /^(Add to map|Select a layer)/.test(b))).toBe(true);
    expect(wms.loading).toBeUndefined();
    const result = openResult(id, opened.record.title, services);
    expect(result.next[0]).toMatch(new RegExp(`call add_layers with recordId "${id}", service ${wms.service}`));
  });

  it("adds the WMS layer asked, not the one preselected, with the panel's message", async () => {
    const { host, panel, container } = await mount();
    const id = await recordWith(panel, container, "WMS", "catasto");
    const opened = await panel.openRecord(id);
    if ("error" in opened) throw new Error(opened.error);
    const wms = readDetail(opened.detail).find((s) => s.kind === "WMS")!;
    const target = wms.layers.filter((l) => !l.disabled).at(-1)!;

    const outcome = await panel.addFromRecord({ recordId: id, service: wms.service, layers: [target.name], as: "map" });
    vi.unstubAllGlobals();
    expect(outcome).toMatchObject({ status: "done", message: expect.stringMatching(/^Added 1 of 1 layer/) });
    expect(host.addWmsLayer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.addWmsLayer!).mock.calls[0][1].layers).toBe(target.name);
    expect(readDetail(opened.detail).find((s) => s.kind === "WMS")!.layers.find((l) => l.name === target.name)!.onMap).toBe(true);
  });

  it("adds WFS features as Add features does", async () => {
    const { host, panel, container } = await mount(1);
    const id = await recordWith(panel, container, "WFS", "alberi fvg");
    const opened = await panel.openRecord(id);
    if ("error" in opened) throw new Error(opened.error);
    const wfs = readDetail(opened.detail).find((s) => s.kind === "WFS")!;
    const name = wfs.layers.find((l) => !l.disabled)!.name;

    const outcome = await panel.addFromRecord({ recordId: id, service: wfs.service, layers: [name], as: "features" });
    vi.unstubAllGlobals();
    expect(outcome).toMatchObject({ status: "done", message: expect.stringMatching(/^Added 1 features?/) });
    expect(host.addGeoJsonLayer).toHaveBeenCalledTimes(1);
  });

  it("leaves the 10,000-feature question to the user in the panel", async () => {
    const { host, panel, container } = await mount(22521);
    const id = await recordWith(panel, container, "WFS", "alberi fvg");
    const opened = await panel.openRecord(id);
    if ("error" in opened) throw new Error(opened.error);
    const wfs = readDetail(opened.detail).find((s) => s.kind === "WFS")!;
    const name = wfs.layers.find((l) => !l.disabled)!.name;

    const outcome = await panel.addFromRecord({ recordId: id, service: wfs.service, layers: [name], as: "features" });
    vi.unstubAllGlobals();
    expect(outcome).toEqual({
      status: "waiting",
      message: expect.stringContaining("22,521 features in this area"),
      choices: ["Download all", "First 10,000 only", "Cancel"],
    });
    expect(host.addGeoJsonLayer).not.toHaveBeenCalled();
  });

  it("answers the panel's question when the user answers in the chat", async () => {
    const { host, panel, container, requested } = await mount(22521);
    expect(await panel.choose("First 10,000 only")).toEqual({ error: "No question is waiting in the panel." });
    const id = await recordWith(panel, container, "WFS", "alberi fvg");
    const opened = await panel.openRecord(id);
    if ("error" in opened) throw new Error(opened.error);
    const wfs = readDetail(opened.detail).find((s) => s.kind === "WFS")!;
    await panel.addFromRecord({ recordId: id, service: wfs.service, layers: [wfs.layers.find((l) => !l.disabled)!.name], as: "features" });

    expect(await panel.choose("everything")).toEqual({ error: 'choice: one of "Download all", "First 10,000 only", "Cancel".' });
    const outcome = await panel.choose("first 10,000 only");
    vi.unstubAllGlobals();
    expect(outcome).toMatchObject({ status: "done", message: expect.stringMatching(/^Added 1 of 22,521 features/) });
    const getFeature = new URL(requested.find((u) => /REQUEST=GetFeature/i.test(u) && !/RESULTTYPE=hits/i.test(u))!);
    expect(getFeature.searchParams.get("COUNT")).toBe("10000");
    expect(host.addGeoJsonLayer).toHaveBeenCalledTimes(1);
  });

  it("says what is wrong: unknown service, unknown layer, no such button", async () => {
    const { panel, container } = await mount();
    const id = await recordWith(panel, container, "WMS", "catasto");
    const opened = await panel.openRecord(id);
    if ("error" in opened) throw new Error(opened.error);
    const wms = readDetail(opened.detail).find((s) => s.kind === "WMS")!;
    const name = wms.layers.find((l) => !l.disabled)!.name;

    expect(await panel.addFromRecord({ recordId: id, service: 99, layers: [name], as: "map" })).toEqual({ error: expect.stringMatching(/^service: the record shows/) });
    expect(await panel.addFromRecord({ recordId: id, service: wms.service, layers: ["nope"], as: "map" })).toEqual({ error: expect.stringMatching(/No layer named nope/) });
    expect(await panel.addFromRecord({ recordId: id, service: wms.service, layers: [name], as: "features" })).toEqual({ error: expect.stringMatching(/no Add features button/) });
    vi.unstubAllGlobals();
  });
});

describe("tools never hold the assistant long (#58)", () => {
  // GeoLibre's Stop waits for a running plugin tool: a dead server must not keep it.
  const never = () => new Promise<ArrayBuffer>(() => {});

  it("returns the record with its services still loading when a server does not answer", async () => {
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")));
    const host: RndtHost = {
      addMapControl: () => true,
      removeMapControl: () => undefined,
      getViewBounds: () => [12, 41, 13, 42],
      fetchArrayBuffer: vi.fn(async (url: string) => (url.includes("/rest/metadata/search") ? encode(fixture("search-services.json")) : never())),
      addWmsLayer: vi.fn(() => "wms-1"),
    };
    const panel = new RndtPanel(host);
    const container = document.createElement("div");
    document.body.append(container);
    panel.mount(container);
    await panel.runSearch(parseSearchInput({ text: "catasto" }));
    const id = container.querySelector<HTMLElement>(".ordt-result")!.dataset.id!;

    const started = Date.now();
    const opened = await panel.openRecord(id, 300);
    vi.unstubAllGlobals();
    expect(Date.now() - started).toBeLessThan(2000);
    if ("error" in opened) throw new Error(opened.error);
    const services = readDetail(opened.detail);
    expect(services.some((s) => s.loading)).toBe(true);
    expect(openResult(id, opened.record.title, services).next.join(" ")).toMatch(/still loading/);
    panel.destroy();
  });

  it("returns when the catalogue is slow, the search going on in the panel", async () => {
    const panel = new RndtPanel({ addMapControl: () => true, removeMapControl: () => undefined, getViewBounds: () => [12, 41, 13, 42], fetchArrayBuffer: vi.fn(never) });
    const container = document.createElement("div");
    document.body.append(container);
    panel.mount(container);
    expect(await panel.runSearch(parseSearchInput({ text: "fiumi" }), 300)).toEqual({ error: expect.stringMatching(/^The catalogue is slow/) });
    expect(container.querySelector(".ordt-status")!.textContent).toMatch(/Searching/);
    panel.destroy();
  });
});

describe("Stop and activation from the assistant (#59)", () => {
  const never = () => new Promise<ArrayBuffer>(() => {});
  const searchHost = (): RndtHost => ({
    addMapControl: () => true,
    removeMapControl: () => undefined,
    getViewBounds: () => [12, 41, 13, 42],
    fetchArrayBuffer: vi.fn(async (url: string) => (url.includes("/rest/metadata/search") ? encode(fixture("search-services.json")) : never())),
    addWmsLayer: vi.fn(() => "wms-1"),
  });
  const mountPanel = (host: RndtHost) => {
    const panel = new RndtPanel(host);
    const container = document.createElement("div");
    document.body.append(container);
    panel.mount(container);
    return { panel, container };
  };

  it("ends open_record's wait at once when the user presses Stop", async () => {
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")));
    const { panel, container } = mountPanel(searchHost());
    await panel.runSearch(parseSearchInput({ text: "catasto" }));
    const id = container.querySelector<HTMLElement>(".ordt-result")!.dataset.id!;
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    const started = Date.now();
    const opened = await panel.openRecord(id, 10_000, stop.signal);
    vi.unstubAllGlobals();
    expect(opened).toEqual({ error: "Stopped by the user." });
    expect(Date.now() - started).toBeLessThan(1000);
    panel.destroy();
  });

  it("ends a slow search at once when the user presses Stop, the search going on in the panel", async () => {
    const { panel, container } = mountPanel({ addMapControl: () => true, removeMapControl: () => undefined, getViewBounds: () => [12, 41, 13, 42], fetchArrayBuffer: vi.fn(never) });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    const started = Date.now();
    expect(await panel.runSearch(parseSearchInput({ text: "fiumi" }), 10_000, stop.signal)).toEqual({ error: "Stopped by the user." });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(container.querySelector(".ordt-status")!.textContent).toMatch(/Searching/);
    panel.destroy();
  });

  it("hands each tool's signal to the panel, and reports a stop as a tool error", async () => {
    const tools = new Map<string, AssistantToolSpec>();
    const seen: (AbortSignal | undefined)[] = [];
    const stopped = { error: "Stopped by the user." };
    const panel: AssistantPanel = {
      runSearch: async (_s, _t, signal) => (seen.push(signal), stopped),
      openRecord: async (_id, _t, signal) => (seen.push(signal), stopped),
      addFromRecord: async (_i, _t, signal) => (seen.push(signal), stopped),
      choose: async (_c, _t, signal) => (seen.push(signal), stopped),
    };
    registerAssistantTools({ registerAssistantToolSpec: (spec) => (tools.set(spec.name, spec), () => {}) }, panel);
    const { signal } = new AbortController();
    const inputs: Record<string, unknown> = {
      search: { text: "fiumi" },
      open_record: { recordId: "r:1" },
      add_layers: { recordId: "r:1", service: 1, layers: ["a"] },
      choose: { choice: "Cancel" },
    };
    for (const [name, input] of Object.entries(inputs)) {
      await expect(tools.get(name)!.callback(input, { signal })).rejects.toThrow("Stopped by the user.");
    }
    expect(seen).toEqual([signal, signal, signal, signal]);
  });

  it("waits for the panel to render when a tool comes right after the plugin was turned on", async () => {
    const host = searchHost();
    const panel = new RndtPanel(host);
    host.openRightPanel = vi.fn(() => {
      // GeoLibre renders the panel a moment after it is asked to open it.
      setTimeout(() => {
        const container = document.createElement("div");
        document.body.append(container);
        panel.mount(container);
      }, 50);
      return true;
    });
    const outcome = await panel.runSearch(parseSearchInput({ text: "catasto" }));
    expect(outcome && "records" in outcome ? outcome.records.length : outcome).toBeGreaterThan(0);
    panel.destroy();
  });
});
