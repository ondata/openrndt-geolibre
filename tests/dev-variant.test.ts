import { afterEach, describe, expect, it, vi } from "vitest";

/** The names a copy of the plugin registers under, read with a given Vite mode. */
async function namesIn(mode: string) {
  vi.resetModules();
  vi.stubEnv("MODE", mode);
  const constants = await import("../src/rndt/constants");
  const footprints = await import("../src/rndt/footprints-layer");
  const settings = await import("../src/rndt/settings");
  return {
    id: constants.PLUGIN_ID,
    name: constants.PLUGIN_NAME,
    label: constants.PLUGIN_LABEL,
    panel: constants.PANEL_ID,
    source: footprints.SOURCE_ID,
    settings: settings.SETTINGS_KEY,
    errorLog: settings.ERROR_LOG_KEY,
  };
}

describe("development copy of the plugin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps today's names in the default build", async () => {
    expect(await namesIn("production")).toEqual({
      id: "openrndt-geolibre",
      name: "RNDT catalogue",
      label: "RNDT",
      panel: "openrndt-geolibre-search",
      source: "openrndt-geolibre-footprints",
      settings: "openrndt-geolibre:settings",
      errorLog: "openrndt-geolibre:error-log",
    });
  });

  it("has its own id, and every name follows it, in dev mode", async () => {
    expect(await namesIn("dev")).toEqual({
      id: "openrndt-geolibre-dev",
      name: "RNDT catalogue (dev)",
      label: "RNDT (dev)",
      panel: "openrndt-geolibre-dev-search",
      source: "openrndt-geolibre-dev-footprints",
      settings: "openrndt-geolibre-dev:settings",
      errorLog: "openrndt-geolibre-dev:error-log",
    });
  });
});
