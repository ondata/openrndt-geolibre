---
type: Guide
title: Search the catalogue
description: How to search RNDT from the panel, read the results and open a record.
tags: [search, results, filters]
status: stable
sources:
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "What it does"
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: The panel
---

# Start

Turn the plugin on from **Plugins > RNDT catalogue**. The panel opens on the right. If the map view is not on Italy the map moves to Italy; a view already on Italy stays where it is.

Type a text and press **Search**. With no text the search returns the whole catalogue, newest metadata first (see [Newest first without a text](../decisions/newest-first-without-text.md)).

# Filters

| Filter | Choices |
|---|---|
| Type | All, Data, Services (with the INSPIRE service type) |
| Where | Anywhere, Current map view, Drawn shapes (GeoEditor), a typed Box (west, south, east, north) |
| Area relation | Touches the area, Inside the area |
| Available as | WMS, WFS, ArcGIS REST |
| Advanced: Match | All words, Any word, Lucene |
| Advanced: Search in | Anywhere, Title, Abstract, Lineage, Use limitation |
| Advanced | INSPIRE theme, keywords, organisation (show only or hide), open data only, dates, sort |

"Current map view" is the default area. The "?" buttons and **Search help** explain each filter with examples that can be clicked. The exact query each filter becomes is in [Search form and query](../reference/search-query.md).

# A record id

A record id typed alone in the text box (as **Copy id** of a record gives it) opens that record, whatever the filters.

# Recent searches

A click in the search box lists the last 20 searches, newest first. The browser's own autocomplete on the box is off: the list is the panel's.

- An entry is a whole search: the text, and under it the filters as the chips say them, with the time ("15:42" today, "Yesterday", then the date) and the number of results it had. A record opened by its id is listed with its title, marked **Record**.
- A click runs it again, from the first page. Typing narrows the list to the entries that hold those letters, in the text, the title, the id or the filters.
- × removes an entry; **Clear history** empties the list, after asking.
- Keys: ↓ opens the list or goes down, ↑ goes up and back to the box, Enter runs the highlighted entry (with none, it searches the text typed), Esc closes the list and keeps the text, Delete removes the highlighted entry.

What is kept:

- A search started from the box, from an entry or from a link. A page, the sort order, a chip removed and **Clear all** change the entry on top instead of adding one.
- Not a search with no results, nor one a project brought back when it was opened.
- The same text and filters over another area are the same search: the entry goes back on top with the newer area.

A search made on the map view keeps the box it had: run again, the map goes to that area and the chip reads **Saved area**. The same goes for a search a project brings back.

The list is on the computer, with the settings, never in a project. **Settings** turns it off, which also clears it: [Settings and error log](../reference/settings-and-error-log.md).

# Results

- Active filters are shown as chips that can be removed one by one, with **Edit filters** and **Clear all**. With no filter there is no chip row: a **Filters** link sits at the end of the row of **Zoom to results** and **Hide footprints**.
- A pager, the sort order and a `curl` button that copies the request sit above the list.
- Each card shows type, formats, organisation and metadata date; its ⋯ menu hides that organisation or keeps only it.
- The extents of the records are drawn on the map: see [Footprints](../reference/footprints.md).

A click on a title opens the record in the detail view, with its abstract, services and links. **← N results** and the place of the record in the page ("3 of 20") stay fixed under the search box while the record scrolls. A long abstract is cut at four lines, with **More**. From there: [Add layers to the map](add-layers.md).

# No results

With no record found, the pager, the sort order and `curl` are not shown. Under "No records found." the panel offers the changes that can find something, each a link that runs the search again:

- **Search Anywhere instead of the map view**, when the area is the current map view;
- **Match any word (a or b)**, when the text has more than one word and the match mode is All words.

When neither applies, the message alone.
