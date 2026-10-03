---
type: Guide
title: Share a search
description: Two ways to pass a search on - a link that opens GeoLibre on a search, and a project that carries the search.
tags: [link, project, share, url-parameters]
status: stable
sources:
  - id: readme
    resource: ../../README.md
    title: README, "Open a search from a link" and "The search travels with the project"
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
  - id: gist
    resource: https://gist.github.com/aborruso/68601ad2b7f4af7a9156ba932f1b10a6
    title: A project that lists the plugin
---

# With a link

From version 0.1.6. Two parameters in the address of GeoLibre web turn the plugin on, open the panel and start a search:

```text
https://web.geolibre.app/?rndt=idrografia
https://web.geolibre.app/?rndt=catastale&rndtBbox=12.95,37.60,14.30,38.30
```

The details are in [URL parameters](../reference/url-parameters.md).

The link works where the plugin is installed: GeoLibre never installs a plugin from a link. For someone who does not have it, add a project that lists the plugin:[^gist]

```text
https://web.geolibre.app/?url=https://gist.githubusercontent.com/aborruso/68601ad2b7f4af7a9156ba932f1b10a6/raw/rndt.geolibre.json&rndt=idrografia
```

The first time GeoLibre asks "Load plugins from this project?"; after **Trust and load** the plugin is loaded and the search starts. On later visits in the same browser there is no question. The project loads the plugin from the registry, so the search starts only when the registry has a version with these parameters: see [Registry status](../upstream/registry-status.md).

# With a project

From version 0.1.7. When a GeoLibre project is saved, the last search of the panel goes into it: text and filters, the area as the box that was searched, the page, the open record. Whoever opens the project finds the plugin on, the search done and that record open. What is saved is in [Project state](../reference/project-state.md).

Steps:

1. Search, and open the record worth keeping.
2. **Project > Save** (or Save As), with a file name ending in `.geolibre.json`: see [Project file names](../limits/project-file-names.md).
3. At "Strip credentials?" choose **Keep in file**: see [Strip credentials](../limits/strip-credentials.md).
4. Pass the file on.

Things to know:

- The results are not saved: the search runs again when the project opens, so a catalogue that changed can answer with other records.
- A search is not a change for GeoLibre: see [A search is not a project change](../limits/unsaved-search.md).
- A project that carries no search empties the panel: see [the decision](../decisions/project-without-search-empties-panel.md).
- A link wins over the search of a project opened with it, and is followed once.

# On a computer without the plugin

| The project was saved where the plugin | What happens |
|---|---|
| came from Manage Plugins | the project carries the plugin's address; GeoLibre asks "Load plugins from this project?", then shows the search |
| was copied by hand into the plugins folder | the project carries no address; it opens without the plugin and the search stays unused in the file |

The second row was seen with a project saved in GeoLibre Desktop and opened in a clean browser.[^log]

[^gist]: A project that lists the plugin
[^log]: LOG, 2026-10-03
