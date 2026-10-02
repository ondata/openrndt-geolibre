# Plan - WMS outside EPSG:3857 with GeoLibre 3.2.0 (`crs` in `addWmsLayer`, issue #1)

## Context (2026-10-02)

GeoLibre 3.2.0 (2026-10-01) ships #2695, #2701 and #2707: `addWmsLayer` takes `crs` and Desktop redraws the tiles into Web Mercator. The plugin (0.1.0-alpha.7) does not pass `crs` yet, so it still asks EPSG:3857. On the cadastral WMS of Agenzia delle Entrate (record "Cartografia catastale - Comune di BORORE") the map showed a blue pattern repeated in every tile. Measured with curl on `wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php`:

- the group layer `Cartografia_Catastale` answers any GetMap (EPSG:3857 or EPSG:6706, any BBOX, any size) with the same 500×500 PNG of Italy with the provinces, 94,626 bytes: that is the pattern in the tiles;
- the EPSG:3857 test tile was asked on that layer, got that PNG and marked all 11 layers as "the server drew a test tile";
- `province` and `CP.CadastralParcel` in EPSG:3857 answer a `ServiceExceptionReport` ("Richiesta … non valida"), hence the Diagnostics errors;
- `CP.CadastralParcel` and `fabbricati` in EPSG:6706 on a 200 m box answer a 256×256 PNG with content (91,876 and 67,722 bytes).

## Phase 1 - Test tile that cannot be fooled (done)

- [x] a PNG answer counts only if it has the size asked (64×64, from the IHDR); the test is asked on a layer that holds no other layers → verify: unit test with the 500×500 header, panel test

## Phase 2 - Pass `crs` when the host takes it (done)

- [x] `pickWmsCrs(layer, version)` in `ogc.ts`: the first geographic system the layer lists (EPSG:4326, EPSG:4258, EPSG:6706, CRS:84 only with 1.3.0), else its first `EPSG:<code>`; EPSG:3857 stays the choice when declared or when the test tile passes → verify: unit tests (cadastre EPSG:6706, Lombardy, projected only)
- [x] host with `crs` = host with `importLayerStyle`; on it the layers are enabled with the note "asked in EPSG:6706 and redrawn by GeoLibre"; on an older host they stay disabled, "it needs GeoLibre 3.2.0 or later" → verify: panel tests with and without `importLayerStyle`
- [x] `crs` in `WmsLayerOptions` (`host.ts`) → verify: `tsc`

## Phase 3 - Group layer that returns a fixed picture (done)

- [x] each group layer (at most 10) gets one test tile in its system, EPSG:3857 or geographic; an image of another size disables it with the reason → verify: panel test; live with curl, `Cartografia_Catastale` 500×500, `vestizioni` and the others 64×64

## Phase 4 - Wrap-up

- [x] LOG, README (known limits); build copied to the Windows plugins folder
- [x] test in GeoLibre Desktop 3.2.0 (user, 2026-10-02): parcels of Mesero drawn over the orthophoto in EPSG:6706, group layer disabled with its reason; one tile missing: the cadastral server answers 500 to part of the tiles asked together (reproduced with curl)
- [x] issue #1 closed, release 0.1.0-alpha.8

## Review

