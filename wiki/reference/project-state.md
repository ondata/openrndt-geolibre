---
type: Reference
title: Project state
description: What the plugin writes in a GeoLibre project, under plugins.settings, and how it reads it back.
tags: [project, state, share]
status: stable
sources:
  - id: project-state
    resource: ../../src/rndt/project-state.ts
    title: State type and validation
  - id: entry
    resource: ../../src/geolibre.ts
    title: Plugin entry, getProjectState and applyProjectState
  - id: tests
    resource: ../../tests/project-state.test.ts
    title: Tests of the validation
---

# Where

In the project file, under `plugins.settings["openrndt-geolibre"]`. The same block of the project holds the active plugins (`plugins.activePluginIds`) and the addresses of external plugins (`plugins.manifestUrls`). From version 0.1.7.

# Schema

| Key | Type | Meaning |
|---|---|---|
| `v` | `1` | version of the state; another value is ignored |
| `form` | object | the search, with the keys below |
| `start` | integer, from 1 | first result of the page |
| `recordId` | string or null | the record open in the detail view |

Keys of `form`:

| Key | Type | Default |
|---|---|---|
| `kind` | `all`, `data`, `services` | `all` |
| `serviceTypes` | list of strings | empty |
| `availableAs` | list of `WMS`, `WFS`, `ArcGIS REST` | empty |
| `text` | string | empty |
| `textMode` | `all`, `any`, `lucene` | `all` |
| `field` | string | empty (anywhere) |
| `keywords` | string, comma-separated | empty |
| `organisation` | string, comma-separated | empty |
| `invertOrganisation` | boolean | `false` |
| `inspireThemes` | list of strings | empty |
| `openDataOnly` | boolean | `false` |
| `dateField` | string | `apiso_RevisionDate_dt` |
| `dateFrom`, `dateTo` | `yyyy-mm-dd` or empty | empty |
| `bbox` | `[west, south, east, north]` or null | null (anywhere) |
| `spatialRel` | `Intersects`, `Within` | `Intersects` |
| `sort` | string | empty (relevance) |

# Rules

- The area is saved as the box the search used. A search on "Current map view" or on drawn shapes comes back as a **Box**, so the same records are found in a window of another size.
- A record opened by typing its id is saved as that id in `text`.
- The results are not saved: the search runs again.
- A value of the wrong type falls back to its default; a box that is not valid becomes null; a state of another version or shape is ignored.[^project-state]
- Nothing is saved before the first search, or with the plugin off.
- The settings of the panel are not in the project: see [Settings and error log](settings-and-error-log.md).

# How GeoLibre uses it

- At save GeoLibre calls `getProjectState()` of every registered plugin.
- At load it calls `applyProjectState()` **before** `activate()`: the plugin keeps the state and applies it when the panel is mounted.[^entry]
- The plugin sets `restoresPanelCollapseState`, so GeoLibre does not fold its panel during the load, and `clearsStateOnProjectLoad`, so a project without a search empties the panel (see [the decision](../decisions/project-without-search-empties-panel.md)).
- A state equal to what the panel shows does nothing.

# Examples

```json
{
  "v": 1,
  "form": {
    "kind": "all",
    "text": "catastale",
    "textMode": "all",
    "bbox": [12.95, 37.6, 14.3, 38.3],
    "spatialRel": "Intersects",
    "sort": ""
  },
  "start": 1,
  "recordId": "age:fornitura_dati_catasto_wfs"
}
```

The plugin writes every key of `form`; the example leaves out those at their default, which is valid on reading.

See also [Strip credentials](../limits/strip-credentials.md): GeoLibre can leave this state out of a saved file.

[^project-state]: State type and validation
[^entry]: Plugin entry, getProjectState and applyProjectState
