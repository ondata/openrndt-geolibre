---
type: Playbook
title: Release in the repository
description: Steps to release a version of the plugin on GitHub.
tags: [development, release]
status: stable
sources:
  - id: readme
    resource: ../../README.md
    title: README, "A release in the plugin registry", step 1
  - id: constants
    resource: ../../src/rndt/constants.ts
    title: PLUGIN_VERSION
---

# Steps

1. Set the same version in three files: `src/rndt/constants.ts` (`PLUGIN_VERSION`), `geolibre-plugin/plugin.json`, `package.json` (and `package-lock.json`). A test fails when the entry and `plugin.json` disagree: GeoLibre refuses a plugin whose manifest and export do not match.
2. Run `npm test`, `npx tsc --noEmit -p .` and `npm run lint`.
3. `npm run package:geolibre` writes the zip.
4. Add the release to `LOG.md`; commit as `chore: release <version>`; push.
5. Create the GitHub release `v<version>` with the zip attached and the changes since the previous version.

# The version number

GeoLibre compares only the numeric part of a version: between `0.2.0-alpha.1` and `0.2.0-alpha.2` it offers no update. A release meant for the registry needs a higher number, not only another suffix.[^readme]

# After

The registry does not follow by itself: see [Release in the registry](registry-release.md) and [Registry updates in batches](../decisions/registry-updates-in-batches.md).

[^readme]: README, "A release in the plugin registry", step 1
