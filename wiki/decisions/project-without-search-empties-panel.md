---
type: Decision
title: A project without a search empties the panel
description: Opening a project that carries no saved search clears the search on screen, so a search never passes from one project to another.
tags: [project, state]
status: stable
decided: 2026-10-03
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
  - id: entry
    resource: ../../src/geolibre.ts
    title: clearsStateOnProjectLoad, applyProjectState
---

# Decision

The search is data of the project, like its layers. When a project that carries no search is opened, the panel goes back to empty. The plugin asks GeoLibre for this with `clearsStateOnProjectLoad`.

# The alternative, and why not

Leaving the panel as it is keeps the search one was looking at. But then saving the newly opened project writes into it the search of the project before: seen in a test on 2026-10-03.[^log] Someone who receives a shared project must be able to count on finding the search of who saved it, and nothing else.

# Consequences

- Opening any project, or **Project > New**, clears the search on screen. To add to a project a layer found by a search, open the project first and search then.
- A form filled in but never searched is left alone.
- A new project turns the plugin off, as GeoLibre does with every plugin that is not on by default; turned on again, the panel is empty.
- A basemap style change and the globe/flat switch do not clear the search: tried on web.geolibre.app.

[^log]: LOG, 2026-10-03
