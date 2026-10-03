---
type: Status
title: Requests to GeoLibre
description: The issues opened on GeoLibre from the work on this plugin, what each asks and its state.
resource: https://github.com/opengeos/GeoLibre/issues
tags: [upstream, geolibre, issues]
status: stable
stale_after: 2026-11-03T00:00:00Z
sources:
  - id: i2819
    resource: https://github.com/opengeos/GeoLibre/issues/2819
    title: opengeos/GeoLibre#2819
    last_modified: 2026-10-03T00:00:00Z
  - id: i2820
    resource: https://github.com/opengeos/GeoLibre/issues/2820
    title: opengeos/GeoLibre#2820
    last_modified: 2026-10-03T00:00:00Z
  - id: i2821
    resource: https://github.com/opengeos/GeoLibre/issues/2821
    title: opengeos/GeoLibre#2821
    last_modified: 2026-10-03T00:00:00Z
  - id: i2822
    resource: https://github.com/opengeos/GeoLibre/issues/2822
    title: opengeos/GeoLibre#2822
    last_modified: 2026-10-03T00:00:00Z
---

# State on 2026-10-03

All four were opened on 2026-10-03 and are open, with no answer from the maintainers yet. This page ages: check the issues themselves after its `stale_after` date.

| Issue | Kind | Asks | Would change here |
|---|---|---|---|
| [#2819](https://github.com/opengeos/GeoLibre/issues/2819) | feature | `?plugin=<id>` for plugins of the registry, behind the trust prompt, which could then show the plugin's name and author | a link would need no project file: see [Share a search](../guides/share-a-search.md) |
| [#2820](https://github.com/opengeos/GeoLibre/issues/2820) | feature | the host's proj4 for plugins, as `getDeckGL()` gives deck.gl | [proj4 in the bundle](../decisions/proj4-in-the-bundle.md) |
| [#2821](https://github.com/opengeos/GeoLibre/issues/2821) | feature | a way for an external plugin's project state to survive "Strip credentials" | [Strip credentials](../limits/strip-credentials.md) |
| [#2822](https://github.com/opengeos/GeoLibre/issues/2822) | bug | Open Recent refuses a project whose name does not end in `.geolibre.json`, with a misleading message | [Project file names](../limits/project-file-names.md) |

# Why they exist

Each came from a limit met while building a feature of the plugin, and each is written so that it can be reproduced without the plugin.

# Not asked yet

- A way for a plugin to tell GeoLibre that the project changed: see [A search is not a project change](../limits/unsaved-search.md).
- A way for a registry plugin to sit in the **Plugins > Web Services** submenu, where GeoLibre groups its built-in catalogue browsers. The submenu is a fixed list of built-in plugin ids in GeoLibre's code (read on 2026-10-03).
