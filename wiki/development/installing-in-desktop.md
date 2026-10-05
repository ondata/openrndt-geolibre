---
type: Playbook
title: Installing in GeoLibre Desktop
description: How to put a local build of the plugin in GeoLibre Desktop to try it there.
tags: [development, tests, desktop]
status: stable
sources:
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "Try it" and "Development"
---

# Steps

1. `npm run build`.
2. Copy `geolibre-plugin/plugin.json` and `geolibre-plugin/dist/` into a folder named `openrndt-geolibre` inside GeoLibre's plugins folder.
3. Restart GeoLibre Desktop: plugins in that folder are read at startup.
4. **Plugins > RNDT catalogue**.

| System | Plugins folder |
|---|---|
| Windows | `%APPDATA%\org.geolibre.desktop\plugins\` |
| macOS | `~/Library/Application Support/org.geolibre.desktop/plugins/` |
| Linux | `~/.local/share/org.geolibre.desktop/plugins/` |

Building in WSL for a GeoLibre on Windows:

```bash
P=/mnt/c/Users/<user>/AppData/Roaming/org.geolibre.desktop/plugins/openrndt-geolibre
mkdir -p "$P" && cp -r geolibre-plugin/plugin.json geolibre-plugin/dist "$P"/
```

`npm run install:geolibre` copies to the plugins folder of the system the command runs on: in WSL that is the Linux one, which a GeoLibre installed on Windows does not read.

# With the plugin from the registry installed

The steps above put the local build in the place of the plugin installed from Manage Plugins: the two have the same id. To keep both, install the development copy: [The two copies of the plugin](two-copies.md).

# Where to look when something fails

**Diagnostics**, bottom right in GeoLibre: errors of the map, of the network and of plugins, which can be copied as JSON.

# What a hand install changes

A plugin copied by hand has no address, so a project saved with it carries none: see [Share a search](../guides/share-a-search.md).
