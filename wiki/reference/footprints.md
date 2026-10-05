---
type: Reference
title: Footprints
description: The extents of the search results drawn on the map, how they behave and what they are not.
tags: [footprints, map, maplibre]
status: stable
sources:
  - id: footprints
    resource: ../../src/rndt/footprints-layer.ts
    title: Footprints overlay on the MapLibre map
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "Known limits"
---

# What they are

After a search, the extent each record declares is drawn on the map as an orange rectangle. They are a temporary overlay drawn straight on the MapLibre map, replaced at every search: they are not a layer of the project and are not saved with it.[^footprints] They need the MapLibre renderer.

# Behaviour

- Hovering a card highlights its footprint, and hovering a footprint marks its card.
- A click on a footprint opens the record; where several overlap, a menu lets you choose.
- **Hide footprints** / **Show footprints** above the list hides them all; the ⋯ menu of a card hides one. Showing them all brings back those hidden one by one.
- They stay on top of the layers added later, and come back after a basemap change.
- Hidden footprints stay hidden when a layer of the project is hidden and shown again (from 0.1.7).
- **Zoom to results** fits the map to the footprints of the page.
- The tooltip stays inside the map near its right and bottom edges.
- While GeoLibre's **Identify** is on, footprints answer neither click nor hover, and Identify's crosshair stays: the click queries the layer, nothing else opens ([#38](https://github.com/ondata/openrndt-geolibre/issues/38), from 0.3.2). The plugin knows Identify is on from the crosshair GeoLibre puts on the map; a plugin API for it is asked in [opengeos/GeoLibre#2949](https://github.com/opengeos/GeoLibre/issues/2949).

# Limits

Footprints and "Zoom to extent" use the extent the record declares, as it is. When the metadata is wrong the footprint is in the wrong place (all 100 records of Comune di Capannori are drawn in Ethiopia), and a search by area does not find the record. The plugin does not try to correct it: see [issue #13](https://github.com/ondata/openrndt-geolibre/issues/13).[^readme]

[^footprints]: Footprints overlay on the MapLibre map
[^readme]: README before 2026-10-05, "Known limits"
