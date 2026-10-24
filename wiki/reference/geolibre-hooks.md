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
    resource: https://github.com/opengeos/GeoLibre/blob/v3.4.0/packages/plugins/src/types.ts
    title: GeoLibre 3.4.0, plugin types
---

# Minimum version

GeoLibre 3.4.0, to be declared as `minGeoLibreVersion` in the registry entry with the next registry update; the entry still says 3.3.0 ([#57](https://github.com/ondata/openrndt-geolibre/issues/57)). Every hook below is in GeoLibre's plugin types at tag `v3.4.0` (checked on 2026-10-12).[^geolibre-types] 3.4.0 also stops a camera move no longer when the map reports its view (opengeos/GeoLibre#3084), so a fit asked while the map moves lands at once ([#53](https://github.com/ondata/openrndt-geolibre/issues/53)).

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
| `getActiveMapTool`, `onActiveMapToolChange` | footprints answer no click or hover while Identify, feature selection or GeoEditor owns the map, and close their menu when one turns on (GeoLibre 3.4.0, [#43](https://github.com/ondata/openrndt-geolibre/issues/43)) | no: without them the footprints always answer |
| `getDrawnFeatures`, `activatePlugin` | search in shapes drawn with GeoEditor | no |
| `fetchArrayBuffer`, `fetchVectorUrl` | read the catalogue and the services through the native client in Desktop | no: in the web version the browser reads them |
| `addWmsLayer`, `addTileLayer`, `addGeoJsonLayer` | add layers | per kind of service |
| `metadata` on `addWmsLayer` and `addTileLayer` | the record a layer comes from (GeoLibre 3.3.0, [#36](https://github.com/ondata/openrndt-geolibre/issues/36)) | no |
| `addWmsLayer({ queryable: false })` | no GetFeatureInfo on a layer the server marks not queryable (GeoLibre 3.3.0, [#32](https://github.com/ondata/openrndt-geolibre/issues/32)) | no |
| `importLayerStyle` | draw WFS features with the server's SLD (GeoLibre 3.2.0); its presence also tells that `addWmsLayer` takes a `crs` | no |
| `getLayers` | know whether an added layer is still in the project (GeoLibre 3.1.0) | no |
| `getProjectSnapshot` | know the layers already in a reopened project | no |
| `getProj4` | convert GeoJSON in a projected system (GeoLibre 3.3.0, [#29](https://github.com/ondata/openrndt-geolibre/issues/29)) | no: without it such a file gives an error |
| `exportTextFile` | export the error log (GeoLibre 3.1.0) | no |
| `openExternalUrl` | open links in the system browser | no |
| `registerAssistantToolSpec`, `registerAssistantGuidance` | the tools and the guidance of the [AI Assistant](../guides/ai-assistant.md) (GeoLibre 3.0 and 3.1, [#58](https://github.com/ondata/openrndt-geolibre/issues/58), from 0.3.13) | no: without them the assistant does not know the panel |
| `{ signal }`, second argument of a tool callback | Stop ends a tool's wait at once (after GeoLibre 3.4.0, opengeos/GeoLibre#3161; [#59](https://github.com/ondata/openrndt-geolibre/issues/59), from 0.3.14) | no: without it a tool waits at most 10 s (20 to add) |
| `assistant.description` in `plugin.json` | read by the assistant's `activate_plugin` to offer the plugin while it is off (after GeoLibre 3.4.0, opengeos/GeoLibre#3160; #59, from 0.3.14) | no: GeoLibre 3.4.0 ignores it |
| `getLocale`, `onLocaleChange`, `translate`, `registerTranslations`; titles and menu labels as getters | the panel in Italian when GeoLibre is (GeoLibre 3.4.0, [#3](https://github.com/ondata/openrndt-geolibre/issues/3), next release): see [Language](language.md) | no: without them the panel is in English |

Every method except `registerRightPanel` is called only if present.[^host]

# In GeoLibre 3.3.0 and 3.4.0, not used yet

Asked upstream from this plugin and released in 3.3.0 or 3.4.0 (see [Requests to GeoLibre](../upstream/geolibre-requests.md)), or added by the maintainers:

| Method | What it gives | Here |
|---|---|---|
| `addWfsLayer` | GeoLibre's own WFS layer, GML included; `maxFeatures` since 3.4.0 | [#28](https://github.com/ondata/openrndt-geolibre/issues/28): it always sends `srsName=EPSG:4326`, which the cadastral WFS refuses (2026-10-12) |
| `registerMenuContribution` | items in Add Data, Processing or Controls | not planned yet |
| `nativeFetch` | Desktop only: any method, no CORS, a cookie jar | no use found |

`?plugin=` for registry plugins and `publishableSettings` in the registry entry need nothing in the plugin's code.

# What GeoLibre 3.4.0 does not give a plugin

- `metadata` on `addGeoJsonLayer`, and `descriptiveMetadata` (title, abstract, keywords, contact, links: the form of the Metadata dialog, exported as STAC) on the add calls, which only the user or Python can set: to ask, [#37](https://github.com/ondata/openrndt-geolibre/issues/37).
- A WFS request without `srsName`, or with the system the server wants, on `addWfsLayer` ([#28](https://github.com/ondata/openrndt-geolibre/issues/28)).
- A cancel signal to the callback of `registerAssistantToolSpec`, and a way for the assistant to turn a plugin on: both merged on GeoLibre `main` on 2026-10-20 (opengeos/GeoLibre#3161, #3160), not in a release yet; the plugin uses them from 0.3.14.
- A call to mark the project as modified: none in the plugin types at `v3.4.0` (see [A search is not a project change](../limits/unsaved-search.md)).

[^geolibre-types]: GeoLibre 3.4.0, plugin types
[^host]: Host methods beyond the template's API
