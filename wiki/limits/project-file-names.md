---
type: Limit
title: Project file names
description: GeoLibre Desktop reopens from Open Recent only projects whose name ends with .geolibre or .geolibre.json.
tags: [project, desktop, file-name]
status: stable
sources:
  - id: geolibre-lib
    resource: https://github.com/opengeos/GeoLibre/blob/main/apps/geolibre-desktop/src-tauri/src/lib.rs
    title: GeoLibre Desktop, is_allowed_project_path
  - id: issue
    resource: https://github.com/opengeos/GeoLibre/issues/2822
    title: opengeos/GeoLibre#2822
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
---

# The limit

This is a limit of GeoLibre Desktop, not of the plugin, met while saving projects with a search.

A project saved as `rndt-saved-search.geolibre_bis.json` went into the recent projects, and **Open Recent** then refused it: "Something went wrong - Could not open the recent project", with this line in Diagnostics:[^log]

```text
Refusing to read "…\rndt-saved-search.geolibre_bis.json": not an absolute local project file path
```

The path was absolute and local. GeoLibre Desktop reads from Open Recent only a path that ends with `.geolibre` or `.geolibre.json`.[^geolibre-lib]

# What to do

Give the project a name that ends with `.geolibre.json`: `my-search-bis.geolibre.json`, not `my-search.geolibre_bis.json`.

# Also

A project above 10 MB is not saved automatically by GeoLibre ("Project autosave skipped"). A project reaches that size with the features of a large WFS download inside: 10,000 features made one of 16 MB.[^log]

# Upstream

Reported in [opengeos/GeoLibre#2822](https://github.com/opengeos/GeoLibre/issues/2822), closed by [opengeos/GeoLibre#2828](https://github.com/opengeos/GeoLibre/pull/2828) (merged on 2026-10-03, not in a release on 2026-10-04): Save As adds `.geolibre.json` to a name that lacks it, and the refusal names the extensions it reads.

[^log]: LOG, 2026-10-03
[^geolibre-lib]: GeoLibre Desktop, is_allowed_project_path
