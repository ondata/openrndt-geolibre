---
type: Guide
title: Drive the panel with GeoLibre's AI Assistant
description: Ask GeoLibre's AI Assistant, in the chat or by voice, what you would do in the panel - search, open a record, add a layer as an image or as data, answer the panel's question - and watch the panel do it.
tags: [ai-assistant, search, add-layers, tools]
status: stable
sources:
  - id: issue
    resource: https://github.com/ondata/openrndt-geolibre/issues/58
    title: "#58, Expose RNDT search to GeoLibre's AI Assistant"
  - id: code
    resource: ../../src/rndt/assistant.ts
    title: tools, results and guidance
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: runSearch, openRecord, addFromRecord, choose
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-19
---

# What it is

From version 0.3.13 ([#58](https://github.com/ondata/openrndt-geolibre/issues/58)).

GeoLibre's AI Assistant can drive the RNDT panel. You say what you would do on screen, in your own words, and the assistant does it through the panel's own controls: it fills the search form and runs it, opens a record, ticks a layer and presses Add to map or Add features, answers the question the panel asks. You see each step happen in the panel: [a short video](https://youtu.be/ItC7oZDJCMA) shows it.

The AI's job is only to turn what you say into the form and the gestures of the panel. Everything else is the panel's: the same checks, the same messages, the same errors as by hand. A record opened by the assistant is read as when you click its title.

# How to use it

1. Turn the plugin on from the Plugins menu, **before** writing to the assistant: GeoLibre reads the tools of the plugins between one message and the next.
2. Open the AI Assistant and ask, for example:
   - "trovami gli alberi monumentali in Lombardia", then "mettine uno in mappa";
   - "mettimi in mappa il reticolo idrografico della Toscana";
   - "che dati geografici pubblica il Comune di Padova?";
   - "scarica come dati il Catasto 1810 di Genova", then, when the panel asks, "i primi 10.000".

The tools exist while the plugin is on: closing the panel turns the plugin off, and GeoLibre removes them.

# The tools

| Tool | The gesture it repeats | What it gives the assistant |
|---|---|---|
| `search` | fill the form and press Search | the page the panel shows: 20 records with id, title, organisation, record date, short abstract, extent, services; the total and the next page |
| `open_record` | click a record's title | what the detail view shows: per service its number, kind, layers (name, title, ticked, already on the map, or why it cannot be ticked), buttons and messages |
| `add_layers` | tick layers of one service and press Add to map (`as: "map"`) or Add features (`as: "features"`) | the panel's message, or the question it asks |
| `choose` | press one of the panel's choices (Download all, First 10,000 only, Cancel) | the panel's message that follows |

The search input uses the words of a link ([URL parameters](../reference/url-parameters.md)): `theme: "hy"`, `sort: "newest"`, `ipa`, `availableAs`, dates. `area` is `"view"` (the map view, the panel's default), `"anywhere"`, or a box `[west, south, east, north]`.

Every result also carries `next`, the calls that make sense now with their arguments, and `notes`, how to read it: as the help of a command line tool written for an LLM. For example, a search with no records lists the filters to widen, chosen from the ones in use.

# What reaches the model

Only metadata: records, layer names, counts and the panel's messages. The features of a WFS or ArcGIS layer and the map images are downloaded into the project by the plugin, as by hand; the model never sees them.

# The guidance

While the plugin is on, a text of under 4,000 characters is added to the assistant's instructions (`registerAssistantGuidance`). It condenses the [rndt-explorer skill](https://github.com/ondata/openrndt/tree/main/skills/rndt-explorer) of the openrndt command line tool, and rules found by trying prompts against Gemini 3.5 Flash, each with its measure on the catalogue (2026-10-19):

- a place goes in `area` as a box, not in the text: cadastral parcels of Bari, 13 records with the box, 7,693 without;
- the organisation's IPA code only when you name who publishes: monumental trees in Lombardy, 17 records with the box, 2 with `r_lombar`;
- start from text and area, filters in AND can empty the list: river network of Tuscany, 95 records with text and box, 0 adding theme, WMS and the region's code;
- when an INSPIRE theme covers the request, leave the text out: "particelle catastali" with theme `cp` gives 0 in Bari, records say "Cartografia catastale";
- "scarica", "come dati", "vettoriale" mean `as: "features"`, after moving the map to the record's area (features are read in the current view).

# Limits

- **A tool cannot be stopped.** GeoLibre lets a running plugin tool finish: it gives `registerAssistantToolSpec` callbacks no cancel signal. So no tool waits for the panel more than 10 seconds (20 for adding): past that it returns what the panel shows, and the panel goes on by itself. A server that does not answer takes about 20 seconds in the panel (8 over https, 8 over http).
- **One model turn per step**: search, open, add are each a round trip of the model, a few seconds each.
- **Only what the panel can do**: a gesture without a tool (chips, footprints, Share) is not available by voice.
- **The plugin must be on** before the conversation needs it: the assistant cannot turn a plugin on.
