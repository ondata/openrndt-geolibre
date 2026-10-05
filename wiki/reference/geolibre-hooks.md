---
type: Reference
title: GeoLibre hooks used
description: The parts of GeoLibre's plugin API the plugin relies on, and the minimum GeoLibre version.
tags: [geolibre, plugin-api, compatibility]
status: stable
sources:
  - id: entry
    resource: ../../src/geolibre.ts
    title: Plugin entry
  - id: host
    resource: ../../src/rndt/host.ts
    title: Host methods beyond the template's API
  - id: host-api
    resource: ../../src/lib/geolibre/host-api.ts
    title: Plugin API types from the template
  - id: geolibre-types
    resource: https://github.com/opengeos/GeoLibre/blob/v3.3.0/packages/plugins/src/types.ts
    title: GeoLibre 3.3.0, plugin types
---

# Minimum version

GeoLibre 3.3.0, to be declared as `minGeoLibreVersion` in the registry entry with the next registry update; the entry still says 3.2.0 ([#35](https://github.com/ondata/openrndt-geolibre/issues/35)). Every hook below is in GeoLibre's plugin types at tag `v3.3.0` (checked on 2026-10-05).[^geolibre-types]

# Declared by the plugin

| Member | Use |
|---|---|
| `id`, `name`, `version` | must match `geolibre-plugin/plugin.json` |
| `engines: ["maplibre"]` | the footprints draw on the MapLibre map |
| `activate`, `deactivate` | create and remove the panel |
| `urlParameterNames`, `handleUrlParameters` | [URL parameters](url-parameters.md) |
| `getProjectState`, `applyProjectState` | [Project state](project-state.md) |
| `restoresPanelCollapseState` | the panel stays open when a project loads |
| `clearsStateOnProjectLoad` | a project without a search empties the panel |

# Asked of the host

| Method | Use | Needed |
|---|---|---|
| `registerRightPanel` | the RNDT panel | yes: without it the plugin does not activate |
| `openRightPanel`, `closeRightPanel` | show and close the panel | no |
| `registerToolbarMenu` | the RNDT menu in the toolbar | no |
| `getViewBounds`, `fitBounds` | search in the map view, move the map | no |
| `getMap` | footprints | no |
| `getDrawnFeatures`, `activatePlugin` | search in shapes drawn with GeoEditor | no |
| `fetchArrayBuffer`, `fetchVectorUrl` | read the catalogue and the services through the native client in Desktop | no: in the web version the browser reads them |
| `addWmsLayer`, `addTileLayer`, `addGeoJsonLayer` | add layers | per kind of service |
| `addWmsLayer({ queryable: false })` | no GetFeatureInfo on a layer the server marks not queryable (GeoLibre 3.3.0, [#32](https://github.com/ondata/openrndt-geolibre/issues/32)) | no |
| `importLayerStyle` | draw WFS features with the server's SLD (GeoLibre 3.2.0); its presence also tells that `addWmsLayer` takes a `crs` | no |
| `getLayers` | know whether an added layer is still in the project (GeoLibre 3.1.0) | no |
| `getProjectSnapshot` | know the layers already in a reopened project | no |
| `getProj4` | convert GeoJSON in a projected system (GeoLibre 3.3.0, [#29](https://github.com/ondata/openrndt-geolibre/issues/29)) | no: without it such a file gives an error |
| `exportTextFile` | export the error log (GeoLibre 3.1.0) | no |
| `openExternalUrl` | open links in the system browser | no |

Every method except `registerRightPanel` is called only if present.[^host]

# In GeoLibre 3.3.0, not used yet

Asked upstream from this plugin and released in 3.3.0 (see [Requests to GeoLibre](../upstream/geolibre-requests.md)), or added by the maintainers:

| Method | What it gives | Here |
|---|---|---|
| `addWfsLayer` | GeoLibre's own WFS layer, GML included | [#28](https://github.com/ondata/openrndt-geolibre/issues/28) |
| `metadata` on `addWmsLayer`, `addWfsLayer`, `addTileLayer` | the layer keeps where it comes from | not planned yet |
| `registerTranslations` | the plugin's own strings per language | [#3](https://github.com/ondata/openrndt-geolibre/issues/3) |
| `registerMenuContribution` | items in Add Data, Processing or Controls | not planned yet |
| `nativeFetch` | Desktop only: any method, no CORS, a cookie jar | no use found |

`?plugin=` for registry plugins and `publishableSettings` in the registry entry need nothing in the plugin's code.

# What GeoLibre 3.3.0 does not give a plugin

- A call to mark the project as modified: none in the plugin types at `v3.3.0` (see [A search is not a project change](../limits/unsaved-search.md)).

[^geolibre-types]: GeoLibre 3.3.0, plugin types
[^host]: Host methods beyond the template's API
