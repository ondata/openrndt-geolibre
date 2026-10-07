---
type: Reference
title: URL parameters
description: The query parameters of a GeoLibre address that the plugin owns, one per field of the search form, and how GeoLibre's ?plugin= combines with them.
tags: [link, url-parameters, deep-link]
status: stable
sources:
  - id: url-params
    resource: ../../src/rndt/url-params.ts
    title: Parser of the parameters
  - id: entry
    resource: ../../src/geolibre.ts
    title: Plugin entry, handleUrlParameters
  - id: tests
    resource: ../../tests/url-params.test.ts
    title: Tests of the parser
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
---

# Schema

| Parameter | Value | Form field |
|---|---|---|
| `rndt` | the text; a record id opens that record | text |
| `rndtBbox` | `west,south,east,north` in WGS84 degrees; the map moves there | area |
| `rndtWithin` | `1` | Inside the area |
| `rndtKind` | `data`, `services`, `all` (the default) | type |
| `rndtService` | `view`, `download`, `discovery`, `transformation`, `invoke`, `other`, comma separated | service types |
| `rndtAs` | `WMS`, `WFS`, `ArcGIS REST` (`arcgis`), comma separated | available as |
| `rndtMode` | `any`, `lucene` | match mode |
| `rndtField` | `title`, `abstract`, `lineage`, `limitation` | field |
| `rndtKeywords` | comma separated | keywords |
| `rndtOrg` | a part of the name | organisation |
| `rndtOrgNot` | `1` | hide the organisation |
| `rndtTheme` | INSPIRE theme code (`hy`, `cp`, `au`, …) | INSPIRE theme |
| `rndtOpen` | `1` | open data only |
| `rndtDate` | `revision`, `publication`, `creation`, `catalogue` | date field |
| `rndtFrom`, `rndtTo` | `yyyy-mm-dd` | date range |
| `rndtSort` | `title`, `title-desc`, `newest`, `oldest` | sort |

`rndt` and `rndtBbox` from version 0.1.6, the others from version 0.2.0 (#30). The names are case-sensitive (`?Rndt=` is not read) and public once a link is shared: they are not to be renamed. The short values (`abstract`, `newest`, `publication`) stand for the field names the catalogue uses, so a link does not change if those do. The theme codes are the INSPIRE registry's, mapped to the Italian labels the catalogue stores; all 34 checked against `https://inspire.ec.europa.eu/theme/theme.it.json` on 2026-10-04.[^url-params]

# Rules

- A link starts from an empty form: every field it does not name is at its default, so the same link gives the same search to everyone (from version 0.2.0; before, the other filters stayed as they were).
- Without `rndtBbox` the area is **Anywhere**: see [the decision](../decisions/link-searches-anywhere.md).
- `rndtTheme` and `rndtOpen` do nothing with `rndtKind=services`: the catalogue gives services no theme and no licence (0 of 3,163 services have `INSPIRETheme_s` or `isOpendata`, 2026-10-07), as in the form. The panel shows no chip for them and offers **Search datasets with a WMS**, which keeps them and searches datasets instead (#33).
- `rndtWithin` without `rndtBbox`, and `rndtDate` without `rndtFrom` or `rndtTo`, change nothing.
- With `rndtBbox` the map moves to the box instead of moving to Italy.
- The numbers of the box can be separated by commas, semicolons or spaces. A box that is not valid (not four numbers, out of range, west not less than east) is ignored with a warning in the browser console, and so is any other value that is not valid; the rest is still searched.
- `rndtTheme` with several codes uses the first known one: the form filters on one theme.
- A parameter repeated takes its first value.
- `?rndt` with no value, and no box, does nothing.
- A link is followed once per page load: GeoLibre gives the parameters again at every project it opens, and the plugin ignores a link it already followed (from 0.1.7).
- With a project that carries a search (`?url=<project>&rndt=…`), the link wins.

# How GeoLibre handles them

The plugin declares the names in `urlParameterNames`. When one is in the address GeoLibre activates the plugin, if it is registered, and calls `handleUrlParameters`.[^entry] These two parameters never install the plugin.

GeoLibre after 3.2.0 (`main`, on web.geolibre.app) adds its own `?plugin=openrndt-geolibre`. Seen on 2026-10-04:[^log]

| Link | Plugin installed | What happens |
|---|---|---|
| `?plugin=openrndt-geolibre` | no | "Install this plugin?" with name, version, author, description, homepage; after **Trust and load** it is installed and opens |
| `?plugin=openrndt-geolibre` | yes | it opens |
| `?plugin=openrndt-geolibre&rndt=idrografia` | yes | it opens and searches (1,131 records) |
| `…&layout=viewer` | yes or no | it does not open; Diagnostics: "only built-in plugins open in layout=viewer" |

`layout=viewer` is GeoLibre's read-only chrome, for embedding a map: the plugin cannot be reached through it at all. GeoLibre's docs say only that the viewer skips the install: asked in [opengeos/GeoLibre#2898](https://github.com/opengeos/GeoLibre/issues/2898). See also [Share a search](../guides/share-a-search.md).

# Examples

```text
https://web.geolibre.app/?rndt=idrografia
https://web.geolibre.app/?rndt=catastale&rndtBbox=12.95,37.60,14.30,38.30
https://web.geolibre.app/?rndt=c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2
https://web.geolibre.app/?rndt=fiumi&rndtKind=data&rndtTheme=hy&rndtAs=WMS&rndtSort=newest
```

Tried on web.geolibre.app on 2026-10-03: the first gave 1,131 records, the second 125 with the map on the box, the third opened the record "Catasto Urbano 1:1500 - Geo-servizio WMS". The fourth, on 2026-10-04 with a local build: chips Data, WMS, Hydrography, sort newest first, 30 records.[^log]

[^url-params]: Parser of the parameters
[^entry]: Plugin entry, handleUrlParameters
[^log]: LOG, 2026-10-03 and 2026-10-04
