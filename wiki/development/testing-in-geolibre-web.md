---
type: Playbook
title: Testing in GeoLibre web
description: How to try a local build of the plugin on web.geolibre.app, by hand or with a driven browser, and the traps that look like defects.
tags: [development, tests, web]
status: stable
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02 and 2026-10-03
---

# Setup

1. `npm run build`.
2. Serve the folder `geolibre-plugin/` from localhost with CORS headers (`Access-Control-Allow-Origin: *`).
3. Make the plugin known to GeoLibre web, in one of two ways:
   - a project file whose `plugins.manifestUrls` lists the address of the local `plugin.json`, opened with `https://web.geolibre.app/?url=<address of the project>`;
   - **Settings > Manage Plugins > Settings**, adding the address of `plugin.json`.
4. With a project, GeoLibre asks "Load plugins from this project?": **Trust and load**.

A minimal project:

```json
{
  "version": "0.1.0",
  "name": "RNDT",
  "mapView": { "center": [12.5, 42], "zoom": 5, "bearing": 0, "pitch": 0 },
  "layers": [],
  "plugins": { "manifestUrls": ["http://localhost:8091/openrndt/plugin.json"] }
}
```

# Traps

Each of these looked like a defect of the plugin and was not.[^log]

| What is seen | Cause | Way out |
|---|---|---|
| The project on localhost is not fetched from the public site | the browser checks requests to the local network | in a normal browser, allow it when asked; in a driven Chrome, `--disable-features=LocalNetworkAccessChecks` |
| "Plugin … changed since you last trusted it and was not loaded" | the build changed after the trust was given | use a fresh browser profile, or uninstall and install again |
| No map in a headless Chrome | no WebGL2 by default | `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist` |
| The catalogue answers HTTP 500 | geodati.gov.it refuses a `HeadlessChrome` user agent | set a plain Chrome user agent |
| A development build of GeoLibre hides CORS failures | its dev server proxies requests | only a production build behaves like the public site |

# Reading a saved project

GeoLibre web saves a project as a download. To check what the plugin wrote, look at `plugins.settings["openrndt-geolibre"]` in the file: see [Project state](../reference/project-state.md).

# The pull request preview

A pull request to the registry has a preview with the plugin inside the build, with no setup: see [Release in the registry](registry-release.md).

[^log]: LOG, 2026-10-02 and 2026-10-03
