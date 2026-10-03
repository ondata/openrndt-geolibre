---
type: Reference
title: Readable layer names
description: Where the readable name of a WMS or WFS layer comes from - the capabilities title, or the RNDT records that link to the same service.
tags: [wms, wfs, layers, names]
status: stable
sources:
  - id: layer-names
    resource: ../../src/rndt/layer-names.ts
    title: Readable names from capabilities and RNDT
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: Layer list of the detail view
---

# The problem

Many services give their layers only a code. In a survey of 64 services (2026-09-27), 88% of WMS layer titles were readable, but only 50% of WFS ones: 34% were words joined by `_` or CamelCase (`Parchi_naturali`), 16% opaque codes (`TDLD8`).[^layer-names]

# What the panel shows

Each row has the readable name on top and the layer code, as the service gives it, below. The code always stays visible.

# Where the readable name comes from

1. The title in the capabilities, when it reads as a name: it has a space, or it is one real word of at least three letters. A title equal to the code, or with digits, `_`, `.` or `:`, is a code.
2. Otherwise, RNDT: the records that link to the same service with the layer name in the link (`typeName`, `LAYERS`). Friuli Venezia Giulia and Veneto publish one record per layer.
3. A title with a lost letter (the character U+FFFD, as in some titles of Veneto's GeoServer) is shown, and RNDT is still asked for a whole one.

# How RNDT is asked

| RNDT records of the service | Lookup |
|---|---|
| none | nothing to do |
| up to 1,000 | all in one request, in the background |
| more than 1,000 | only for the layers the user ticks, one request each |

The lookup has a budget of 30 seconds and never blocks the list. Above 1,000 records the note under the list says "Readable names are looked up in RNDT for the selected layer only".

# Layers with the same name

Two layers of a record with the same readable name (a plan in force and one adopted) keep the code in the name when they are added, so GeoLibre's layer list does not show them alike.[^panel]

[^layer-names]: Readable names from capabilities and RNDT
[^panel]: Layer list of the detail view
