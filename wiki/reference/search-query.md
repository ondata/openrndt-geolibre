---
type: Reference
title: Search form and query
description: Each filter of the search form and the clause of the RNDT REST query it becomes.
resource: https://geodati.gov.it/RNDT/rest/metadata/search
tags: [search, query, rest-api, lucene]
status: stable
sources:
  - id: query
    resource: ../../src/rndt/query.ts
    title: Search form to REST query
  - id: constants
    resource: ../../src/rndt/constants.ts
    title: Option lists of the form
  - id: fixtures
    resource: ../../tests/fixtures/queries.json
    title: Form and expected query, shared with the openrndt CLI
---

# Request

The panel asks `https://geodati.gov.it/RNDT/rest/metadata/search` with these parameters, in this order:[^query]

| Parameter | Value |
|---|---|
| `q` | the clauses below, joined by ` AND `; left out when there is none |
| `bbox` | `west,south,east,north`, rounded to 6 decimals; only with an area |
| `spatialRel` | `Intersects` or `Within`; only with an area |
| `sort` | only when a sort order is chosen |
| `start` | first result of the page, from 1 |
| `num` | 20 |
| `f` | `json` |

A date or a box that is not valid stops the search with a message: the catalogue would ignore it and return everything.

# Clauses of `q`

| Filter | Clause |
|---|---|
| Text, All words | `(word1 AND word2)`, words escaped; `*` and `?` stay wildcards |
| Text, Any word | `(word1 OR word2)` |
| Text, Lucene | `(text)` as typed |
| Search in | the group above prefixed by the field: `title:`, `description:`, `apiso_Lineage_txt:`, `apiso_AccessConstraints_s:` |
| Keywords | `keywords_s:("a" OR "b")`, exact values |
| Organisation, show only | `EnteResponsabile_s:` with a case-insensitive "contains" match, a regular expression |
| Organisation, hide | the same, prefixed by `NOT ` |
| INSPIRE theme | `INSPIRETheme_s:("…")`, the Italian label; not with Type Services |
| Open data only | `_exists_:isOpendata`; not with Type Services |
| Available as WMS or WFS | `links_s:(http*wms* OR http*WMS* OR http*Wms*)`, and the same for `wfs` |
| Available as ArcGIS REST | `links_s:` with a regular expression for `…/rest/services/…/(Map\|Image\|Feature)Server` |
| Dates | `<date field>:[from TO to]`, `1900-01-01` and `2100-12-31` for an open end |
| Type Data | `apiso_Type_s:(dataset OR series)` |
| Type Services | `apiso_Type_s:service`, and `apiso_ServiceType_s:(…)` with service types |

Date fields: `apiso_RevisionDate_dt`, `apiso_PublicationDate_dt`, `apiso_CreationDate_dt`, `sys_created_dt`, `apiso_Modified_dt` (the record's last change, the only one besides `sys_created_dt` every record has: 23,883 of 23,883 on 2026-10-09; #48).[^constants]

# Sort

| Label | Value |
|---|---|
| Relevance | none |
| Title A-Z, Z-A | `title:asc`, `title:desc` |
| Metadata date | `apiso_Modified_dt:desc`, `apiso_Modified_dt:asc` |

With Relevance and no text the panel sends `apiso_Modified_dt:desc`: see [Newest first without a text](../decisions/newest-first-without-text.md). The catalogue cannot sort by revision, publication or creation date.

# A record id

A text that is a record id (`<prefix>:<local part>`, no space, quote or bracket) is searched as `fileid:"<id>"`, and the record with exactly that id is opened. `id:` finds nothing in the catalogue; `fileid:` does.

# Differences from the portal's advanced search

The form mirrors the "Ricerca Dettagliata" of geodati.gov.it, with these differences:[^query]

- organisation is a "contains" match on `EnteResponsabile_s`, not the portal's exact, case-sensitive one;
- INSPIRE themes and "open data only" apply to Type All too;
- a date range keeps only the records that have the chosen date.

# Examples

```text
q=(idrografia)&start=1&num=20&f=json
q=(catastale)&bbox=12.95,37.6,14.3,38.3&spatialRel=Intersects&start=1&num=20&f=json
```

The `curl` button of the results copies the exact request of the last search. The pairs of form and query in `tests/fixtures/queries.json` are the test oracle, meant to be shared with openrndt.[^fixtures]

[^query]: Search form to REST query
[^constants]: Option lists of the form
[^fixtures]: Form and expected query, shared with the openrndt CLI
