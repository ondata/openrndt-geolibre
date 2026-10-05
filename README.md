# openrndt-geolibre

A [GeoLibre](https://github.com/opengeos/GeoLibre) plugin to search the **RNDT** ([Repertorio Nazionale dei Dati Territoriali](https://geodati.gov.it/geoportale/), the Italian national catalogue of spatial data) and add its WMS, WFS and ArcGIS REST services to the map.

It is the GeoLibre counterpart of the [openrndt](https://github.com/ondata/openrndt) CLI and uses the same RNDT REST API (`https://geodati.gov.it/RNDT/rest/metadata/search`).

Status: **beta**, open for testing. It is in the [GeoLibre plugin registry](https://plugins.geolibre.app/): <https://plugins.geolibre.app/catalog/openrndt-geolibre/>

![The RNDT panel in GeoLibre Desktop: a record opened in the detail view, its WMS layers listed, one added to the map](docs/images/detail-view.png)

More in the [wiki](wiki/index.md): guides, reference, limits, the decisions taken and how to work on the plugin.

## Try it

You need [GeoLibre](https://github.com/opengeos/GeoLibre/releases) 3.3.0 or later.

1. In GeoLibre open **Settings > Manage Plugins**.
2. Find **RNDT catalogue** and choose **Install**.
3. Turn the plugin on from **Plugins > RNDT catalogue**.

After a new version reaches the registry, Manage Plugins offers an **Update** for it. Before GeoLibre 3.3.0 it marked the installed one "Failed" instead ("changed since you last trusted it"): there, uninstall it and install it again ([opengeos/GeoLibre#2833](https://github.com/opengeos/GeoLibre/issues/2833)).

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
- **Results**: active filters as removable chips, or a **Filters** link when there is none; with no record found, links that widen the search (anywhere instead of the map view, any word instead of all); pager, sort and a `curl` button that copies the query; cards with type, formats, organisation and metadata date; a ⋯ menu per card to hide or keep only its organisation. Footprints on the map, highlighted on hover in both directions; with overlapping footprints a click lets you choose.
- **Detail view**: a record opens in its own view with its abstract, services and links. WMS and WFS layers are listed as soon as it opens, with a readable name and the layer code. Tick one or more WMS layers and add them, named with their titles; a layer added from a dataset record is limited to the record's extent, when that is smaller than the service's (one municipality of a national service); for a WFS pick one feature type and download its features as GeoJSON (only in the current map view if you like; above 10,000 features the panel asks first). The features are drawn with the style the server gives for that layer (SLD), when it has one. An ArcGIS REST service (MapServer, ImageServer, FeatureServer) lists its layers the same way: ticked layers are added as images, and one layer's features can be downloaded as GeoJSON, page by page.
- **Recent searches**: a click in the search box lists the last 20 searches, with their filters, and the records opened by id; a click runs one again, on the area it had. Kept on your computer, can be turned off in Settings.
- **Share**: in the ⋯ of the results header (the search, or the record open) and of a record's detail view (that record), a GeoLibre web link that opens the same search for anyone, through the system share sheet or copied: see [Open a search from a link](#open-a-search-from-a-link).
- **For an AI agent**: **Copy for an agent**, in the ⋯ of the results header, copies the search as Markdown: the filters in words, the `curl` command, the records of the page as a table and how to go on with [openrndt](https://github.com/ondata/openrndt).
- **Contact**: in the detail view, **Contact** next to the organisation shows whom the record names as its point of contact and copies a ready email (in Italian) for any request: a question on the data, its licence, an update. With no address in the record, the email asks RNDT whom to write to.
- **Errors**: when a server is gone (its name is not in the DNS) the panel says so: after a failed request it asks Google's public DNS-over-HTTPS resolver (`dns.google`) whether the server's name exists, sending only that name; **Copy error report** prepares an email for the record's contact.
- **Settings** (⚙ in the footer, off by default, stored on your computer only): log the service URLs that fail and export the log as JSON Lines.

## Open a search from a link

From version 0.1.6 a link can open GeoLibre web on a search; from version 0.2.0 it carries every filter of the form. The parameters turn the plugin on, open the panel and start the search:

| Parameter | Value | Example |
|---|---|---|
| `rndt` | the text to search; a record id (as "Copy id" gives it) opens that record | `rndt=idrografia` |
| `rndtBbox` | search area as west, south, east, north; the map moves there | `rndtBbox=12.95,37.60,14.30,38.30` |
| `rndtWithin` | `1`: records inside the area, instead of touching it | `rndtWithin=1` |
| `rndtKind` | `data` or `services` | `rndtKind=services` |
| `rndtService` | service types: `view`, `download`, `discovery`, `transformation`, `invoke`, `other` | `rndtService=view,download` |
| `rndtAs` | available as `WMS`, `WFS`, `ArcGIS REST` (or `arcgis`) | `rndtAs=WMS,WFS` |
| `rndtMode` | `any` word, or `lucene` syntax, instead of all words | `rndtMode=any` |
| `rndtField` | search only in `title`, `abstract`, `lineage` or `limitation` | `rndtField=title` |
| `rndtKeywords` | keywords, comma separated | `rndtKeywords=idrografia` |
| `rndtOrg` | organisation, a part of its name | `rndtOrg=Regione Puglia` |
| `rndtOrgNot` | `1`: hide that organisation instead of keeping only it | `rndtOrgNot=1` |
| `rndtTheme` | INSPIRE theme, by its code (`hy` hydrography, `cp` cadastral parcels, `au` administrative units, …); data only | `rndtTheme=hy` |
| `rndtOpen` | `1`: open data only; data only | `rndtOpen=1` |
| `rndtDate` | the date the range applies to: `revision` (default), `publication`, `creation`, `catalogue` | `rndtDate=publication` |
| `rndtFrom`, `rndtTo` | date range, `yyyy-mm-dd` | `rndtFrom=2020-01-01` |
| `rndtSort` | `title`, `title-desc`, `newest`, `oldest` (default: relevance) | `rndtSort=newest` |

```text
https://web.geolibre.app/?rndt=idrografia
https://web.geolibre.app/?rndt=catastale&rndtBbox=12.95,37.60,14.30,38.30
https://web.geolibre.app/?rndt=fiumi&rndtKind=data&rndtTheme=hy&rndtAs=WMS&rndtSort=newest
```

A link starts from an empty form: the filters it does not name are at their defaults, and without `rndtBbox` the search is on the whole catalogue, so a link finds the same records for everyone. Names are case-sensitive. A value that is not valid is ignored, with a warning in the browser console, and the rest is still searched; `?rndt` with no value does nothing. The theme codes are those of the [INSPIRE registry](https://inspire.ec.europa.eu/theme).

**Share**, in the ⋯ of the results header and of a record's detail view, builds this link for you: the search on screen, or the record open. It hands the link to the system share sheet where the browser offers one (on Windows: nearby sharing, mail, WhatsApp, Teams…), and copies it otherwise.

The link Share builds starts with `?plugin=openrndt-geolibre`. On GeoLibre after 3.2.0 (already on web.geolibre.app) that installs the plugin for whoever lacks it, after asking ("Trust and load"), then runs the search. It does not work with `layout=viewer`, GeoLibre's read-only view, where plugins of the registry never open ([opengeos/GeoLibre#2898](https://github.com/opengeos/GeoLibre/issues/2898)).

With GeoLibre 3.2.0 the parameters work where the plugin is installed. For someone who does not have it, add a project that lists the plugin, such as [this one](https://gist.github.com/aborruso/68601ad2b7f4af7a9156ba932f1b10a6):

```text
https://web.geolibre.app/?url=https://gist.githubusercontent.com/aborruso/68601ad2b7f4af7a9156ba932f1b10a6/raw/rndt.geolibre.json&rndt=idrografia
```

The first time GeoLibre asks whether to load the plugin ("Trust and load"), then no more. The project loads the plugin from the registry, which has served 0.2.0, with the filters, since 2026-10-04.

## The search travels with the project

From version 0.1.7. When a GeoLibre project is saved, the panel's last search goes into it: text and filters, the area as the box that was searched, the page, and the record open in the detail view. Whoever opens the project finds the plugin on, the search done and that record open: a way to keep a search worth keeping, and to pass it on. The results themselves are not saved: the search runs again, so a catalogue that changed in the meantime can answer with other records.

It is also a way around the CORS limit of the web version: search and pick a record in the browser, save the project, open the file in GeoLibre Desktop, where every service can be read.

Things to know:

- When it saves, GeoLibre asks "Strip credentials?" and counts the fields of the search among them: it cannot know what an external plugin keeps in a project. Choose **Keep in file**: the search holds no key and no password. With "Strip credentials", and in a project shared with Share, the search is left out ([opengeos/GeoLibre#2821](https://github.com/opengeos/GeoLibre/issues/2821); the next GeoLibre release lets the registry declare it safe, see [#27](https://github.com/ondata/openrndt-geolibre/issues/27)).
- A search is not a change for GeoLibre: the project is not marked as modified, and closing without saving loses the search without a question. Save after the search you want to keep.
- A project that carries no search empties the panel when it is opened, so a search never passes from one project to another.
- On a computer without the plugin: a project saved where the plugin came from Manage Plugins carries its address, and GeoLibre asks whether to load it ("Trust and load"), then shows the search. A project saved where the plugin was copied by hand into the plugins folder carries no address: it opens without the plugin, and the search stays unused in the file.

## Known limits

- WMS layers not offered in `EPSG:3857` (for example the Agenzia delle Entrate cadastral WMS, native in `EPSG:6706`) need GeoLibre Desktop: the plugin asks them in a system the layer lists and GeoLibre redraws the tiles. A group layer that answers every request with one fixed picture (the cadastral `Cartografia_Catastale`) is disabled: tick its layers instead.
- In GeoLibre's web version the browser reads the services itself, so a WMS, WFS or ArcGIS server that sends no CORS headers cannot be shown there. The plugin cannot work around it: the panel says so, and offers no error report since the server is not at fault. The same services work in GeoLibre Desktop, which reads them through its native client.
- WFS services without a GeoJSON output format cannot be added by the plugin. GeoLibre's own WFS layer can read GML services: try **Copy URL** in the service box, then **Add Data > WFS Layer**; the cadastral WFS of Agenzia delle Entrate fails there too ([opengeos/GeoLibre#2823](https://github.com/opengeos/GeoLibre/issues/2823): the next GeoLibre release gives plugins a way, see [#28](https://github.com/ondata/openrndt-geolibre/issues/28)).
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

## openrndt, the same catalogue from the command line

[openrndt](https://github.com/ondata/openrndt) is a command line tool, and a Python library, for the same catalogue. The plugin is its counterpart inside GeoLibre: the two ask the same REST API and are meant to build the same queries (`tests/fixtures/queries.json` is the shared test).

The plugin is for looking: a map, the footprints, a layer added with a click. openrndt is for the work a panel does not do:

- **Many records at once**: a search goes out as JSON, a table or CSV, with the fields chosen by a profile (`--profile qgis` gives a CSV with the service addresses in columns).
- **Footprints as a file**: `openrndt footprints` writes the extents of the results as GeoJSON.
- **One record in full**: `openrndt get <id>` gives contact, extent, lineage and resources, or the ISO 19139 XML.
- **The services of a record, checked**: `openrndt resources <id>` lists its WMS, WFS and download addresses and can test them.
- **Scripts and AI agents**: it is read-only and built to be driven step by step by an agent, with an Agent Skill (`rndt-explorer`) in its repository. The idea is that the agent composes queries to the official catalogue and gets real metadata and addresses back, instead of making them up.

```bash
uv tool install openrndt          # or, without installing: uvx openrndt --help
openrndt search --q "catasto" --bbox 12.95,37.60,14.30,38.30 --num 10
openrndt resources age:D_E973_MARSAGLIA
```

The two meet on the record id: **Copy id** in the panel gives the id that `openrndt get` and `openrndt resources` take, and an id typed in the panel's search box opens that record. The `curl` button of the panel copies the request of the last search, to repeat it outside GeoLibre.

## License

MIT, Copyright (c) 2026 Andrea Borruso <andrea.borruso@ondata.it>. Started from the [GeoLibre plugin template](https://github.com/opengeos/geolibre-plugin-template) by Qiusheng Wu, also MIT: its notice stays in [LICENSE](LICENSE) for the parts that come from it.
