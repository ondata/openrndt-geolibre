---
type: Limit
title: An update needs a reinstall
description: Before GeoLibre 3.3.0, when the registry gets a new version GeoLibre stops loading the installed plugin and shows it as failed, until it is uninstalled and installed again; 3.3.0 offers an Update.
tags: [limits, registry, update, install]
status: stable
sources:
  - id: integrity
    resource: https://github.com/opengeos/GeoLibre/blob/v3.2.0/apps/geolibre-desktop/src/lib/plugin-integrity.ts
    title: GeoLibre v3.2.0, plugin-integrity.ts and external-plugins.ts
  - id: i2833
    resource: https://github.com/opengeos/GeoLibre/issues/2833
    title: opengeos/GeoLibre#2833
    last_modified: 2026-10-04T00:00:00Z
  - id: pr2835
    resource: https://github.com/opengeos/GeoLibre/pull/2835
    title: opengeos/GeoLibre#2835
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03 and 2026-10-05
---

# Since GeoLibre 3.3.0

Manage Plugins offers the new version with an **Update** button, and Update loads it. Tried in GeoLibre Desktop 3.3.0 on Windows on 2026-10-05, with the registry copy.[^log] It comes from [opengeos/GeoLibre#2835](https://github.com/opengeos/GeoLibre/pull/2835).[^pr2835] What follows holds for GeoLibre before 3.3.0.

# What the user sees

After a new version of the plugin reaches the registry, at the next start of GeoLibre:

- Manage Plugins lists **RNDT catalogue** with the new version number and the badge "Failed";
- the message: "Plugin at 'https://plugins.geolibre.app/plugins/openrndt-geolibre/plugin.json' changed since you last trusted it and was not loaded. Open Settings → Plugins, uninstall it, then install it again to review and accept the update.";
- "Updatable" counts 0, and the plugin is missing from the Plugins menu.

Seen on 2026-10-03 by a user of GeoLibre Desktop who had 0.1.4, the day the registry moved to 0.1.7.[^log]

# What to do

In **Settings > Manage Plugins** uninstall RNDT catalogue, then install it again.

# Why

GeoLibre keeps the SHA-256 of a plugin loaded from an address the first time it is trusted, and does not run a bundle whose hash changed: it closes the way to a silent update from a compromised or changed host. The registry gives the plugin one fixed address, with no version in it, so a release changes the files there and the hash with them. The update Manage Plugins can offer compares the registry version with the loaded one, and a held-back plugin is not loaded.[^integrity]

It is so for every plugin of the registry. The request to offer the update instead: opengeos/GeoLibre#2833, see [Requests to GeoLibre](../upstream/geolibre-requests.md).[^i2833]

# How 3.3.0 changes it

opengeos/GeoLibre#2835, merged on 2026-10-03 and released in 3.3.0, keeps the version next to the hash. When the files changed and the registry lists a newer version, Manage Plugins shows "update available" and an Update button, which loads and pins the new bundle in one step. Any other change of the files stays held back.[^pr2835]

# For a release

Before GeoLibre 3.3.0, every release that reaches the registry costs each user a reinstall: one more reason to bring versions there in batches, see [Registry updates in batches](../decisions/registry-updates-in-batches.md).

[^integrity]: GeoLibre v3.2.0, plugin-integrity.ts and external-plugins.ts
[^i2833]: opengeos/GeoLibre#2833
[^pr2835]: opengeos/GeoLibre#2835
[^log]: LOG, 2026-10-03 and 2026-10-05
