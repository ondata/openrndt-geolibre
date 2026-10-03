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

# State on 2026-10-03

| | Version |
|---|---|
| In the registry (what Manage Plugins installs) | 0.1.7 |
| Latest release of the repository | 0.1.8 |

The registry is one release behind: 0.1.7 was read in its list on 2026-10-03, after [opengeos/geolibre-plugins#64](https://github.com/opengeos/geolibre-plugins/pull/64) was merged, and 0.1.8 was released the same day. It is on its way in [opengeos/geolibre-plugins#65](https://github.com/opengeos/geolibre-plugins/pull/65), opened on 2026-10-03.

This page ages: read the registry's list after its `stale_after` date.

# What a gap means

When the registry is behind the repository, a plugin installed from Manage Plugins lacks what the newer releases add: before 0.1.6 it had neither the [URL parameters](../reference/url-parameters.md) nor the conversion of [coordinate systems](../reference/coordinate-systems.md), before 0.1.7 no [search saved in a project](../reference/project-state.md). The same goes for a project that loads the plugin from the registry, such as the one used in [Share a search](../guides/share-a-search.md).

To use a newer version before the registry has it: install from the zip of the release, see [Install the plugin](../guides/install.md).

# History

| Version | In the registry |
|---|---|
| 0.1.7 | 2026-10-03, [opengeos/geolibre-plugins#64](https://github.com/opengeos/geolibre-plugins/pull/64) |
| 0.1.4 | 2026-10-02, [opengeos/geolibre-plugins#62](https://github.com/opengeos/geolibre-plugins/pull/62) |

How a version gets there: [Release in the registry](../development/registry-release.md).
