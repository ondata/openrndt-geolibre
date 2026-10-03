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
  - id: pr2836
    resource: https://github.com/opengeos/GeoLibre/pull/2836
    title: opengeos/GeoLibre#2836
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

Closed by [opengeos/GeoLibre#2836](https://github.com/opengeos/GeoLibre/pull/2836), merged on 2026-10-03 and not in a release on 2026-10-04: a registry entry can declare `publishableSettings`, `true` or a list of state keys. GeoLibre reads it from the registry only, keeps that state in stripped, shared and exported projects and no longer counts it in the prompt; a credential-named field in it is still dropped.[^pr2836] None of the plugin's state keys is such a name. Our registry entry does not declare it yet: [#27](https://github.com/ondata/openrndt-geolibre/issues/27). The development copy is not in the registry, so its state stays stripped.

[^log]: LOG, 2026-10-03
[^geolibre-credentials]: GeoLibre, redaction of project credentials
[^pr2836]: opengeos/GeoLibre#2836
