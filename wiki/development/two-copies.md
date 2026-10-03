---
type: Playbook
title: The two copies of the plugin
description: How the plugin from the registry and the development copy live together in one GeoLibre, which one to use for which test, and the cycle from a change to a release.
tags: [development, tests, release, desktop, web]
status: stable
sources:
  - id: constants
    resource: ../../src/rndt/constants.ts
    title: Id, name and label of the two copies
  - id: vite
    resource: ../../vite.geolibre.config.ts
    title: Build of the development copy
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
---

# Which is which

| | Plugin from the registry | Development copy |
|---|---|---|
| What it is | the released version everybody installs | the working tree, with what is not released yet |
| Where it comes from | **Settings > Manage Plugins**, from the registry | built here with `npm run build:geolibre:dev` |
| Id | `openrndt-geolibre` | `openrndt-geolibre-dev` |
| Name in the Plugins menu | RNDT catalogue | RNDT catalogue (dev) |
| Panel title and toolbar menu | RNDT | RNDT (dev) |
| Bundle folder | `geolibre-plugin/` | `geolibre-plugin-dev/`, not in git |
| Updated by | Manage Plugins, after a release reaches the registry | a new build and install, at every change |

The code is the same. Only the id and the two names change, and with the id every name the plugin registers under: panel, toolbar menu, footprints layers, settings and error log in the browser's storage. So the two copies have separate settings.[^constants]

Two bundles with the same id cannot be installed together, one replaces the other: that is why the development copy has its own.

# Rules

- The plugin from the registry is never copied by hand into the plugins folder: it is installed and updated from Manage Plugins only, so it is what users get.
- The development copy is the only hand install.
- One copy turned on at a time. Both can stay installed.
- `geolibre-plugin/` holds the build with the real id, for releases; a development build never touches it.[^vite]

# The cycle

1. Change the code, run the tests: [Build and test](build-and-test.md).
2. Build and install the development copy (below), restart GeoLibre Desktop, turn on **RNDT catalogue (dev)** and try the change.
3. Release: [Release in the repository](release.md), then [Release in the registry](registry-release.md).
4. When the registry has the new version, update **RNDT catalogue** from Manage Plugins and try it once more there, as a user would.

# Install the development copy

GeoLibre Desktop on Windows, building in WSL:

```bash
npm run build:geolibre:dev
P=/mnt/c/Users/<user>/AppData/Roaming/org.geolibre.desktop/plugins
GEOLIBRE_PLUGINS_DIR="$P" node scripts/install-geolibre-plugin.mjs --bundle geolibre-plugin-dev
```

On the system GeoLibre runs on, `npm run install:geolibre:dev` does both steps. Then restart GeoLibre Desktop: plugins in that folder are read at startup. The other systems' folders: [Installing in GeoLibre Desktop](installing-in-desktop.md).

In the web version: serve `geolibre-plugin-dev/` from localhost and add the address of its `plugin.json`, as in [Testing in GeoLibre web](testing-in-geolibre-web.md).

# Which copy for which test

| To try | Copy |
|---|---|
| a change not released yet | development |
| the [search saved in a project](../reference/project-state.md), as users get it | registry |
| a link with [URL parameters](../reference/url-parameters.md) | either, with the other one not installed or the result read with care |
| a released version, before telling anybody | registry |

Two facts of GeoLibre 3.2.0's plugin manager are behind the table:[^log]

- The state a project saves is kept per plugin id. A project saved with the development copy does not bring its search back in the plugin from the registry, and the other way round.
- A URL parameter is handed to every installed plugin that declares it, and that plugin is turned on. The two copies declare the same `rndt` and `rndtBbox`, so with both installed a link turns on both.

# Tried

On 2026-10-03, in the web version, one project loading both copies: two entries in the Plugins menu, both on together, no error in Diagnostics. In GeoLibre Desktop 3.2.0 on Windows: the development copy in the plugins folder and the plugin installed from Manage Plugins both listed in the Plugins menu.[^log]

[^constants]: Id, name and label of the two copies
[^vite]: Build of the development copy
[^log]: LOG, 2026-10-03
