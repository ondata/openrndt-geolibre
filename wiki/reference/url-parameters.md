---
type: Reference
title: URL parameters
description: The two query parameters of a GeoLibre address that the plugin owns, rndt and rndtBbox.
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

| Parameter | Value | Effect |
|---|---|---|
| `rndt` | the text to search | the panel opens, the text is written and searched; a record id opens that record |
| `rndtBbox` | `west,south,east,north` in WGS84 degrees | the search is limited to that box (relation "Touches the area") and the map moves there |

From version 0.1.6. The names are case-sensitive: `?Rndt=` is not read.[^url-params]

# Rules

- Without `rndtBbox` the area is **Anywhere**: see [the decision](../decisions/link-searches-anywhere.md).
- With `rndtBbox` the map moves to the box instead of moving to Italy.
- The numbers of the box can be separated by commas, semicolons or spaces. A box that is not valid (not four numbers, out of range, west not less than east) is ignored with a warning in the browser console; the text is still searched.
- A parameter repeated takes its first value.
- `?rndt` with no value, and no box, does nothing.
- The other filters of the form stay as they are.
- A link is followed once per page load: GeoLibre gives the parameters again at every project it opens, and the plugin ignores a link it already followed (from 0.1.7).
- With a project that carries a search (`?url=<project>&rndt=…`), the link wins.

# How GeoLibre handles them

The plugin declares the names in `urlParameterNames`. When one is in the address GeoLibre activates the plugin, if it is registered, and calls `handleUrlParameters`.[^entry] GeoLibre never installs a plugin from a link: see [Share a search](../guides/share-a-search.md) and [Requests to GeoLibre](../upstream/geolibre-requests.md).

# Examples

```text
https://web.geolibre.app/?rndt=idrografia
https://web.geolibre.app/?rndt=catastale&rndtBbox=12.95,37.60,14.30,38.30
https://web.geolibre.app/?rndt=c_l219:a883ab12-e713-41fe-b2a2-34c7756dc4e2
```

Tried on web.geolibre.app on 2026-10-03: the first gave 1,131 records, the second 125 with the map on the box, the third opened the record "Catasto Urbano 1:1500 - Geo-servizio WMS".[^log]

[^url-params]: Parser of the parameters
[^entry]: Plugin entry, handleUrlParameters
[^log]: LOG, 2026-10-03
