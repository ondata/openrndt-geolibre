---
type: Status
title: Registry status
description: Which version of the plugin the GeoLibre plugin registry serves, and which is on its way.
resource: https://plugins.geolibre.app/plugin-registry.json
tags: [upstream, registry, release]
status: stable
stale_after: 2026-11-18T00:00:00Z
sources:
  - id: registry
    resource: https://plugins.geolibre.app/plugin-registry.json
    title: The registry's list of plugins
    last_modified: 2026-10-19T20:55:00Z
  - id: pr64
    resource: https://github.com/opengeos/geolibre-plugins/pull/64
    title: opengeos/geolibre-plugins#64
    last_modified: 2026-10-03T00:00:00Z
  - id: pr110
    resource: https://github.com/opengeos/geolibre-plugins/pull/110
    title: opengeos/geolibre-plugins#110
    last_modified: 2026-10-19T20:51:59Z
  - id: releases
    resource: https://github.com/ondata/openrndt-geolibre/releases
    title: Releases of the plugin
---

# State on 2026-10-19

| | Version |
|---|---|
| In the registry (what Manage Plugins installs) | 0.3.13 |
| Latest release of the repository | 0.3.13 |

The registry has the latest release: 0.3.13 (the [AI Assistant drives the panel](../guides/ai-assistant.md), minimum GeoLibre 3.4.0) was read in its list, with `minGeoLibreVersion` 3.4.0 and the zip's sha256 `408461f4…`, and in the plugin's `plugin.json` on 2026-10-19, after [opengeos/geolibre-plugins#110](https://github.com/opengeos/geolibre-plugins/pull/110) was merged. Before the merge the pull request's preview served 0.3.13, and a search from a link worked there (17 records, Diagnostics 0).

This page ages: read the registry's list after its `stale_after` date.

# What a gap means

When the registry is behind the repository, a plugin installed from Manage Plugins lacks what the newer releases add: before 0.1.6 it had neither the [URL parameters](../reference/url-parameters.md) nor the conversion of [coordinate systems](../reference/coordinate-systems.md), before 0.1.7 no [search saved in a project](../reference/project-state.md), before 0.2.0 no link parameters beyond text and area and no Share, before 0.3.0 no `queryable`, no provenance metadata and a bundled proj4. Before 0.3.13 the AI Assistant cannot drive the panel, and the plugin works with GeoLibre 3.3.0. The same goes for a project that loads the plugin from the registry, such as the one used in [Share a search](../guides/share-a-search.md).

To use a newer version before the registry has it: install from the zip of the release, see [Install the plugin](../guides/install.md).

# History

| Version | In the registry |
|---|---|
| 0.2.0 | 2026-10-04, [opengeos/geolibre-plugins#78](https://github.com/opengeos/geolibre-plugins/pull/78), with `publishableSettings` |
| 0.3.1 | 2026-10-05, [opengeos/geolibre-plugins#93](https://github.com/opengeos/geolibre-plugins/pull/93), minimum GeoLibre 3.3.0, license, screenshots |
| 0.3.2 | 2026-10-05, [opengeos/geolibre-plugins#94](https://github.com/opengeos/geolibre-plugins/pull/94), footprints quiet while Identify is on |
| 0.3.7 | 2026-10-09, [opengeos/geolibre-plugins#101](https://github.com/opengeos/geolibre-plugins/pull/101), opened for 0.3.4 and moved up: footprints quiet while GeoEditor is on, Share with the map view and the layers turned on, `rndtView` |
| 0.3.8 | 2026-10-10, [opengeos/geolibre-plugins#104](https://github.com/opengeos/geolibre-plugins/pull/104), a link with layers and no view opens on them, date filter on the record's last change |
| 0.3.12 | 2026-10-10, [opengeos/geolibre-plugins#105](https://github.com/opengeos/geolibre-plugins/pull/105), opened for 0.3.9 and moved up: organisation names with commas, swapped box corners, filter by IPA code, ⋯ menus |
| 0.3.13 | 2026-10-19, [opengeos/geolibre-plugins#110](https://github.com/opengeos/geolibre-plugins/pull/110), the AI Assistant drives the panel, minimum GeoLibre 3.4.0 |
| 0.1.9 | 2026-10-03, [opengeos/geolibre-plugins#65](https://github.com/opengeos/geolibre-plugins/pull/65) |
| 0.1.7 | 2026-10-03, [opengeos/geolibre-plugins#64](https://github.com/opengeos/geolibre-plugins/pull/64) |
| 0.1.4 | 2026-10-02, [opengeos/geolibre-plugins#62](https://github.com/opengeos/geolibre-plugins/pull/62) |

How a version gets there: [Release in the registry](../development/registry-release.md).
