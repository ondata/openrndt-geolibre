---
type: Limit
title: A search is not a project change
description: GeoLibre does not mark the project as modified after a search, so closing without saving loses the search without a question.
tags: [project, save]
status: stable
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
---

# The limit

A search in the panel is not a change for GeoLibre. Seen in GeoLibre Desktop 3.2.0 on 2026-10-03:[^log]

- after a new search no "modified" mark appears beside the project's name;
- **Project > Save** stores the new search all the same, since GeoLibre reads the plugin's state when it saves;
- closing the window without saving asks nothing, and the search is lost; reopening the project gives the last saved one.

# What to do

Save after the search worth keeping.

# Why

As far as its code was read, GeoLibre asks a plugin for its state at certain moments (a save, a plugin turned on or off), not when the plugin changes. No call to mark the project as modified was found in the plugin types.

[^log]: LOG, 2026-10-03
