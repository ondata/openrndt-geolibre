---
type: Overview
title: openrndt-geolibre
description: A GeoLibre plugin to search the Italian national catalogue of spatial data (RNDT) and add its services to the map.
resource: https://github.com/ondata/openrndt-geolibre
tags: [plugin, geolibre, rndt]
status: stable
sources:
  - id: readme
    resource: ../README.md
    title: README of the repository
  - id: constants
    resource: ../src/rndt/constants.ts
    title: Plugin id, name, catalogue address, page size
---

# What it is

openrndt-geolibre is a plugin for [GeoLibre](https://github.com/opengeos/GeoLibre), in its Desktop and web versions. It adds a right panel, **RNDT**, that searches the [Repertorio Nazionale dei Dati Territoriali](https://geodati.gov.it/geoportale/), the Italian national catalogue of spatial data, and adds the services of a record to the map: WMS, WFS and ArcGIS REST.[^readme]

It is the GeoLibre counterpart of the [openrndt](https://github.com/ondata/openrndt) command line tool and asks the same REST API, `https://geodati.gov.it/RNDT/rest/metadata/search`.[^constants]

# Facts

| | |
|---|---|
| Plugin id | `openrndt-geolibre` |
| Name in GeoLibre | RNDT catalogue |
| Minimum GeoLibre | 3.3.0 |
| Renderer | MapLibre only |
| Status | beta, open for testing |
| License | MIT |
| Results per page | 20 |

# What it does

- **Search** the catalogue by text, type, area, kind of service and more: see [Search](guides/search.md) and, for the query it sends, [Search form and query](reference/search-query.md).
- **Show the footprints** of the results on the map: see [Footprints](reference/footprints.md).
- **Add layers** from a record: see [Add layers to the map](guides/add-layers.md).
- **Open a search from a link** and **save a search in a project**: see [Share a search](guides/share-a-search.md).

# Where to go next

- To use it: the [guides](guides/index.md).
- To know what it cannot do: the [limits](limits/index.md).
- To work on it: [development](development/index.md) and the [decisions](decisions/index.md) taken so far.

[^readme]: README of the repository
[^constants]: Plugin id, name, catalogue address, page size