- 190 tests green, `tsc`, ESLint and build clean. Not verified: how GeoLibre 3.2.0 draws EPSG:6706 tiles in Desktop (the user's test).
- A group layer whose only listed system is projected gets no test: the box of the test tile is computed only in EPSG:3857 and in degrees.

## Unresolved questions

- note on scale limits (`MinScaleDenominator`/`MaxScaleDenominator`: parcels only below 1:5,000), as for ArcGIS: separate issue?

---

# Plan - ArcGIS REST services (MapServer, ImageServer, FeatureServer)

## Context (2026-10-01)

GeoLibre adds ArcGIS REST from its Add Data dialog; plugins do not get `addArcGISLayer`, but `addTileLayer` on the service's `export` request does what it does for images, and `query?f=geojson` gives features. 653 records link ArcGIS but no WMS/WFS; 444 of them have a live service drawing EPSG:3857.

## Phase 0 - Does it hold (done)

- [x] `addTileLayer` keeps `{bbox-epsg-3857}` (`proxyWmsTiles` touches only `wms`); GeoLibre's own ArcGIS layers use direct tiles too → verify: GeoLibre 3.1.0 source
- [x] CORS on `export` with Origin `http://tauri.localhost` → verify: 175 of 176 usable services

## Phase 1 - Images (done)

- [x] `arcgis.ts`: links, service description, errors with HTTP 200, `export` URL, scale note → verify: `tests/arcgis.test.ts` with live fixtures
- [x] kind "ArcGIS REST" in `records.ts`, one group per service with the layer as hint → verify: tests
- [x] `openArcgis`: layer list, browser test image (CORS), Add to map (N) → verify: panel tests, headless on Arpae, Lombardy, Piemonte, Milano

## Phase 2 - Features (done)

- [x] count, pages of `maxRecordCount`, 10,000 question, raster layers excluded → verify: headless, Arpae 2,006 features in 3 pages

## Phase 3 - Search (done)

- [x] "Available as" ArcGIS REST pill (regex on `links_s`) → verify: 1,621 records, filter = badge on 2,000 records
- [x] REST endpoint derived from ArcGIS WMTS → verify: Arpa Piemonte NDVI

## Phase 4 - Wrap-up

- [x] README, Search help, LOG
- [x] test in GeoLibre Desktop (user): Arpae Depuratori 2023 drawn, Diagnostics 0

## Unresolved questions

- ask upstream to expose `addArcGISLayer` to plugins (cached tiles, legend)?
- report the 133 Milano records with a host gone to RNDT?

---

# Plan - fill the search form from a curl command or an RNDT URL (reverse of the `curl` button)

## Context (2026-10-01)

The `curl` button copies the search on screen as `curl -sG …/rest/metadata/search --data-urlencode 'q=…' …` (`buildCurlCommand`, `src/rndt/query.ts`). The user wants the reverse: paste a command (or a search URL) into the plugin, get the form filled, run it. The form already has a Lucene text mode (`textMode: "lucene"`), so any clause the plugin did not write can still be kept as raw Lucene.

## Phase 0 - Search by record id (done 2026-10-01)

- [x] an id alone in the search box opens the record (`fileid:"…"`), filters ignored; not an id → normal search → verify: unit and panel tests, live on 3 ids

## Phase 1 - Parser (pure, in `query.ts`)

- [ ] `parseSearchRequest(input)`: accepts the plugin's curl (`-G`, `--data-urlencode`, `-d`, `\` line breaks, single and double quotes) and a plain search URL; returns `q`, `bbox`, `spatialRel`, `sort`, `start` → verify: unit tests on the plugin's own output and on a hand-written URL
- [ ] `formFromQuery(built)`: splits `q` on top-level `AND` and maps back each clause the plugin writes (text group and field, keywords, organisation with Hide/Only, INSPIRE themes, open data, Available as, date, Type and service types); unknown clauses go together into the text as Lucene → verify: round trip `formFromQuery(parse(buildCurlCommand(form))) == form` on a table of forms covering every field
- [ ] reject anything that is not an RNDT search (other host or path) with a clear message → verify: test

## Phase 2 - Panel

- [ ] entry point (see questions), fills the form, opens Advanced filters when they are used, runs the search from the `start` in the command → verify: headless, paste a copied curl, same results and same chips as before
- [ ] message saying which parts became raw Lucene, if any → verify: headless with a hand-written query

## Unresolved questions

- entry point: paste into the search box (detected when it starts with `curl` or holds `/rest/metadata/search`), or an item "Paste curl or URL…" in the ⋯ menu with a text area? I'd go with the search box: no new UI.
- `num` in the command (page size) ignored, the panel keeps 20?
- base URL other than `geodati.gov.it/RNDT`: refuse, or accept since the base URL can be changed in openrndt?

---

# Plan - make the repo public for testers (no GeoLibre plugin registry submission yet)

## Context (2026-09-30)

The repo is private; two friends will test the plugin and open issues. The README exists but describes the panel as it was before today (organisation name click, "Copy query", layer menus) and speaks to developers. Nothing from today is committed. Checked: no secrets in the history (only `${{ secrets.GITHUB_TOKEN }}` in an old template workflow), no tags, no GitHub releases.

## Phase 1 - Commit

- [x] commit the state the testers have, then the detail view → verify: `git diff --cached --stat` matches the work; `npm test` green on each commit

## Phase 2 - Welcome page for testers

- [x] README top part for testers: what the plugin does in a few lines, a screenshot from GeoLibre Desktop, install from the release zip (Manage Plugins > Settings > Install from file, or the plugins folder per OS), how to report a problem (issue with GeoLibre version, OS, record, URL, Diagnostics); current features and known limits updated; development section below → verify: read it as a tester
- [x] repo description in English, topics (geolibre, rndt, inspire, wms, wfs, open-data, italy)
- [x] issue templates: bug report and idea → verify: "New issue" shows them

## Phase 3 - Release and visibility

- [x] version 0.1.0-alpha.4, pre-release on GitHub with the zip attached → verify: download and install the zip
- [x] repo public (only after an explicit go) → verify: open the URL logged out

## Open questions

- none: screenshot from the user; template leftovers removed on request

---

# Plan - detail view (mockup 1c)

## Context (2026-09-30)

Phase 3 of the panel redesign. State before starting saved in `tmp/pre-detail.patch`; the zip sent to two testers is `tmp/sent-to-friends-2026-09-30.zip` (uncommitted tree, labelled 0.1.0-alpha.3).

## Step A - Dedicated view

- [x] clicking a result title (or a footprint on the map) opens a view with "← N results", title, type and formats, organisation, "Metadata updated <date>", full abstract, services, other links, and Zoom to extent / Metadata / ⋯ (ISO XML, Copy id, Hide footprint) → verify: tests through one `openDetail` helper
- [x] while it is open: form, help, settings, chips, results header, list and pager hidden; search bar and footer stay → verify: test
- [x] "← N results" closes it and scrolls the card back into view; every search, page change, sort, chip ×, Clear all and Clear results closes it first → verify: tests
- [x] the inline expanded card goes away (no dead code); footprint toggles are synced in the whole panel, not only in the list → verify: footprint test

## Step B - Layer checklist

- [x] WMS/WFS capabilities are read when the view opens, one block per service: "<n> layers · host", Open, Copy URL → verify: tests
- [x] WMS: checklist (readable title, code below in monospace), filter above 30 layers (hidden rows stay checked; the button title says so), layers not in EPSG:3857 disabled with the reason; "Add to map (N)" adds each checked layer, named with the readable title (code as fallback); a failing layer is reported by name → verify: tests
- [x] WFS: same list with single choice (radio), because each add is a download with count, limit and confirmation; "Only features in the current map view" and the rest of the flow unchanged → verify: WFS tests
- [x] RNDT readable-name lookups: the bulk one when the block renders, the per-code one only after the first pointer or focus on the list (as with the old menu) → verify: lookup tests
- [x] every error keeps "Copy error report" and the error log → verify: report tests

## Not done

- tile errors next to the added layer: in GeoLibre 3.1.0 `addWmsLayer` returns a store layer id and serves tiles through the native protocol; the MapLibre source id and its error events are not exposed to plugins, so the count cannot be tied to the layer without guessing

## Wrap-up

- [x] tests, typecheck, lint, headless screenshots at 320 and 380 px, LOG.md, build, copy to %APPDATA%; the testers' zip is not rebuilt unless asked
- [ ] test in GeoLibre Desktop

## Open questions

- none for now

---

# Plan - plugin settings and log of failing URLs

## Context (2026-09-30)

Request: a gear icon with the plugin settings, per user, local, off by default; first option: save a log of URLs that are unreachable or return an error.

What GeoLibre 3.1.0 offers a plugin (verified in `usePlugins.ts` at tag v3.1.0): no API for settings; `exportTextFile(nome, testo, {description, extensions, mimeType})` opens the "Save as" dialog. The plugin cannot write files by itself: the log is kept in `localStorage` (of the webview, on the user's computer) and exported on request.

## Phase 1 - Settings

- [x] "⚙ Settings" in the footer next to "Search help": opens a box like the help; the panel header belongs to GeoLibre and takes no buttons → verify: test open/close
- [x] settings in `localStorage` (`openrndt-geolibre:settings`), read/write in try/catch, everything off by default; without storage the panel works the same → verify: test with fake storage and with storage that throws

## Phase 2 - Error log

- [x] checkbox "Log service URLs that fail (unreachable or errors)", off by default
- [x] if on: every capabilities, GetFeature or download error adds a line: UTC time, record id and title, organisation, service type, URL, error; at most 1,000 lines, the oldest leave first → verify: test on WMS errors
- [x] in the box: "N entries", "Export JSON Lines" (via `exportTextFile`, `openrndt-errors.jsonl`), "Clear log" → verify: test on the exported lines
- [x] off: nothing is recorded; the log already saved stays until it is cleared

## Phase 3 - Wrap-up

- [x] tests, typecheck, lint, LOG.md, build, copy to %APPDATA%
- [ ] test in Desktop (persistence after restart, Save as)

## Open questions

- none (footer, JSON Lines, 1,000 lines: decided by the user)

---

# Plan - panel redesign (claude.ai/design "RNDT Panel Proposta", version of 2026-09-30 20:22)

## Context (2026-09-30)

The proposal keeps Previous/Next, labels the date as "Metadata", shows the advanced filters (Match, Search in, theme, keyword, Organisation with "Show only these / Hide these", Date with the shortcuts). All controls already exist: the layout changes, not the query. Only new feature: "Recent searches". To confirm before executing.

## Phase 1 - Search form

- [x] Type (All/Data/Services), Where, Available as in view; the rest in "Advanced filters", collapsed, with the number of active filters → verify: existing tests on submit and reset
- [x] Match and Organisation "Show only these / Hide these" as segmented controls → verify: same query as today
- [x] "Open data only" in the advanced filters with its "?"
- [ ] "Open data only" disabled with Services (postponed: today it is ignored, the help says so)
- [x] "?" on theme, Keywords, Organisation, Open data, Date; the rest in "Search help" at the bottom, clickable examples included → verify: tests updated
- [ ] "Recent searches": postponed to later

## Phase 2 - Results

- [x] removable chips, no per-chip menu; × removes and reruns; "Edit filters", "Clear all" (with 2+ chips, keeps the text) → verify: chip and Clear all tests
- [x] header: ‹ range ›, `curl`, Sort (reruns from the first page), ⋯ (Clear results), "Zoom to results" and "Hide footprints" in view → verify: sort and pager tests
- [x] card with fixed rows, "Metadata <date>"; ⋯ with Hide/Show only organisation, Zoom to extent, Hide footprint → verify: organisation ⋯ test
- [x] visual test in headless Chromium at 380 px (`tmp/harness` bench)

## Phase 3 - Detail (bigger job)

- [ ] dedicated view with "← N results" that goes back to the same page and position; click on a footprint opens the detail → verify: test, test in Desktop
- [ ] capabilities read when the detail opens, one block per service (WMS, WFS, download); checkbox list with filter above 30 layers; layers outside EPSG:3857 not selectable, with reason → verify: test
- [ ] "Add to map (N)" for WMS, name = readable title; WFS keeps count, limit and "visible area only" → verify: test on names and WFS
- [ ] tile errors next to the added layer, if the source can be derived from `getMap` → verify: test in Desktop

## Phase 4 - Wrap-up

- [x] `npm test`, typecheck, lint, LOG.md, build, copy to %APPDATA%
- [ ] test in GeoLibre Desktop

## Open questions

- none (Where starts from "Current map view", decided by the user)

---

# Plan - "Reset filters" in the summary row

## Context (2026-09-30)

After a search the filters collapse into the summary and the Reset button, at the bottom of the form, is no longer visible: to clear them you need "Edit filters", scroll, "Reset".

## Phase 1 - Link in the summary

- [x] "Reset filters" link next to "Edit filters", only if there is at least one filter; clears the form (text included, like Reset), does not rerun the search, opens the empty filters, hides the summary; the results stay → verify: test in `tests/plugin.test.ts`

## Phase 2 - Wrap-up

- [x] `npm test`, typecheck, lint, LOG.md, build and copy to %APPDATA%
- [ ] test in GeoLibre Desktop

## Open questions

- none

---

# Plan - panel: fixed search and results, summarised filters

## Context (2026-09-29)

With "More filters" open the form takes up almost the whole height of the panel: only one result card is visible.

## Phase 1 - Layout

- [x] fixed bar at the top (sticky): text box and Search, outside the `<form>` but associated with the `form` attribute → verify: existing tests on submit and reset
- [x] after a search launched from the form the filters collapse; in their place a summary row of the active filters with "Edit filters" / "Hide filters" → verify: summary test
- [x] fixed results header under the bar: status, Previous/Next, Clear results, Zoom to results, Hide footprints, Copy query; Reset stays at the bottom of the filters → verify: test, test in GeoLibre Desktop
- [x] page change and selection from the map: the card does not end up under the fixed bars (`scroll-margin-top`) → verify: test in GeoLibre Desktop

## Phase 2 - Wrap-up

- [x] `npm test`, typecheck, lint, LOG.md, copy to %APPDATA%
- [ ] test in GeoLibre Desktop (sticky, summary, scroll on page change)

## Open questions

- sticky works only if the scrolling container is GeoLibre's, without `overflow: hidden` in between: to check in Desktop

---

# Plan - choosing overlapping footprints and map/list hover

## Context (2026-09-29)

The click on the map takes `features[0]`, the rectangle drawn on top: inside a small box (Palermo) one of the large boxes containing it is always selected.

## Phase 1 - Click

- [x] on click, all footprints under the cursor (without duplicates), sorted by increasing area → verify: test with nested boxes
- [x] only one: direct selection; more than one: menu with the titles on the map, from the smallest; hover on an entry highlights the box; Esc, click outside or map movement close it → verify: test, test in GeoLibre Desktop

## Phase 2 - Hover

- [x] highlight layer (line) separate from the selection → verify: filter tests
- [x] hover on a list card → highlighted box → verify: test in GeoLibre Desktop
- [x] hover on a box → tooltip with the title (the smallest under the cursor, "+N" if there are others) and card highlighted in the list → verify: test in GeoLibre Desktop

## Phase 3 - Wrap-up

- [x] `npm test`, typecheck, lint, LOG.md
- [ ] test in GeoLibre Desktop (plugin copied to %APPDATA%)

## Open questions

- tooltip: own label in the map container (the native `title` appears with a delay and does not update while the mouse moves)
- menu built by hand in the map container, not `maplibregl.Popup` (it would avoid a second copy of maplibre in the bundle)

---

# Plan - thematic filters of the portal's Ricerca Dettagliata

## Context (2026-09-27, measurements on geodati.gov.it, 23.831 records)

The portal form has five filters that the plugin does not have. "Tipo servizio" the plugin already has. Values and queries derived from the page code (`tmp/rd.html`, `tmp/groups.json`); the portal applies them only with "Dati".

| Portal filter | Field | Records with the field | Notes |
|---|---|---|---|
| Dataset prioritari | `PriorityDataset_s` | 1.055 | Acqua 272 confirmed by the portal (screenshot 2026-09-27). 6 groups, each a list of dozens of values (EU directives): Acqua 272, Aria e rumore 23, Industria 11, Marina 12, Natura e biodiversità 693, Rifiuti 18. "National legislation" (631) is in no group. The portal puts "National legislation" in the Natura e biodiversità group: 631 records that have only that value, almost all Alto Adige (Provincia di Bolzano 441, Consorzio dei Comuni BZ 83, Protezione civile 64, Merano 39), with titles such as "Numeri civici", "Infrastrutture". Without that value Natura drops from 693 to 62 and the total from 1.055 to 424. 35 records have only values outside the portal lists (variants and typos: "Monitoring stations associated to water bodies" 24, "River network (Water Framework Directive)" 20, "Direttiva 2000/60/EC" 14), mostly Autorità di bacino del Po |
| Dati aperti (DCAT themes) | `OpenDataTheme_s` | 23.831 (all) | 9 groups, each a list of INSPIRE themes (it + en): Agricoltura 201, Ambiente 8.951, Economia 10.498, Governo 1.385, Popolazione 264, Regioni e città 11.298, Salute 288, Scienza 2.855, Trasporti 1.135. The field also contains scattered keywords: it is a remapping of the INSPIRE themes, it overlaps the INSPIRE theme filter |
| Dati di elevato valore (HVD) | `DatiElevatoValore_s` | 499, 0 services | Dati geospaziali 361, Osservazione della terra e ambiente 138, Meteorologici 0, Mobilità 0 |

Portal defect: for "Dati relativi all'osservazione della terra e all'ambiente" it sends the straight apostrophe `'`, in the data there is `’` → 0 results instead of 138.

## Phase 1 - Decisions (to confirm, one filter at a time)

- [x] Ambito territoriale: excluded. Field filled in at the organisation's discretion: of the 2.270 records of the Comuni 1.994 do not have it, 248 say "Regionale" and only 28 "Locale"; 25 records of the Regioni are "Locale"; "Regionale" covers 92% of the values. For organisations, Organisation is used
- [x] Categoria ISO: excluded. Filled in on 99,5% of the data, closed list of 19 codes, but it repeats INSPIRE theme (20.660 records) with a coarser grid and in technical English; `planningCadastre` (11.714) is for 7.694 the Agenzia delle Entrate cadastre; weak link with the INSPIRE themes (Idrografia: 564 inlandWaters, 232 planningCadastre)
- [x] Dataset prioritari: postponed. Dirty values ("National legislation" in the Natura group, 35 records outside the lists): measurements in the table above, for when it is resumed
- [ ] which filters to add (proposal: HVD; "Dati aperti" no, because it repeats INSPIRE theme with broad groups)
- [ ] ignored with "Services", like INSPIRE theme and Open data only
- [ ] single selection (like INSPIRE theme today) or multiple
- [ ] HVD: send both forms of the apostrophe; hide or not the two entries at 0

## Phase 2 - Query

- [ ] new fields in `SearchForm`, clauses in `buildQuery` (groups expanded into an OR of quoted values) → verify: fixture in `tests/fixtures/queries.json`, `npm test`
- [ ] groups and lists in `constants.ts`, labels in English like the rest of the panel → verify: typecheck

## Phase 3 - Panel

- [ ] selects in the panel, hidden with "Services", with "?" following the `WHERE_HELP` pattern → verify: UI test, test in GeoLibre Desktop
- [ ] live counts for each filter against the measurements above → verify: same numbers

## Phase 4 - Wrap-up

- [ ] LOG.md, README if it lists the filters; note on the HVD apostrophe in openrndt `knowledge/api/known-issues.md` → verify: reading

## Open questions

- "Dati aperti" in or out?
- single or multiple?
- first close the work in progress (filter help, Date), then this?

---

# Plan - "?" help for all filters and revision of the Date filter

## Context (2026-09-27, measurements on geodati.gov.it, 23.831 records)

- Today only the search modes, "Search in" and "Where" have a "?". Missing: Resources, INSPIRE theme, Keywords, Organisation, Open data only, Date, Sort by.
- Date: with the checkbox "Include records without this date" ticked (default) the filter filters little. Revision since 2024: 6.517 records with the date, but the checkbox adds the 10.480 without revision, 17.000 results out of 23.831. Without date: Revision 10.480, Publication 15.338, Creation 13.536.
- The checkbox has no effect unless at least one date is entered.
- The three dates are resource dates (creation, publication, revision). "Sort by" instead sorts by metadata date (`apiso_Modified_dt`, present in all records): two different dates, to be stated.
- Keywords: exact and case-sensitive match. `opendata` 2.742, `OpenData` 8; `Idrografia` 976, `idrografia` 117.
- INSPIRE theme and Open data only apply to All and Data, they are ignored with Services: no service has a theme (0) or the open data flag (0).
- Organisation: "contains", case-insensitive, on the party responsible for the resource (`EnteResponsabile_s`), not on the metadata contact.
- Resources: Data = datasets and series (20.667), Services = services (3.164).

## Phase 1 - Date filter

Additional measurements (2026-09-27): no record lacks all three dates (0). 17.363 records out of 23.831 (73%) have only one: revision only 9.313, creation only 4.725, publication only 3.325; all three 1.840. The portal default "Considera valori vuoti" compensates for this: a strict filter on Revision loses the records dated only with creation or publication. With "any of the three dates" since 2024: 7.938 (against 6.517 on strict Revision and about 17.000 with the checkbox).

- [x] decision: remove the checkbox "Include records without this date" (strict filter when there is a date)
- [x] decision: no "Any date", the three separate dates stay
- [ ] small note, always visible, above the select: many records do not have the chosen date → verify: test in GeoLibre Desktop
- [ ] remove `includeMissingDates` from form, query and fixture → verify: `npm test`
- [ ] "?" help of the Date legend: what the three dates are, that almost all records have only one, difference with the metadata date of Sort → verify: reading

## Phase 2 - Help for the other filters

- [ ] Resources: what Data and Services are; with Services theme and open data are ignored
- [ ] INSPIRE theme: ignored with Services
- [ ] Keywords: exact and case-sensitive, with clickable examples `opendata` / `OpenData`
- [ ] Organisation: contains, case-insensitive, responsible organisation; you can click an organisation name in the results
- [ ] Open data only: keeps the records in which the organisation filled in the open data field (`isOpendata`, 16.792). Free, uncontrolled value: licences (CC BY 4.0 535 in a sample of 1000), just the marker "open data"/"opendata" (404 out of 1000), non-commercial licences too (286 with NC, not open data in the strict sense). Loses 1.367 records without the field but with a CC licence declared elsewhere. Ignored with Services
- [ ] Sort by: Relevance and metadata date
- same pattern as `WHERE_HELP` (constant + `helpToggle`) → verify: `npm test`, typecheck, test in GeoLibre Desktop

## Phase 4 - Spatial relation (done)

- `spatialRel=Within` supported by the REST: Palermo box 94 records against 878 for Intersects; `Contains` 706 (the national ones)
- [x] choice in "Where" between "touches the area" (Intersects, default) and "inside the area" (Within) → verify: `buildQuery` test, live counts

## Phase 5 - Excluding organisations (done)

- [x] "Invert" checkbox under Organisation (several organisations with commas), instead of a second field → verify: `buildQuery` fixture, live test (Messina 72 → 2, `ispra, torino` 517)
- [x] "Hide" button on the organisation name in the results → verify: UI test
- [x] NOT example in the Lucene help → verify: live count 8.133 → 436

## Phase 6 - Record type and Available as (done)

- [x] check on a sample: `links_s` filter against the plugin badges → 99% matching on 2.400 records
- [x] "Resources" → "Record type", help with the type/link difference
- [x] "Available as" WMS/WFS → verify: fixture, UI test, live test (`idrografia` 586)
- [ ] ArcGIS REST in "Available as" when the plugin is able to open it

## Phase 3 - Wrap-up

- [ ] LOG.md, README if it describes the filters → verify: reading

## Open questions

- decided: checkbox removed; one "?" for each field; `isOpendata` verified

---

# Plan - `crs` in `addWmsLayer` (issue #1)

## Context (2026-09-27)

- After issue #1 was opened, opengeos/GeoLibre#2695 was merged: the desktop's native WMS protocol also redraws projected CRSs in Web Mercator (any `EPSG:<n>`, resolved offline). The issue's "only `GEOGRAPHIC_WMS_CRS`" list is outdated.
- Python (`_normalize_wms_crs` in `project.py`) accepts `EPSG:3857`, the geographic CRSs of the list, `CRS:84` (only with 1.3.0) and any `EPSG:\d{4,6}`. The PR aligns with this.
- The CRS lives in the tile URL, which is saved in the project; Python does not write it in `source`. No code rebuilds the GetMap from `source` with a CRS (Cesium uses its own scheme, the clip export forces EPSG:4326 1.1.1). Item "crs in source" removed.
- Reprojection exists only in the desktop (Tauri). On the web a `crs` other than 3857 gives wrong tiles.
- `createWmsTileUrl` uses `appendQuery`, which appends without removing `SRS`/`VERSION` already present in the endpoint (Python removes them instead). To check whether `addWmsLayer` receives endpoints already cleaned.
- The Basilicata WMS today does not reply because of a DNS problem at the organisation: the name servers of `regione.basilicata.it` (78.40.170.22, 78.40.170.36) do not reply, SERVFAIL from dns.google too. Not a plugin defect.

## Phase 1 - Upstream issue (to confirm)

- [x] Skipped on request: direct PR, the questions are in the PR
- Questions to ask the maintainer: behaviour on the web (warn, error or documentation only), how a plugin can know whether the host supports `crs` (today no version exposed; an old host silently ignores `crs`)

## Phase 2 - PR to GeoLibre (new branch from `origin/main` in `~/git/GeoLibre`)

- [x] `normalizeWmsCrs` in `add-data/helpers.ts`, next to `normalizeWmsVersion`, which imports `GEOGRAPHIC_WMS_CRS` → verify: unit tests
- [x] `createWmsTileUrl` with `crs?` (default `EPSG:3857`): Add Data dialog unchanged → verify: existing tests green
- [x] `addWmsLayer`: destructures `crs`, validates, explicit error for values not allowed and for `CRS:84` with 1.1.1 → verify: test
- [x] tests: 4326 1.1.1 (`SRS=`), 4326 1.3.0 (`CRS=`), `CRS:84` 1.3.0, 25833, rejection of `CRS:84` + 1.1.1
- [x] JSDoc of `GeoLibreWmsLayerOptions` and `docs/plugin-api.md` ("desktop only") → verify: reading
- [x] `pre-commit run --files ...`, frontend suite, typecheck → verify: all green
- [x] PR in English, structure like #2695

## Phase 3 - Plugin (after the merge)

Status 2026-09-28: #2701, #2702 and #2707 merged, not yet in a release (latest 3.1.0). The maintainer has not replied about support detection. Decided: `typeof app.importLayerStyle === "function"` as the signal for both (merged one minute apart); with an old host the button stays disabled as today.

- [ ] `crs?` in `WmsLayerOptions` (`host.ts`), `importLayerStyle?` in the app type → verify: typecheck
- [ ] same rule as `defaultWmsCrs` of #2707 (3857, then geographic, then first EPSG), so plugin and native dialog choose the same CRS → verify: unit tests
- [ ] order of choice: `EPSG:3857`, then geographic ones of the list, then other EPSG; `CRS:84` only with 1.3.0; avoid EPSG:3003 if there is something else (offset of about 70 m, #2695)
- [ ] detection: `typeof app.importLayerStyle === "function"`; later an upstream proposal for a plugin API version → verify: test with fake host with and without the function
- [ ] check in GeoLibre Desktop: AdE cadastre aligned with the WFS, Basilicata when the DNS comes back

## Open questions

- upstream issue first, or direct PR?
- on the web: error or doc only?
- ~~detection of `crs` support from a plugin: how?~~ decided (`importLayerStyle` hint)

## Review

- PR opened: opengeos/GeoLibre#2701 (branch `feat/plugin-wms-crs` on the fork). Frontend tests 10079 ok, typecheck ok, eslint and oxfmt on the touched files ok (`docs/plugin-api.md` already had oxfmt problems, not touched). `pre-commit` on the lint of the whole repo runs out of memory in WSL.
- Not tested in a desktop build.

---

# Plan - SLD style of WFS (issue #10)

Unblocked by opengeos/GeoLibre#2702 (`importLayerStyle(layerId, text)`, SLD/QML/Mapbox GL), merged on 2026-09-27, not yet in a release.

## Phase 1 - Plugin

- [x] after `addGeoJsonLayer`, WMS `GetStyles` on the same GeoServer (`layers=<nome>`) → verify: unit test on the URL (2026-10-02; no Liguria fixture, the server is down)
- [x] pass the text to `importLayerStyle`; if the API is missing, or GetStyles fails, or the outcome is not ok, the default style stays without error → verify: panel test
- [x] test in GeoLibre Desktop 3.2.0 (user, 2026-10-02): Veneto `rv:c0501031_litologiareg_`, 3,341 features coloured by class, 1 warning from the reader
- [ ] Liguria `M5:L4` (33 classes, `minZoom: 12`) when its server is back

## Open questions

- GetStyles is always asked (one request; a server without that WMS answers no SLD)
- `minZoom: 12` from the SLD: kept as the reader gives it (the layer disappears at small scale): to look at on Liguria
