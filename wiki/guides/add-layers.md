---
type: Guide
title: Add layers to the map
description: From the detail view of a record, add WMS, WMTS and ArcGIS layers as images and download WFS and ArcGIS features.
tags: [wms, wmts, wfs, arcgis, layers]
status: stable
sources:
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "What it does" and "Known limits"
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: The panel
  - id: constants
    resource: ../../src/rndt/constants.ts
    title: WFS_MAX_FEATURES
  - id: wmts
    resource: ../../src/rndt/wmts.ts
    title: WMTS capabilities and tile templates
---

# The layer lists

A record's WMS, WMTS, WFS and ArcGIS REST services are listed as soon as the record opens, one box per service. Each layer has a readable name on top and the code the service uses below (see [Readable layer names](../reference/layer-names.md)).

A list with more than 8 layers opens folded: only the ticked rows, and a **Show all N layers** button. With nothing ticked the button reads "Show all N layers to choose from". Once unfolded, a filter field narrows the rows.

# WMS

Tick one or more layers and press **Add to map**. The layers are added with their titles as names.

- A layer added from a dataset record is limited to the record's extent, when that is smaller than the service's (one municipality of a national service).
- A layer not offered in `EPSG:3857` is asked in a system it lists; this needs GeoLibre Desktop.
- A WMS layer, and an ArcGIS layer added as an image, keeps the record it comes from: GeoLibre's Metadata dialog shows `catalogue`, `recordId`, `recordTitle`, `organisation` and `recordUrl` (the record's page), saved with the project. Features downloaded as GeoJSON do not: GeoLibre 3.3.0 gives that call no metadata ([#36](https://github.com/ondata/openrndt-geolibre/issues/36), [#37](https://github.com/ondata/openrndt-geolibre/issues/37)).
- A layer the server marks `queryable="0"` (on the layer or on its parent) is added as not queryable: GeoLibre's Identify says it "does not provide feature information" and sends no request. Tried on `fabbricati` of the cadastral WMS in GeoLibre Desktop 3.3.0 ([#32](https://github.com/ondata/openrndt-geolibre/issues/32)).
- When the capabilities declare a request address on a private host, the address of the capabilities is used instead, and a note says so.

# WMTS

From 0.5.0 ([#66](https://github.com/ondata/openrndt-geolibre/issues/66)). Tick one or more layers and press **Add to map**: they are added as ready-made tiles, with their titles as names, through GeoLibre's `addWmtsLayer`.[^wmts]

- Only a layer offered in a Web Mercator tile grid can be added: 256-pixel tiles in `EPSG:3857` (or `900913`, `102100`) from the world's top-left corner, one level per zoom, as `GoogleMapsCompatible`. GeoLibre does not reproject tiles: a layer offered only in `EPSG:32632`, `EPSG:3003` or another national system shows why it cannot be added. Measured on 2026-11-01: of the 81 WMTS endpoints in RNDT, 23 (749 records) have such a grid, 36 only national or UTM ones.
- The service is asked by its REST tile address when the capabilities give one (ArcGIS), otherwise by KVP `GetTile` (GeoWebCache, MapProxy); the zoom range comes from the grid and from the layer's limits in it.
- One test tile from the browser tells whether the server lets GeoLibre show its tiles (CORS): without it, **Add to map** stays off and the box says why.
- On a map drawn in another system (GeoLibre 3.5.1, Settings > Map preferences) the box says that WMTS tiles show only on the Web Mercator map.
- A WMTS is often the best way to an orthophoto: the AgEA 2022, 2023 and 2024 orthophotos draw from their WMTS, while the `exportImage` of the same ArcGIS ImageServer answers with a black and white checkerboard (2026-11-01).

# WFS

Pick one feature type and press **Add features**: the features are downloaded as GeoJSON.

- "Only features in the current map view" limits the download to the view.
- Above 10,000 features the panel asks before downloading them all.[^constants]
- The features are drawn with the style the server gives for that layer (SLD), when it has one.
- Coordinates in a projected system are converted: see [Coordinate systems converted](../reference/coordinate-systems.md).
- A WFS with no GeoJSON output cannot be added by the plugin: the panel points to GeoLibre's own **Add Data > WFS Layer**, which can read GML services, though not all of them. See [Services that fail](../limits/services-that-fail.md).

# ArcGIS REST

A MapServer, ImageServer or FeatureServer lists its layers the same way. Ticked layers are added as images through the service's `export` request; one layer's features can be downloaded as GeoJSON, page by page.

# Already on the map

A layer that is in the project already has the tag **on the map** and is not added again. This holds after a project is saved and reopened, for WMS, WMTS and ArcGIS layers. Features downloaded from a WFS are not marked.

# When a service fails

The box of the service shows the reason. See [Services that fail](../limits/services-that-fail.md) and, for the web version, [CORS in the web version](../limits/cors-in-the-web-version.md).

[^constants]: WFS_MAX_FEATURES
[^wmts]: wmts
