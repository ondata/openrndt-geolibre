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

1. [Release here](release.md) first: the registry takes the same files as the release.
2. In the fork, on a branch from an updated `main`: copy `geolibre-plugin/plugin.json` and `geolibre-plugin/dist/` to `plugins/openrndt-geolibre/`, and set the same version in the plugin's entry of `plugin-registry.json`.
3. Run there `npm ci && npm run minify && npm run minify:check`, `node scripts/validate_plugins.mjs` and `pre-commit run --all-files`. The minify step must be run locally: the registry's workflow cannot push to a fork.
4. Open the pull request, in English, with the changes since the version in the registry and the size of the bundle.

# The preview

Each pull request gets a preview at `https://opengeos.org/pages-preview/geolibre-plugins/pr-<N>/`: GeoLibre's web version built with the plugin of the pull request inside. There the plugin is part of the build, so it is registered without installation and without a trust prompt, and a link such as `…/pr-<N>/?rndt=idrografia` works at once. The preview is deleted when the pull request is closed or merged.[^log]

# What the checks are

| Check | What it looks at |
|---|---|
| validate | registry entry, manifest and export agree on id, name, version |
| minify | the bundle is whitespace-minified |
| pre-commit | formatting |
| automated reviews | the manifest and the registry entry; the minified bundle is not reviewed line by line |

# Do not

- Open a pull request to the registry without the maintainer of the plugin asking for it.
- Close a pull request to send a newer version: update its branch, title and description instead.

[^log]: LOG, 2026-10-02 and 2026-10-03
