---
type: Decision
title: Newest first without a text
description: With no text searched and the sort on Relevance, the panel asks the catalogue for the newest metadata first.
tags: [search, sort]
status: stable
decided: 2026-10-02
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02 (0.1.5)
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: withEffectiveSort
---

# Decision

When the sort is Relevance and the text is empty, the panel sends `sort=apiso_Modified_dt:desc`. The header of the results shows the order applied; the form keeps Relevance, and a text brings relevance back. From version 0.1.5.

# Why

Without a text the catalogue has nothing to weigh, and "relevance" is the order in which it indexed the records: measured on the API, the same four records always came first, with or without an area. With a text the scoring works.[^log]

# Where the rule lives

In the panel (`withEffectiveSort`), not in the function that builds the query: the pairs of form and query in `tests/fixtures/queries.json` stay shared with the openrndt command line tool.

[^log]: LOG, 2026-10-02 (0.1.5)
