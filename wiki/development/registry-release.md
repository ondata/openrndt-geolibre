---
type: Playbook
title: Release in the registry
description: Steps to bring a released version into the GeoLibre plugin registry with a pull request.
resource: https://github.com/opengeos/geolibre-plugins
tags: [development, release, registry]
status: stable
sources:
  - id: readme
    resource: ../../README.md
    title: README, "A release in the plugin registry"
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02 and 2026-10-03
---

# Where

The registry is the repository [opengeos/geolibre-plugins](https://github.com/opengeos/geolibre-plugins). A version gets there with a pull request from the fork `ondata/geolibre-plugins`.

# Steps

Since the registry was reworked in October 2026 (opengeos/geolibre-plugins#69-#74) the plugin's code is not committed there: the entry points at the zip of our release, and the registry's CI copies it to `plugins.geolibre.app` through an R2 mirror.

1. [Release here](release.md) first: the zip attached to the GitHub release is what the registry will serve.
2. In the fork, on a branch from an updated `main`, edit `registry/openrndt-geolibre.json` (one file per plugin since #69):
   - `version`, the same as the release;
   - `source.url`, the zip's HTTPS URL on our releases: `https://github.com/ondata/openrndt-geolibre/releases/download/v<version>/openrndt-geolibre-<version>.zip`;
   - `source.sha256`, `sha256sum` of the zip (64 lowercase hex).
3. `manifestUrl` stays `plugins/openrndt-geolibre/plugin.json` and no `plugins/openrndt-geolibre/` folder is committed: the CI downloads the zip, checks the hash, validates it, and on merge publishes it to `plugins/openrndt-geolibre/<version>/`. A published version never changes, so a new release needs a new version and a new `source`.
4. Run in the fork `pre-commit run --all-files`, and check the entry against `schemas/registry-entry.schema.json` (`additionalProperties: false`; `categories` from the fixed list).
5. Open the pull request, in English, with the changes since the version in the registry and the size of the bundle.

Note: the current entry's `source.url` points at a `bundles-2026-10` release of opengeos/geolibre-plugins, where the migration (#74) re-hosted the 0.1.9 zip. For the next versions use our own release URL, as above.

# The preview

Each pull request gets a preview at `https://opengeos.org/pages-preview/geolibre-plugins/pr-<N>/`: GeoLibre's web version built with the plugin of the pull request inside. There the plugin is part of the build, so it is registered without installation and without a trust prompt, and a link such as `…/pr-<N>/?rndt=idrografia` works at once. The preview is deleted when the pull request is closed or merged.[^log]

# What the checks are

| Check | What it looks at |
|---|---|
| validate | the entry against `schemas/registry-entry.schema.json`; the zip's hash and layout (`plugin.json` at the root or in one wrapping folder); registry entry, manifest and export agree on id, name, version |
| publish (dry run on PRs) | plans the copy of the zip to `plugins/openrndt-geolibre/<version>/` and the update of the stable `plugin.json` |
| pre-commit | formatting |

# Do not

- Open a pull request to the registry without the maintainer of the plugin asking for it.
- Close a pull request to send a newer version: update its branch, title and description instead.
- Reuse a published version with a different zip: the mirror refuses it, bump the version.
- Add fields not in `schemas/registry-entry.schema.json`: `additionalProperties` is `false`.

[^log]: LOG, 2026-10-02 and 2026-10-03
