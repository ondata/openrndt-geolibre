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
    last_modified: 2026-10-04T00:00:00Z
  - id: i2820
    resource: https://github.com/opengeos/GeoLibre/issues/2820
    title: opengeos/GeoLibre#2820
    last_modified: 2026-10-04T00:00:00Z
  - id: i2821
    resource: https://github.com/opengeos/GeoLibre/issues/2821
    title: opengeos/GeoLibre#2821
    last_modified: 2026-10-04T00:00:00Z
  - id: i2822
    resource: https://github.com/opengeos/GeoLibre/issues/2822
    title: opengeos/GeoLibre#2822
    last_modified: 2026-10-04T00:00:00Z
  - id: i2823
    resource: https://github.com/opengeos/GeoLibre/issues/2823
    title: opengeos/GeoLibre#2823
    last_modified: 2026-10-04T00:00:00Z
  - id: i2833
    resource: https://github.com/opengeos/GeoLibre/issues/2833
    title: opengeos/GeoLibre#2833
    last_modified: 2026-10-04T00:00:00Z
  - id: i2840
    resource: https://github.com/opengeos/GeoLibre/issues/2840
    title: opengeos/GeoLibre#2840
    last_modified: 2026-10-04T00:00:00Z
  - id: i2886
    resource: https://github.com/opengeos/GeoLibre/issues/2886
    title: opengeos/GeoLibre#2886
    last_modified: 2026-10-04T00:00:00Z
  - id: i2887
    resource: https://github.com/opengeos/GeoLibre/issues/2887
    title: opengeos/GeoLibre#2887
    last_modified: 2026-10-04T00:00:00Z
  - id: i2888
    resource: https://github.com/opengeos/GeoLibre/issues/2888
    title: opengeos/GeoLibre#2888
    last_modified: 2026-10-04T00:00:00Z
  - id: i2898
    resource: https://github.com/opengeos/GeoLibre/issues/2898
    title: opengeos/GeoLibre#2898
    last_modified: 2026-10-04T00:00:00Z
  - id: releases
    resource: https://github.com/opengeos/GeoLibre/releases
    title: GeoLibre releases
    last_modified: 2026-10-04T00:00:00Z
---

# State on 2026-10-04

All seven were opened on 2026-10-03 and closed the same day by a merged pull request. None is in a release yet: the latest is GeoLibre 3.2.0, of 2026-10-01, so they reach users with the next one. This page ages: check the releases after its `stale_after` date.

