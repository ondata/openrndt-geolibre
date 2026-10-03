# openrndt-geolibre

A [GeoLibre](https://github.com/opengeos/GeoLibre) plugin to search the **RNDT** ([Repertorio Nazionale dei Dati Territoriali](https://geodati.gov.it/geoportale/), the Italian national catalogue of spatial data) and add its WMS, WFS and ArcGIS REST services to the map.

It is the GeoLibre counterpart of the [openrndt](https://github.com/ondata/openrndt) CLI and uses the same RNDT REST API (`https://geodati.gov.it/RNDT/rest/metadata/search`).

Status: **beta**, open for testing. It is in the [GeoLibre plugin registry](https://plugins.geolibre.app/).

![The RNDT panel in GeoLibre Desktop: a record opened in the detail view, its WMS layers listed, one added to the map](docs/images/detail-view.png)

## Try it

You need [GeoLibre](https://github.com/opengeos/GeoLibre/releases) 3.2.0 or later.

1. In GeoLibre open **Settings > Manage Plugins**.
2. Find **RNDT catalogue** and choose **Install**.
3. Turn the plugin on from **Plugins > RNDT catalogue**.

From a zip, for a version that is not in the registry yet:

1. Download `openrndt-geolibre-<version>.zip` from the [latest release](https://github.com/ondata/openrndt-geolibre/releases).
2. In GeoLibre Desktop open Manage Plugins, go to Settings, choose **Install from file** and pick the zip.
3. Restart GeoLibre, then turn the plugin on from **Plugins > RNDT catalogue**.

Manual install, if you prefer: unzip into a folder named `openrndt-geolibre` inside GeoLibre's plugins folder, so that `plugin.json` and `dist/` sit directly in it, then restart GeoLibre.

| System | Plugins folder |
|---|---|
| Windows | `%APPDATA%\org.geolibre.desktop\plugins\` |
| macOS | `~/Library/Application Support/org.geolibre.desktop/plugins/` |
| Linux | `~/.local/share/org.geolibre.desktop/plugins/` |

## Report a problem or an idea

Open an [issue](https://github.com/ondata/openrndt-geolibre/issues/new/choose). For a problem, please include:

- GeoLibre version and operating system;
- what you searched and which record (its title, or the "Copy id" of the record);
- the error shown in the panel, and the lines of **Diagnostics** (bottom right in GeoLibre) about it;
- a screenshot, if it helps.

When a service fails, the panel offers **Copy error report**: a ready-to-paste email for the record's contact (with RNDT in copy) about a broken service. That is for the data publisher; problems of the plugin itself go in the issues here.

## What it does

- **Search**: free text, type (all, data, services), where (anywhere, current map view, shapes drawn with GeoEditor, a typed box; touching or inside the area), available as WMS/WFS/ArcGIS REST. Advanced filters: match mode (all words, any word, Lucene), field, INSPIRE theme, keywords, organisation (show only or hide), open data only, dates (revision, publication, creation, added to catalogue), sort. Without a text the results come newest metadata first, since the catalogue has nothing to weigh for relevance; with a text, by relevance. A record id typed alone (as "Copy id" gives it) opens that record, whatever the filters. "?" buttons and **Search help** explain each filter with clickable examples. When the plugin is turned on and the map view is not on Italy, the map moves to Italy; a view already on Italy stays where it is.
- **Results**: active filters as removable chips; pager, sort and a `curl` button that copies the query; cards with type, formats, organisation and metadata date; a ⋯ menu per card to hide or keep only its organisation. Footprints on the map, highlighted on hover in both directions; with overlapping footprints a click lets you choose.
- **Detail view**: a record opens in its own view with its abstract, services and links. WMS and WFS layers are listed as soon as it opens, with a readable name and the layer code. Tick one or more WMS layers and add them, named with their titles; a layer added from a dataset record is limited to the record's extent, when that is smaller than the service's (one municipality of a national service); for a WFS pick one feature type and download its features as GeoJSON (only in the current map view if you like; above 10,000 features the panel asks first). With GeoLibre 3.2.0 or later the features are drawn with the style the server gives for that layer (SLD), when it has one. An ArcGIS REST service (MapServer, ImageServer, FeatureServer) lists its layers the same way: ticked layers are added as images, and one layer's features can be downloaded as GeoJSON, page by page.
- **Errors**: when a server is gone (its name is not in the DNS) the panel says so; **Copy error report** prepares an email for the record's contact.
- **Settings** (⚙ in the footer, off by default, stored on your computer only): log the service URLs that fail and export the log as JSON Lines.

## Open a search from a link

From version 0.1.6. Two parameters in the address of GeoLibre web turn the plugin on, open the panel and start a search:

| Parameter | Value | Example |
|---|---|---|
| `rndt` | the text to search; a record id (as "Copy id" gives it) opens that record | `?rndt=idrografia` |
| `rndtBbox` | search area as west, south, east, north; the map moves there | `?rndtBbox=12.95,37.60,14.30,38.30` |

```text
https://web.geolibre.app/?rndt=idrografia
https://web.geolibre.app/?rndt=catastale&rndtBbox=12.95,37.60,14.30,38.30
```

Without `rndtBbox` the search is on the whole catalogue, so a link finds the same records for everyone. Names are case-sensitive. A box that is not valid is ignored, with a warning in the browser console; `?rndt` with no value does nothing.

These links work where the plugin is installed: GeoLibre never installs a plugin from a link. For someone who does not have it, add a project that lists the plugin, such as [this one](https://gist.github.com/aborruso/68601ad2b7f4af7a9156ba932f1b10a6):

```text
https://web.geolibre.app/?url=https://gist.githubusercontent.com/aborruso/68601ad2b7f4af7a9156ba932f1b10a6/raw/rndt.geolibre.json&rndt=idrografia
```

The first time GeoLibre asks whether to load the plugin ("Trust and load"), then no more. The project loads the plugin from the registry, so the search starts once a version with these parameters is there. A way to do without the project is asked in [opengeos/GeoLibre#2819](https://github.com/opengeos/GeoLibre/issues/2819).

## The search travels with the project

From version 0.1.7. When a GeoLibre project is saved, the panel's last search goes into it: text and filters, the area as the box that was searched, the page, and the record open in the detail view. Whoever opens the project finds the plugin on, the search done and that record open: a way to keep a search worth keeping, and to pass it on. The results themselves are not saved: the search runs again, so a catalogue that changed in the meantime can answer with other records.

It is also a way around the CORS limit of the web version: search and pick a record in the browser, save the project, open the file in GeoLibre Desktop, where every service can be read.

Things to know:

- When it saves, GeoLibre asks "Strip credentials?" and counts the fields of the search among them: it cannot know what an external plugin keeps in a project. Choose **Keep in file**: the search holds no key and no password. With "Strip credentials", and in a project shared with Share, the search is left out ([opengeos/GeoLibre#2821](https://github.com/opengeos/GeoLibre/issues/2821)).
- A search is not a change for GeoLibre: the project is not marked as modified, and closing without saving loses the search without a question. Save after the search you want to keep.
- A project that carries no search empties the panel when it is opened, so a search never passes from one project to another.
- On a computer without the plugin: a project saved where the plugin came from Manage Plugins carries its address, and GeoLibre asks whether to load it ("Trust and load"), then shows the search. A project saved where the plugin was installed from a zip or a folder carries no address: it opens without the plugin, and the search stays unused in the file.

## Known limits

- WMS layers not offered in `EPSG:3857` (for example the Agenzia delle Entrate cadastral WMS, native in `EPSG:6706`) need GeoLibre Desktop 3.2.0 or later: the plugin asks them in a system the layer lists and GeoLibre redraws the tiles. With an older GeoLibre they stay disabled, and the panel says so. A group layer that answers every request with one fixed picture (the cadastral `Cartografia_Catastale`) is disabled: tick its layers instead.
- In GeoLibre's web version the browser reads the services itself, so a WMS, WFS or ArcGIS server that sends no CORS headers cannot be shown there. The plugin cannot work around it: the panel says so, and offers no error report since the server is not at fault. The same services work in GeoLibre Desktop, which reads them through its native client.
- WFS services without a GeoJSON output format cannot be added.
- ArcGIS REST layers are added as images through the service's `export` request, which GeoLibre's own ArcGIS layers use too: no cached tiles, no legend. Features need ArcGIS 10.4 or later (GeoJSON output); services that need a login cannot be added. The images are fetched by the webview, so the server must send CORS headers: the panel checks one test image first and says so when they are missing.
- GeoLibre Desktop opens no `mailto:` link from a plugin, so the error report is copied to the clipboard instead of opening your mail client.
- Footprints are a temporary map overlay, not a project layer, and need the MapLibre renderer.
- Footprints and "Zoom to extent" use the extent each record declares, as it is: when the metadata is wrong the footprint is in the wrong place (all 100 records of Comune di Capannori are drawn in Ethiopia), and a search by area does not find the record. The plugin does not try to correct it: the wrong extents come in too many shapes (see [#13](https://github.com/ondata/openrndt-geolibre/issues/13)).

## Development

Building in WSL and testing in GeoLibre Desktop on Windows:

```bash
npm install
npm run build
P=/mnt/c/Users/<user>/AppData/Roaming/org.geolibre.desktop/plugins/openrndt-geolibre
mkdir -p "$P" && cp -r geolibre-plugin/plugin.json geolibre-plugin/dist "$P"/
```

Restart GeoLibre Desktop, then Plugins > RNDT catalogue. `npm run package:geolibre` writes the zip for Install from file (`geolibre-plugin/openrndt-geolibre-<version>.zip`).

```bash
npm test                                                # unit tests (no network)
RUN_LIVE_TESTS=1 npx vitest --run tests/live.test.ts    # compare query totals with the live catalogue
npm run lint
```

`src/geolibre.ts` is the plugin entry; the code lives in `src/rndt/`:

| File | Role |
|---|---|
| `query.ts` | search form to REST query (pure, tested against `tests/fixtures/queries.json`) |
| `records.ts` | parsing of search results, service links, contacts, footprints |
| `ogc.ts` | WMS/WFS GetCapabilities parsing, GetFeature URLs, axis-order fix |
| `arcgis.ts` | ArcGIS REST links, service descriptions, `export` and `query` URLs |
| `layer-names.ts` | readable layer names from capabilities titles and RNDT records |
| `panel.ts`, `panel.css` | the panel UI (plain DOM, `ordt-` CSS prefix) |
| `footprints-layer.ts` | footprints overlay on the MapLibre map |
| `settings.ts` | plugin settings and the error log (localStorage) |
| `host.ts` | fetch helpers and host API methods beyond `src/lib/geolibre/host-api.ts` |

`tests/fixtures/queries.json` is meant as a shared test oracle with openrndt, which should build the same queries.

### A release in the plugin registry

The registry is the repository [opengeos/geolibre-plugins](https://github.com/opengeos/geolibre-plugins): each version gets there with a pull request, from the fork `ondata/geolibre-plugins`.

1. Release here: the version in `src/rndt/constants.ts`, `geolibre-plugin/plugin.json` and `package.json`, then `npm run package:geolibre` and a GitHub release with the zip. The version needs a higher number, not only another suffix: GeoLibre compares the numeric part alone, so between `0.2.0-alpha.1` and `0.2.0-alpha.2` it offers no update.
2. In the fork, on a branch from an updated `main`: copy `geolibre-plugin/plugin.json` and `geolibre-plugin/dist/` to `plugins/openrndt-geolibre/`, and set the same version in the plugin's entry of `plugin-registry.json`.
3. There, run `npm ci && npm run minify && npm run minify:check`, `node scripts/validate_plugins.mjs` and `pre-commit run --all-files`: the Minify workflow cannot push to a fork.
4. Open the pull request. Its preview, `https://opengeos.org/pages-preview/geolibre-plugins/pr-<N>/`, runs GeoLibre's web version with the plugin loaded.

## License

MIT, Copyright (c) 2026 Andrea Borruso <andrea.borruso@ondata.it>. Started from the [GeoLibre plugin template](https://github.com/opengeos/geolibre-plugin-template) by Qiusheng Wu, also MIT: its notice stays in [LICENSE](LICENSE) for the parts that come from it.
