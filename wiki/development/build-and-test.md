---
type: Guide
title: Build and test
description: Commands to build the plugin and run its tests, and the layout of the source.
tags: [development, build, tests]
status: stable
sources:
  - id: package
    resource: ../../package.json
    title: npm scripts
  - id: readme
    resource: ../../README.md
    title: README, "Development"
---

# Commands

| Command | What it does |
|---|---|
| `npm install` | install the dependencies |
| `npm run build` | build `geolibre-plugin/dist/index.js` and `style.css` |
| `npm run package:geolibre` | build, then write `geolibre-plugin/openrndt-geolibre-<version>.zip` |
| `npm test` | unit tests, no network |
| `RUN_LIVE_TESTS=1 npx vitest --run tests/live.test.ts` | compare query totals with the live catalogue |
| `npm run lint` | ESLint, no warnings allowed |
| `npx tsc --noEmit -p .` | type check |

# Layout

`src/geolibre.ts` is the plugin entry; the code is in `src/rndt/`:

| File | Role |
|---|---|
| `query.ts` | search form to REST query, pure |
| `records.ts` | parsing of search results, service links, contacts, footprints |
| `ogc.ts` | WMS and WFS capabilities, GetFeature addresses, axis order |
| `arcgis.ts` | ArcGIS REST links, service descriptions, `export` and `query` addresses |
| `layer-names.ts` | readable layer names |
| `crs.ts` | conversion of projected GeoJSON to WGS84 |
| `url-params.ts` | the URL parameters |
| `project-state.ts` | the state saved in a project |
| `panel.ts`, `panel.css` | the panel, plain DOM, CSS classes prefixed `ordt-` |
| `footprints-layer.ts` | footprints overlay on the MapLibre map |
| `settings.ts` | settings and error log |
| `host.ts` | fetch helpers and host methods beyond `src/lib/geolibre/host-api.ts` |
| `constants.ts` | plugin id, name, version, option lists |

# Tests

- `tests/fixtures/queries.json` pairs a form with the query it must become. It is meant as a test oracle shared with the [openrndt](https://github.com/ondata/openrndt) command line tool, which should build the same queries.
- `tests/plugin.test.ts` drives the panel in a simulated DOM with a fake host.
- `tests/wiki.test.ts` checks this wiki: see [the index](../index.md).

# Conventions

- Issues, pull requests, commits, documentation and the log are in English.
- `LOG.md` gets a short entry per change, newest date first.
- `tasks/` and `tmp/` are not committed.

Trying a build in GeoLibre: [Testing in GeoLibre web](testing-in-geolibre-web.md) and [Installing in GeoLibre Desktop](installing-in-desktop.md).
