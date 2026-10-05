---
type: Limit
title: Services that fail
description: The reasons a service of a record cannot be added, what the panel says for each, and what can be done.
tags: [errors, wms, wfs, arcgis, services]
status: stable
sources:
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "Known limits"
  - id: host
    resource: ../../src/rndt/host.ts
    title: Fetch helpers and checks on the host name
  - id: ideas
    resource: ../../docs/future-ideas.md
    title: Future ideas
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02 and 2026-10-03
---

# By cause

| Cause | What the panel says | What can be done |
|---|---|---|
| The server's name is not in the DNS | "server <name> does not exist: its name is not in the DNS" | nothing: the service is gone; **Copy error report** for the publisher |
| The server sends no CORS headers (web version) | "…answers, but a web page cannot read it: the server sends no CORS headers. The service works in GeoLibre Desktop" | [open the project in Desktop](../guides/web-to-desktop.md) |
| The server does not answer, or answers late | "cannot reach <name>" or a timeout | try again later; servers can be unsteady from one minute to the next |
| A WMS layer is not offered in `EPSG:3857` | with GeoLibre before 3.2.0 the layer is disabled, and the panel says so | GeoLibre Desktop 3.2.0 or later |
| A WMS group layer answers every request with one fixed picture | the layer is disabled | tick its layers instead |
| A WFS has no GeoJSON output | "This WFS offers no GeoJSON output, so the plugin cannot add it. GeoLibre's Add Data > WFS Layer can read GML services: Copy URL above and try it there." | **Copy URL**, then GeoLibre's **Add Data > WFS Layer**, which falls back to GML according to its guide; it does not work for every service, see below; `addWfsLayer` added upstream after 3.2.0 (opengeos/GeoLibre#2826), its use planned in [#28](https://github.com/ondata/openrndt-geolibre/issues/28) |
| An ArcGIS service needs a login | the server's error, for example 499 "Token Required" | none |
| An ArcGIS server draws no test image | "The server did not draw a test image in EPSG:3857." | try again later |
| A record of type service declares no endpoint, only web pages | only "Other links" are listed | none: there is nothing to add |

Whether a name exists is asked, after a failed request only, to Google's public DNS-over-HTTPS resolver (`https://dns.google/resolve`, `nameIsMissing` in `src/rndt/host.ts`): it receives the server's name and nothing else. An unreachable resolver counts as "the name exists".

# The cadastral WFS

The WFS of Agenzia delle Entrate (`wfs.cartografia.agenziaentrate.gov.it`) offers GML only, and GeoLibre's own WFS dialog fails on it too ("The service returned an XML error instead of features"), tried in GeoLibre Desktop 3.2.0 on 2026-10-03. Asked directly on the same day, the service:[^log]

- refuses `OUTPUTFORMAT=application/json` and `application/gml+xml; version=3.2`, and accepts `text/xml; subtype=gml/3.2.1` or no format;
- refuses any `SRSNAME`, and answers in `EPSG:6706`;
- answers one feature when no `BBOX` is given, and the parcels of the area with a small box in latitude, longitude order (39 parcels in a box of about 200 metres).

So it needs a request made for it, limited to a small area. Neither the plugin nor GeoLibre's dialog makes one today. Through GeoLibre's dialog there is also no way to limit the request to the municipality of the record.

# Two cases the panel does not catch

- A WMS that answers with an empty or all-black picture is added as if it worked: the test checks that an image comes back, not what it shows.[^ideas]
- A record whose extent is wrong: see [Footprints](../reference/footprints.md).

# Copy error report

In the box of a failing service, under the error message, when the server is at fault: a button that copies a ready-to-paste email for the record's contact, with RNDT in copy; the recipients are written beside it. It is for the data publisher. For any other request to the publisher: [Write to the organisation](../guides/contact-the-organisation.md). Problems of the plugin go to the [issues](https://github.com/ondata/openrndt-geolibre/issues/new/choose) of the repository.

To keep a list of the failing addresses: [Settings and error log](../reference/settings-and-error-log.md).

[^ideas]: Future ideas
[^log]: LOG, 2026-10-02 and 2026-10-03
