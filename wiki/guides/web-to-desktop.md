---
type: Guide
title: From the web version to Desktop
description: Pick a record in GeoLibre web, save the project, open it in GeoLibre Desktop where every service can be read.
tags: [web, desktop, cors, project]
status: stable
sources:
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "The search travels with the project"
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
---

# Why

In GeoLibre web the browser reads the services itself, and a server that sends no CORS headers cannot be read there (see [CORS in the web version](../limits/cors-in-the-web-version.md)). GeoLibre Desktop reads the same services through its native client. A project saved in the web version carries the search and the open record, so the work started in the browser continues in Desktop.

# Steps

1. In GeoLibre web, search and open the record. Its service box may say that the server sends no CORS headers.
2. **Project > Save As**, with a name ending in `.geolibre.json`, and **Keep in file** at "Strip credentials?".
3. In GeoLibre Desktop, **Project > Open From > File** and pick the file.
4. The panel opens on the same search and the same record; the service is read.

# What was tried

A project saved in web.geolibre.app after a search of `catastale` in a box on Palermo, with a record of Agenzia delle Entrate open, was reopened in GeoLibre Desktop 3.2.0 on Windows: same search, same record, and the WFS that the browser could not read answered there.[^log]

The plugin has to be present in Desktop. If the project carries the plugin's address (see [Share a search](share-a-search.md)) and the plugin is already in the local plugins folder, what GeoLibre does was not tried.

[^log]: LOG, 2026-10-03
