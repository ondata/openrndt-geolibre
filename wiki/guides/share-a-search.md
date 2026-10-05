---
type: Guide
title: Share a search
description: Ways to pass a search on - Share, a link that opens GeoLibre on a search, a project that carries the search, and a text for an AI agent.
tags: [link, project, share, url-parameters]
status: stable
sources:
  - id: readme
    resource: ../../README.md
    title: README, "Try it now, in your browser"
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
  - id: agent
    resource: ../../src/rndt/agent-text.ts
    title: agentText, and LOG, 2026-10-03
---

# With Share

From version 0.2.0 (#31). **Share** is in the ⋯ menu of the results header and in the ⋯ menu of a record's detail view. It builds the GeoLibre web link of what is on screen:

- from the results header: the search, with every filter that is not at its default (the parameters of [URL parameters](../reference/url-parameters.md)), or the record open, if one is;
- from a detail view: that record, as `?rndt=<id>`.

The link always starts with `https://web.geolibre.app/?plugin=openrndt-geolibre`, also from GeoLibre Desktop, whose own address means nothing to whoever receives it. Where the browser offers the system share sheet, Share opens it; otherwise it copies the link and the entry reads "Link copied". Closing the share sheet without sharing does nothing.

Seen on 2026-10-04 with the development copy on web.geolibre.app: in a Chromium browser on Windows 11 the Windows share sheet opens ("Condividi link"), with nearby sharing, WhatsApp, Gmail, Outlook, Teams and LinkedIn; in a headless Chrome on Linux the link is copied. GeoLibre Desktop not tried yet.[^log]

# With a link

From version 0.1.6. Two parameters in the address of GeoLibre web turn the plugin on, open the panel and start a search:

```text
https://web.geolibre.app/?rndt=idrografia
https://web.geolibre.app/?rndt=catastale&rndtBbox=12.95,37.60,14.30,38.30
```

The details are in [URL parameters](../reference/url-parameters.md).

With `?plugin=openrndt-geolibre` before the search, whoever lacks the plugin is asked to install it ("Trust and load"), then the search runs. This is the form Share builds:

```text
https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=idrografia
```

Tried on web.geolibre.app on 2026-10-05 in a clean browser, with the registry copy (0.3.2): the search above gives 1,131 records, a record id opens that record. Not with `layout=viewer`: see [URL parameters](../reference/url-parameters.md).

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

# To an AI agent

In the ⋯ menu of the results header, **Copy for an agent** copies the search as Markdown, to paste into an AI agent, a note or a message. It holds:

- what RNDT is, in one paragraph;
- the search, with its filters in words and numbers: the map view is written as its box, since an agent does not see the map; date and time in UTC, the total and the page;
- the same `curl` command as the `curl` button, and what to change in it for the next page or for one record, and where the ISO XML of a record is;
- the records of the page as a table: id, title, organisation, available as. No abstracts;
- [openrndt](https://github.com/ondata/openrndt), the command line tool for the same catalogue.

The label reads "Copied: paste it into your agent" for 3 seconds. The entry is there when the search has results. The text of a page of 20 records is about 4 KB.[^agent]

[^log]: LOG, 2026-10-03 and 2026-10-04
[^agent]: agentText, and LOG, 2026-10-03
