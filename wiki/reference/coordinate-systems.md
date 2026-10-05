---
type: Reference
title: Coordinate systems converted
description: The EPSG codes of GeoJSON data that the plugin converts to WGS84 before adding the features, and what happens with the others.
tags: [crs, epsg, proj4, geojson, wfs]
status: stable
sources:
  - id: crs
    resource: ../../src/rndt/crs.ts
    title: Definitions and conversion
  - id: tests
    resource: ../../tests/crs.test.ts
    title: Tests of the conversion
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02
---

# Why

GeoJSON is longitude and latitude in WGS84, but Italian publishers still serve files with a `crs` member and projected coordinates. GeoLibre reads them as degrees and draws nothing: a file of Comune di Firenze declaring `urn:ogc:def:crs:EPSG::3003` added 105 features and nothing showed on the map.[^log] From version 0.1.6 the plugin converts the coordinates first, with proj4. It applies to downloaded files and to WFS features.

# Schema

| EPSG | System | Handling |
|---|---|---|
| 3003, 3004 | Monte Mario / Italy zone 1 and 2 (Gauss-Boaga) | converted |
| 4265 | Monte Mario, geographic | converted |
| 4230 | ED50, geographic | converted |
| 23032, 23033 | ED50 / UTM 32N, 33N | converted |
| 25832, 25833, 3044, 3045 | ETRS89 / UTM 32N, 33N | converted |
| 6707, 6708, 7791, 7792 | RDN2008 / UTM 32N, 33N | converted |
| 32632, 32633 | WGS84 / UTM 32N, 33N | converted |
| 3857, 900913 | Web Mercator | converted |
| 4326, 4258, 6706, 4979, 4937, CRS84 | geographic, WGS84 and ETRS89 | taken as they are, the `crs` member removed |

# Rules

- The code is read from the `crs` member of the collection.
- Another code gives the error "the coordinates are in EPSG:<code>, a system the plugin cannot convert", instead of an empty layer.
- Coordinates out of the range of degrees with no `crs` member give an error too.
- After a conversion the panel says "Added N features, converted from EPSG:<code>".

# Precision

The conversions from Monte Mario and ED50 use 7-parameter shifts, which are off by about a metre, sometimes a few: the deformation of the Italian datum is not uniform. The grids of IGM are precise to the centimetre and are noted as a future idea, not done.[^log]

# Weight

The conversion uses GeoLibre's own proj4, not a copy in the plugin: see [proj4 from GeoLibre](../decisions/proj4-in-the-bundle.md).

[^log]: LOG, 2026-10-02
