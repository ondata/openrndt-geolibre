---
type: Decision
title: A link searches anywhere
description: A search opened from a link with no box is on the whole catalogue, not on the current map view.
tags: [link, url-parameters, area]
status: stable
decided: 2026-10-03
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-03
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: searchFromLink
---

# Decision

A link with `?rndt=<text>` and no `rndtBbox` sets the area to **Anywhere**. The form's own default, "Current map view", is not used for links.

# Why

- The same link finds the same records for everyone, whatever their window and map.
- When GeoLibre opens, the view is still the whole globe: a search "in the view" would be a search anywhere in practice, but would say otherwise.

# Consequences

- After a link, the form shows Where: Anywhere, and a search typed afterwards keeps that area until it is changed.
- To limit a link to an area, add `rndtBbox`: see [URL parameters](../reference/url-parameters.md).

Decided by the maintainer of the plugin on 2026-10-03.[^log]

[^log]: LOG, 2026-10-03
