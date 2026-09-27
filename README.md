# openrndt-geolibre

A [GeoLibre](https://github.com/opengeos/GeoLibre) plugin to search the **RNDT** (Repertorio Nazionale dei Dati Territoriali, the Italian national catalogue of spatial data metadata) and add its WMS and WFS services to the map.

It is the GeoLibre counterpart of the [openrndt](https://github.com/ondata/openrndt) CLI and uses the same RNDT REST API (`https://geodati.gov.it/RNDT/rest/metadata/search`).

Status: **alpha** (`0.1.0-alpha.1`).

## What it does

- A right-side panel, "RNDT", opened from the Plugins menu (entry "RNDT catalogue"). Closing the panel with X turns the plugin off, so the Plugins menu stays in sync. A "RNDT" toolbar menu, shown while the plugin is on, brings the panel back when another plugin panel has taken its place, and clears results.
- Search form modelled on the portal's "Ricerca Dettagliata": free text (all words, any word, raw Lucene), field (title, abstract, lineage, use limitation), resource type (data or services, with service type), area (map view, drawn shapes, typed box), INSPIRE theme, keywords, organisation, open data only, date range by creation/publication/revision date, sort order.
- Results list with type, services, organisation and metadata date; result footprints drawn on the map, clickable.
- "?" buttons next to the search mode, "Search in" and "Where" open inline help with clickable examples.
- "Copy query" copies a `curl` command (POSIX shell) that repeats the results page on screen, with the same parameters the panel sends to the catalogue.
- For each record: add a **WMS** layer (layer picked from GetCapabilities, preselected from the record), add **WFS** features as GeoJSON (optionally only in the current map view, up to 5,000 features), add GeoJSON downloads, open or copy any link, open the metadata as HTML or ISO XML.

## Known limits

- WMS layers not offered in `EPSG:3857` (for example the Agenzia delle Entrate cadastral WMS, `EPSG:6706` only) cannot be added: the GeoLibre plugin API has no `crs` option for `addWmsLayer` yet (proposed in opengeos/GeoLibre#2701). The panel says so instead of adding an empty layer.
- WFS services without a GeoJSON output format cannot be added.
- Footprints are a temporary map overlay, not a project layer: they are replaced on every search and removed with "Clear results" or when the plugin is turned off.
- The footprints need the MapLibre renderer.

## Install for local testing (GeoLibre Desktop on Windows, building in WSL)

```bash
npm install
npm run build:geolibre
P=/mnt/c/Users/<user>/AppData/Roaming/org.geolibre.desktop/plugins/openrndt-geolibre
mkdir -p "$P" && cp -r geolibre-plugin/plugin.json geolibre-plugin/dist "$P"/
```

Restart GeoLibre Desktop, then Plugins > RNDT catalogue.

A zip for Manage Plugins > Settings > Install from file: `npm run package:geolibre` (writes `geolibre-plugin/openrndt-geolibre-<version>.zip`).

## Development

```bash
npm test                                                # unit tests (no network)
RUN_LIVE_TESTS=1 npx vitest --run tests/live.test.ts    # compare query totals with the live catalogue
npm run lint
npm run build:geolibre                                  # bundle in geolibre-plugin/dist
```

Code lives in `src/rndt/`:

| File | Role |
|---|---|
| `query.ts` | search form to REST query (pure, tested against `tests/fixtures/queries.json`) |
| `records.ts` | parsing of search results, service links, footprints |
| `ogc.ts` | WMS/WFS GetCapabilities parsing, GetFeature URLs, axis-order fix |
| `panel.ts`, `panel.css` | the panel UI (plain DOM, `ordt-` CSS prefix) |
| `footprints-layer.ts` | footprints overlay on the MapLibre map |
| `host.ts` | host API methods used beyond the template's `host-api.ts` |

`src/geolibre.ts` is the plugin entry. The template's MapLibre control, React wrapper and examples under `src/lib/` and `examples/` are still in the repo but not part of the GeoLibre bundle.

`tests/fixtures/queries.json` is meant as a shared test oracle with openrndt, which should build the same queries.

## License

MIT, from the [GeoLibre plugin template](https://github.com/opengeos/geolibre-plugin-template).
