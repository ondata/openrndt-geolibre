---
type: Guide
title: Install the plugin
description: Install from GeoLibre's Manage Plugins, from a zip, or by hand, and turn the plugin on.
tags: [install, registry, desktop, web]
status: stable
sources:
  - id: readme
    resource: ../../README.md
    title: README, "Try it"
  - id: registry
    resource: https://plugins.geolibre.app/
    title: GeoLibre plugin registry
---

# Requirements

[GeoLibre](https://github.com/opengeos/GeoLibre/releases) 3.2.0 or later, Desktop or web (`https://web.geolibre.app`).

# From Manage Plugins

1. Open **Settings > Manage Plugins**.
2. Find **RNDT catalogue** and choose **Install**.
3. Turn it on from **Plugins > RNDT catalogue**.

This is the way to prefer: a project saved afterwards carries the address of the plugin, so it opens on another computer too (see [Share a search](share-a-search.md)). The version offered is the one in the registry, which can be older than the latest release: see [Registry status](../upstream/registry-status.md).

# After a new version in the registry

When the registry gets a new version, GeoLibre does not offer it as an update to who has the plugin already. At the next start the plugin is not loaded: Manage Plugins shows it as "Failed", with "Plugin at '…/plugin.json' changed since you last trusted it and was not loaded", and it is missing from the Plugins menu. In Manage Plugins uninstall it and install it again. Why: [An update needs a reinstall](../limits/update-needs-reinstall.md).

# In the web version

The list of installed plugins is kept in the browser's storage: it stays after the browser is closed, and it is per browser and per profile.

# From a zip

For a version that is not in the registry yet, in GeoLibre Desktop:

1. Download `openrndt-geolibre-<version>.zip` from the [releases](https://github.com/ondata/openrndt-geolibre/releases).
2. Open Manage Plugins, go to Settings, choose **Install from file** and pick the zip.
3. Restart GeoLibre, then **Plugins > RNDT catalogue**.

# By hand

Unzip into a folder named `openrndt-geolibre` inside GeoLibre's plugins folder, so that `plugin.json` and `dist/` sit directly in it, then restart GeoLibre.

| System | Plugins folder |
|---|---|
| Windows | `%APPDATA%\org.geolibre.desktop\plugins\` |
| macOS | `~/Library/Application Support/org.geolibre.desktop/plugins/` |
| Linux | `~/.local/share/org.geolibre.desktop/plugins/` |

A plugin copied by hand into the plugins folder has no address a project can carry: see [Share a search](share-a-search.md). Whether one installed from a zip has one was not checked.
