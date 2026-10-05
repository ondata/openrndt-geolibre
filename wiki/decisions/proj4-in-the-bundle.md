---
type: Decision
title: proj4 from GeoLibre
description: The plugin converts coordinates with GeoLibre's own proj4 (app.getProj4, GeoLibre 3.3.0) and carries no copy; until 0.2.0 it bundled one.
tags: [proj4, bundle, crs]
status: stable
decided: 2026-10-05
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02, 2026-10-03 and 2026-10-05
  - id: crs
    resource: ../../src/rndt/crs.ts
    title: The conversion
  - id: issue
    resource: https://github.com/opengeos/GeoLibre/issues/2820
    title: opengeos/GeoLibre#2820
  - id: pr2824
    resource: https://github.com/opengeos/GeoLibre/pull/2824
    title: opengeos/GeoLibre#2824
---

# Decision

The plugin asks GeoLibre for its proj4 (`app.getProj4()`, from GeoLibre 3.3.0) when a GeoJSON file needs converting, and carries no copy of its own ([#29](https://github.com/ondata/openrndt-geolibre/issues/29)). The bundle goes from 478 KB to 227 KB minified, 129 KB to 67 KB gzipped (measured on 2026-10-05).[^log]

# How

- proj4 is asked only for a file in a projected system: a file in WGS84, ETRS89 or CRS84 is added without loading it.[^crs]
- The definitions of the Italian systems stay in the plugin and are passed to proj4 as strings, never registered: GeoLibre shares one proj4 registry with every plugin, and its API asks plugins not to register or redefine EPSG names.
- A host that gives plugins no proj4 (the call is optional in GeoLibre's types) gets an error naming the system, not an empty layer.

# Why

- The minimum GeoLibre is 3.3.0 ([#35](https://github.com/ondata/openrndt-geolibre/issues/35)), which has `getProj4`, so no second path is needed for older hosts.
- proj4 was most of the bundle's weight.

# Before

From 0.1.6 (2026-10-02) to 0.2.0 proj4 was bundled whole: GeoLibre gave plugins no access to its own, and the bundle in the registry went from 121 KB (0.1.4) to 299 KB (0.1.7). The call was asked in [opengeos/GeoLibre#2820](https://github.com/opengeos/GeoLibre/issues/2820) and added by [opengeos/GeoLibre#2824](https://github.com/opengeos/GeoLibre/pull/2824), released in 3.3.0.

[^log]: LOG, 2026-10-02, 2026-10-03 and 2026-10-05
[^crs]: The conversion