| Issue | Kind | Asked | Closed by | What it gives | Here |
|---|---|---|---|---|---|
| [#2819](https://github.com/opengeos/GeoLibre/issues/2819) | feature | `?plugin=<id>` for plugins of the registry, behind the trust prompt | [#2831](https://github.com/opengeos/GeoLibre/pull/2831) | `?plugin=openrndt-geolibre` opens the plugin; not installed, GeoLibre asks "Install this plugin?" with name, version, author, description, homepage and manifest address, and installs it after "Trust and load" (seen on web.geolibre.app, 2026-10-04) | a link needs no project file: [Share a search](../guides/share-a-search.md) |
| [#2820](https://github.com/opengeos/GeoLibre/issues/2820) | feature | the host's proj4 for plugins, as `getDeckGL()` gives deck.gl | [#2824](https://github.com/opengeos/GeoLibre/pull/2824) | `app.getProj4()` | no gain while the minimum version is 3.2.0: [proj4 in the bundle](../decisions/proj4-in-the-bundle.md), [#29](https://github.com/ondata/openrndt-geolibre/issues/29) |
| [#2821](https://github.com/opengeos/GeoLibre/issues/2821) | feature | a way for an external plugin's project state to survive "Strip credentials" | [#2836](https://github.com/opengeos/GeoLibre/pull/2836) | `publishableSettings` in the registry entry | needs a line in our registry entry: [Strip credentials](../limits/strip-credentials.md), [#27](https://github.com/ondata/openrndt-geolibre/issues/27) |
| [#2823](https://github.com/opengeos/GeoLibre/issues/2823) | feature | an `addWfsLayer` in the plugin API (GML fallback, reprojection, refresh) | [#2826](https://github.com/opengeos/GeoLibre/pull/2826) | `app.addWfsLayer(name, { url, typeName, version?, bbox? })`, with the host's limit of 1,000 features | WFS without GeoJSON output: [Services that fail](../limits/services-that-fail.md), [#28](https://github.com/ondata/openrndt-geolibre/issues/28) |
| [#2833](https://github.com/opengeos/GeoLibre/issues/2833) | feature | an update offered in Manage Plugins instead of holding the plugin back as failed | [#2835](https://github.com/opengeos/GeoLibre/pull/2835) | an "update available" badge and Update for a registry plugin whose files changed | no plugin change: [An update needs a reinstall](../limits/update-needs-reinstall.md) |
| [#2822](https://github.com/opengeos/GeoLibre/issues/2822) | bug | Open Recent refuses a project whose name does not end in `.geolibre.json`, with a misleading message | [#2828](https://github.com/opengeos/GeoLibre/pull/2828) | Save As adds `.geolibre.json`; the message names the extension | no plugin change: [Project file names](../limits/project-file-names.md) |
| [#2840](https://github.com/opengeos/GeoLibre/issues/2840) | bug | a plugin's fetch in Desktop loses the server's HTTP error behind the webview fallback | [#2843](https://github.com/opengeos/GeoLibre/pull/2843) | the native error reaches the plugin (404, DNS, timeout), one entry in Diagnostics; 10 s for the webview when the host was not reached | no plugin change: [Services that fail](../limits/services-that-fail.md) |

In #2843 the maintainers also found that on Linux and macOS the fallback gave a plugin GeoLibre's own `index.html` as the body of a failed request; on Windows it gave "Failed to fetch".

"Closed by" is read in the pull requests on 2026-10-04; what they give is their description and GeoLibre's plugin API guide on `main`, not tried here.

# Opened and closed on 2026-10-04

Found on the Agenzia delle Entrate cadastral WMS (layer `fabbricati`, drawn in EPSG:6706). Each was closed by a pull request from this project, merged on 2026-10-04; none is in a release yet.

| Issue | Kind | Asked | Closed by | What it gives | Here |
|---|---|---|---|---|---|
| [#2886](https://github.com/opengeos/GeoLibre/issues/2886) | bug | WMS identify to use the CRS the layer is drawn in, not always EPSG:3857 | [#2889](https://github.com/opengeos/GeoLibre/pull/2889) | GetFeatureInfo in `source.crs`, else the CRS of the GetMap tiles; projected CRSs in Desktop | no plugin change: the panel already passes `crs` |
| [#2887](https://github.com/opengeos/GeoLibre/issues/2887) | bug | read `queryable`, skip GetFeatureInfo on layers that are not queryable, show a WMS exception as an error | [#2890](https://github.com/opengeos/GeoLibre/pull/2890) | `queryable` from capabilities in Add Data, `addWmsLayer({ queryable: false })`, a "does not provide feature information" message | the panel can pass the flag: [#32](https://github.com/ondata/openrndt-geolibre/issues/32) |
| [#2888](https://github.com/opengeos/GeoLibre/issues/2888) | feature | read GetFeatureInfo HTML tables into fields instead of one `result` text | [#2896](https://github.com/opengeos/GeoLibre/pull/2896) | `th`/`td` rows, or a header row over a data row, become fields | no plugin change |

# Opened on 2026-10-04

| Issue | Kind | Asks | Here |
|---|---|---|---|
| [#2898](https://github.com/opengeos/GeoLibre/issues/2898) | bug | whether `?plugin=` should open an installed registry plugin in `layout=viewer`: the code ignores every registry plugin there, the docs say only the install is skipped | in viewer the plugin never opens from a link: [URL parameters](../reference/url-parameters.md) |
| [#2855](https://github.com/opengeos/GeoLibre/issues/2855) | feature | the Metadata dialog of a WMS or tile layer to show its source (address, layers, version), and a `metadata` option in `addWmsLayer` and the other `add*Layer` calls | a layer added from the panel would keep the record it comes from; today the dialog shows only name and type |

# Why they exist

Each came from a limit met while building a feature of the plugin, and each is written so that it can be reproduced without the plugin.

# Not asked yet

- A way for a plugin to tell GeoLibre that the project changed: see [A search is not a project change](../limits/unsaved-search.md).
- A way for a registry plugin to sit in the **Plugins > Web Services** submenu, where GeoLibre groups its built-in catalogue browsers. The submenu is a fixed list of built-in plugin ids in GeoLibre's code (read on 2026-10-03).
