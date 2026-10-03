---
type: Limit
title: Strip credentials
description: When a project is saved GeoLibre counts the plugin's saved search as possible credentials; stripping them, or sharing the project, leaves the search out.
tags: [project, save, share, credentials]
status: stable
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
  - id: geolibre-credentials
    resource: https://github.com/opengeos/GeoLibre/blob/main/packages/core/src/credentials.ts
    title: GeoLibre, redaction of project credentials
  - id: issue
    resource: https://github.com/opengeos/GeoLibre/issues/2821
    title: opengeos/GeoLibre#2821
---

# The limit

At every save of a project that holds a search, in the web version and in Desktop, GeoLibre asks "Strip credentials?" and counts each value of the plugin's state as a credential-bearing field: 20 for one search.[^log] GeoLibre cannot know what an external plugin keeps in a project, so it treats all of it as a possible secret.[^geolibre-credentials]

| Choice | Result |
|---|---|
| **Keep in file** | the search is saved |
| **Strip credentials** (the highlighted button) | the search is left out; the plugin's address and its being on stay |

"Strip credentials" was tried on web.geolibre.app on 2026-10-03: the saved file had no state of the plugin, and reopened with the plugin on and an empty panel, without errors.

Read in GeoLibre's code, not tried: the same redaction applies to every way a project leaves the app, so a project shared with **Share** would not carry the search.

# What to do

Choose **Keep in file**. The state holds no key and no password: only the search (see [Project state](../reference/project-state.md)).

# Upstream

Asked in [opengeos/GeoLibre#2821](https://github.com/opengeos/GeoLibre/issues/2821): a way for a plugin outside the core to have its state kept. See [Requests to GeoLibre](../upstream/geolibre-requests.md).

[^log]: LOG, 2026-10-03
[^geolibre-credentials]: GeoLibre, redaction of project credentials
