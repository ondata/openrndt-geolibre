import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import plugin from "../src/geolibre";
import type { GeoLibreRightPanelRegistration } from "../src/lib/geolibre/host-api";
import type { RndtHost } from "../src/rndt/host";
import { bindLanguage, fmt, tr, trCount } from "../src/rndt/i18n";
import { IT } from "../src/rndt/i18n-it";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A host that translates as GeoLibre's i18next does: `_one`/`_other` with `count`, then the key, then the default. */
function languageHost(locale: string) {
  const resources: Record<string, Record<string, string>> = {};
  const listeners = new Set<(locale: string) => void>();
  const fill = (text: string, params?: Record<string, string | number>) =>
    text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole));
  const host = {
    getLocale: () => locale,
    onLocaleChange: (listener: (locale: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    registerTranslations: vi.fn((given: Record<string, Record<string, string>>) => {
      for (const [lang, flat] of Object.entries(given)) resources[lang] = { ...flat, ...resources[lang] };
    }),
    translate: (key: string, defaultValue: string, params?: Record<string, string | number>) => {
      const catalogue = resources[locale.split("-")[0]] ?? {};
      const plural = typeof params?.count === "number" ? catalogue[`${key}_${params.count === 1 ? "one" : "other"}`] : undefined;
      return fill(plural ?? catalogue[key] ?? defaultValue, params);
    },
  };
  const switchTo = (next: string) => {
    locale = next;
    for (const listener of listeners) listener(next);
  };
  return { host, switchTo };
}

describe("language (#3)", () => {
  it("is English without a host that translates", () => {
    bindLanguage({} as RndtHost);
    expect(tr("status.start", "Search the Italian national catalogue of spatial data (RNDT).")).toBe(
      "Search the Italian national catalogue of spatial data (RNDT).",
    );
    expect(tr("x.y", "{{a}} and {{b}}", { a: 1, b: "two" })).toBe("1 and two");
    expect(trCount("x.z", "{{n}} result", "{{n}} results", 1234)).toBe("1,234 results");
  });

  it("is Italian when GeoLibre is, also as it-IT, and English for other languages", () => {
    const { host } = languageHost("it-IT");
    bindLanguage(host as unknown as RndtHost);
    expect(tr("status.start", "Search the Italian national catalogue of spatial data (RNDT).")).toBe(IT["status.start"]);
    expect(fmt(12345)).toBe("12.345");
    const fr = languageHost("fr");
    bindLanguage(fr.host as unknown as RndtHost);
    expect(tr("status.start", "Search the Italian national catalogue of spatial data (RNDT).")).toBe(
      "Search the Italian national catalogue of spatial data (RNDT).",
    );
  });

  it("registers the catalogue once per host, under the plugin's id", () => {
    const { host } = languageHost("it");
    bindLanguage(host as unknown as RndtHost);
    bindLanguage(host as unknown as RndtHost);
    expect(host.registerTranslations).toHaveBeenCalledTimes(1);
    const keys = Object.keys(host.registerTranslations.mock.calls[0][0].it);
    expect(keys.every((k) => k.startsWith(`plugin.${plugin.id}.`))).toBe(true);
  });
});

describe("the Italian catalogue (#3)", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  const code = sources(join(__dirname, "..", "src")).map((f) => readFileSync(f, "utf8")).join("\n");
  const single = [...code.matchAll(/\btr\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const plural = [...code.matchAll(/\btrCount\(\s*"([^"]+)"/g)].map((m) => m[1]);

  it("has every key the code uses, plurals with _one and _other", () => {
    expect(single.filter((k) => !(k in IT))).toEqual([]);
    expect(plural.filter((k) => !(`${k}_one` in IT && `${k}_other` in IT))).toEqual([]);
  });

  it("has no key the code does not use", () => {
    const used = new Set([...single, ...plural.flatMap((k) => [`${k}_one`, `${k}_other`])]);
    expect(Object.keys(IT).filter((k) => !used.has(k))).toEqual([]);
  });

  it("has no key that is the prefix of another (GeoLibre nests them) and no colon", () => {
    const keys = Object.keys(IT);
    expect(keys.filter((k) => keys.some((other) => other.startsWith(`${k}.`)))).toEqual([]);
    expect(keys.filter((k) => k.includes(":"))).toEqual([]);
  });

  it("keeps the placeholders of the English text", () => {
    const pairs = [...code.matchAll(/\btr(?:Count)?\(\s*"([^"]+)",\s*("(?:[^"\\]|\\.)*"|`[^`]*`)(?:,\s*("(?:[^"\\]|\\.)*"|`[^`]*`))?/g)];
    const names = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const wrong = pairs.flatMap(([, key, one, other]) => {
      const english = names(one + (other ?? ""));
      const italian = key in IT ? names(IT[key]) : names((IT[`${key}_one`] ?? "") + (IT[`${key}_other`] ?? ""));
      return italian.every((n) => english.includes(n)) ? [] : [key];
    });
    expect(wrong).toEqual([]);
  });
});

describe("the panel follows a language switch (#3)", () => {
  it("is built again in the new language, with its search and the record open", async () => {
    const { host: lang, switchTo } = languageHost("en");
    const requested: string[] = [];
    let registration: GeoLibreRightPanelRegistration | null = null;
    const host = {
      ...lang,
      registerRightPanel: (p: GeoLibreRightPanelRegistration) => {
        registration = p;
        return vi.fn();
      },
      openRightPanel: vi.fn(() => true),
      closeRightPanel: vi.fn(),
      fetchArrayBuffer: vi.fn(async (url: string) => {
        requested.push(url);
        return new TextEncoder().encode(fixture("search-services.json")).buffer as ArrayBuffer;
      }),
      getViewBounds: () => [12, 41, 13, 42],
    } as unknown as RndtHost;
    plugin.activate(host);
    const container = document.createElement("div");
    document.body.append(container);
    registration!.render(container);
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "catasto";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    container.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    const id = plugin.getProjectState!() as { recordId: string };
    expect(id.recordId).toBeTruthy();
    expect(container.querySelector(".ordt-status")!.textContent).not.toBe(IT["status.start"]);

    switchTo("it");
    await flush();
    expect(requested).toHaveLength(2);
    expect(container.querySelectorAll(".ordt-panel")).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>('input[name="text"]')!.value).toBe("catasto");
    expect((plugin.getProjectState!() as { recordId: string }).recordId).toBe(id.recordId);
    expect(container.querySelector<HTMLElement>(".ordt-detail-view")!.hidden).toBe(false);
    plugin.deactivate(host);
  });
});

describe("the panel in Italian (#3)", () => {
  /** English phrases of the panel's own UI: none may be left with GeoLibre in Italian. */
  const ENGLISH = [
    "Search help",
    "Settings",
    "Advanced filters",
    "Available as",
    "Sort by",
    "Clear all",
    "Open data only",
    "Copy id",
    "Zoom to extent",
    "Metadata updated",
    "Add to map",
    "Select a layer",
    "Show footprint",
    "Hide footprint",
    "Copy URL",
    "Readable names",
    "Records whose",
    "Recent searches",
    "Remember my last",
    "Any theme",
    "Hydrography",
    "of the link",
  ];

  it("leaves none of its English labels in the form, the results and an open record", async () => {
    const { host: lang } = languageHost("it");
    let registration: GeoLibreRightPanelRegistration | null = null;
    const host = {
      ...lang,
      registerRightPanel: (p: GeoLibreRightPanelRegistration) => {
        registration = p;
        return vi.fn();
      },
      openRightPanel: vi.fn(() => true),
      closeRightPanel: vi.fn(),
      fetchArrayBuffer: vi.fn(async (url: string) =>
        new TextEncoder().encode(url.includes("/rest/metadata/search") ? fixture("search-services.json") : fixture("wms-piemonte-111.xml")).buffer as ArrayBuffer,
      ),
      fitBounds: vi.fn(),
      getViewBounds: () => [12, 41, 13, 42],
      addWmsLayer: vi.fn(() => "wms-1"),
    } as unknown as RndtHost;
    plugin.activate(host);
    const container = document.createElement("div");
    document.body.append(container);
    registration!.render(container);
    container.querySelector<HTMLInputElement>('input[name="text"]')!.value = "catasto";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const results = container.textContent!;
    container.querySelector<HTMLButtonElement>(".ordt-result-title")!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const detail = container.querySelector(".ordt-detail-view")!.textContent!;
    expect(container.querySelector('select[name="theme"]')!.textContent).toContain("Idrografia");
    expect(ENGLISH.filter((phrase) => results.includes(phrase) || detail.includes(phrase))).toEqual([]);
    expect(results).toContain("Aiuto alla ricerca");
    // The WMS was read: its add button is there, in Italian.
    expect(detail).toMatch(/Aggiungi alla mappa|Scegli un layer/);
    plugin.deactivate(host);
  });
});

