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
| In the registry (what Manage Plugins installs) | 0.1.4 |
| Latest release of the repository | 0.1.7 |
| On its way to the registry | 0.1.7, in [opengeos/geolibre-plugins#64](https://github.com/opengeos/geolibre-plugins/pull/64), open, all checks passed, waiting for the maintainer |

This page ages: read the registry's list after its `stale_after` date.

# What the gap means

Until the registry has 0.1.6 or later, a plugin installed from Manage Plugins has neither the [URL parameters](../reference/url-parameters.md) nor the conversion of [coordinate systems](../reference/coordinate-systems.md); until it has 0.1.7, no [search saved in a project](../reference/project-state.md). The same goes for a project that loads the plugin from the registry, such as the one used in [Share a search](../guides/share-a-search.md).

To use a newer version before then: install from the zip of the release, see [Install the plugin](../guides/install.md).

# History

| Version | In the registry |
|---|---|
| 0.1.4 | 2026-10-02, [opengeos/geolibre-plugins#62](https://github.com/opengeos/geolibre-plugins/pull/62) |

How a version gets there: [Release in the registry](../development/registry-release.md).
