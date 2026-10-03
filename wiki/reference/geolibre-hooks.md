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
    resource: https://github.com/opengeos/GeoLibre/blob/v3.2.0/packages/plugins/src/types.ts
    title: GeoLibre 3.2.0, plugin types
---

# Minimum version

GeoLibre 3.2.0, declared as `minGeoLibreVersion` in the registry entry. Every hook below is in GeoLibre's plugin types at tag `v3.2.0` (checked on 2026-10-03).[^geolibre-types]

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
| `importLayerStyle` | draw WFS features with the server's SLD (GeoLibre 3.2.0); its presence also tells that `addWmsLayer` takes a `crs` | no |
| `getLayers` | know whether an added layer is still in the project (GeoLibre 3.1.0) | no |
| `getProjectSnapshot` | know the layers already in a reopened project | no |
| `exportTextFile` | export the error log (GeoLibre 3.1.0) | no |
| `openExternalUrl` | open links in the system browser | no |

Every method except `registerRightPanel` is called only if present.[^host]

# What GeoLibre does not give a plugin

- A way to be activated by `?plugin=`: built-in plugins only.
- Its own proj4.
- A way to keep its project state through "Strip credentials".
- A call to mark the project as modified: none was found in the plugin types (see [A search is not a project change](../limits/unsaved-search.md)).

The first three are asked upstream: see [Requests to GeoLibre](../upstream/geolibre-requests.md).

[^geolibre-types]: GeoLibre 3.2.0, plugin types
[^host]: Host methods beyond the template's API
