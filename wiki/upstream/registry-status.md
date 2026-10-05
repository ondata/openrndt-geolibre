---
type: Status
title: Registry status
description: Which version of the plugin the GeoLibre plugin registry serves, and which is on its way.
resource: https://plugins.geolibre.app/plugin-registry.json
tags: [upstream, registry, release]
status: stable
stale_after: 2026-11-03T00:00:00Z
sources:
  - id: registry
    resource: https://plugins.geolibre.app/plugin-registry.json
    title: The registry's list of plugins
    last_modified: 2026-10-02T20:03:00Z
  - id: pr64
    resource: https://github.com/opengeos/geolibre-plugins/pull/64
    title: opengeos/geolibre-plugins#64
    last_modified: 2026-10-03T00:00:00Z
  - id: releases
    resource: https://github.com/ondata/openrndt-geolibre/releases
    title: Releases of the plugin
---

# State on 2026-10-05

| | Version |
|---|---|
| In the registry (what Manage Plugins installs) | 0.3.1 |
| Latest release of the repository | 0.3.1 |

The registry has the latest release: 0.3.1 (minimum GeoLibre 3.3.0, minified bundle, license, repository, issues and four screenshots for the [catalog page](https://plugins.geolibre.app/catalog/openrndt-geolibre/)) was read in its list and in the plugin's `plugin.json` on 2026-10-05, after [opengeos/geolibre-plugins#93](https://github.com/opengeos/geolibre-plugins/pull/93) was merged; 0.3.0 was never sent. Before it: 0.2.0 was read in its list (with `publishableSettings: true`) and in the plugin's `plugin.json` on 2026-10-04, after [opengeos/geolibre-plugins#78](https://github.com/opengeos/geolibre-plugins/pull/78) was merged. The entry now points at the zip of our own release. Tried the same day in a clean browser: `https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=fiumi&rndtKind=data&rndtTheme=hy&rndtAs=WMS&rndtSort=newest` asked to install the plugin, then searched with every filter (30 records).

This page ages: read the registry's list after its `stale_after` date.

# What a gap means

When the registry is behind the repository, a plugin installed from Manage Plugins lacks what the newer releases add: before 0.1.6 it had neither the [URL parameters](../reference/url-parameters.md) nor the conversion of [coordinate systems](../reference/coordinate-systems.md), before 0.1.7 no [search saved in a project](../reference/project-state.md), before 0.2.0 no link parameters beyond text and area and no Share, before 0.3.0 no `queryable`, no provenance metadata and a bundled proj4. The same goes for a project that loads the plugin from the registry, such as the one used in [Share a search](../guides/share-a-search.md).

To use a newer version before the registry has it: install from the zip of the release, see [Install the plugin](../guides/install.md).

# History

| Version | In the registry |
|---|---|
| 0.2.0 | 2026-10-04, [opengeos/geolibre-plugins#78](https://github.com/opengeos/geolibre-plugins/pull/78), with `publishableSettings` |
| 0.3.1 | 2026-10-05, [opengeos/geolibre-plugins#93](https://github.com/opengeos/geolibre-plugins/pull/93), minimum GeoLibre 3.3.0, license, screenshots |
| 0.1.9 | 2026-10-03, [opengeos/geolibre-plugins#65](https://github.com/opengeos/geolibre-plugins/pull/65) |
| 0.1.7 | 2026-10-03, [opengeos/geolibre-plugins#64](https://github.com/opengeos/geolibre-plugins/pull/64) |
| 0.1.4 | 2026-10-02, [opengeos/geolibre-plugins#62](https://github.com/opengeos/geolibre-plugins/pull/62) |

How a version gets there: [Release in the registry](../development/registry-release.md).
