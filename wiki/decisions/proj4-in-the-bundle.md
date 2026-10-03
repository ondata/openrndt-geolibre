---
type: Decision
title: proj4 in the bundle
description: The plugin carries its own copy of proj4 for the coordinate conversion, which more than doubles the bundle.
tags: [proj4, bundle, crs]
status: stable
decided: 2026-10-02
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02 and 2026-10-03
  - id: issue
    resource: https://github.com/opengeos/GeoLibre/issues/2820
    title: opengeos/GeoLibre#2820
---

# Decision

proj4 is bundled whole in the plugin. The bundle in the registry goes from 121 KB (0.1.4) to 299 KB (0.1.7), minified, and most of the growth is proj4.[^log]

# Why

- Without the conversion, GeoJSON in the Italian projected systems is added and not drawn: see [Coordinate systems converted](../reference/coordinate-systems.md).
- GeoLibre has proj4 among its own dependencies, but gives plugins no access to it: `addGeoJsonLayer` takes no coordinate system, and there is no call like `getDeckGL()` for proj4.
- An external plugin is a separate bundle: it cannot import the host's modules unless the host hands them over. The bundle is the same for Desktop and web.

# What would change it

A `getProj4()` in GeoLibre's plugin API, or an `addGeoJsonLayer` that takes the coordinate system of the data: asked in [opengeos/GeoLibre#2820](https://github.com/opengeos/GeoLibre/issues/2820). See [Requests to GeoLibre](../upstream/geolibre-requests.md).

`getProj4()` was added by [opengeos/GeoLibre#2824](https://github.com/opengeos/GeoLibre/pull/2824), merged on 2026-10-03. The decision holds while the plugin supports GeoLibre 3.2.0, which lacks it: the bundled copy stays until `minGeoLibreVersion` is raised to a release that has it ([#29](https://github.com/ondata/openrndt-geolibre/issues/29)).

Kept so by the maintainer of the plugin on 2026-10-02, confirmed on 2026-10-03.

[^log]: LOG, 2026-10-02 and 2026-10-03
