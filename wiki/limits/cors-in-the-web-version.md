---
type: Limit
title: CORS in the web version
description: In GeoLibre web a service whose server sends no CORS headers cannot be read; the same service works in GeoLibre Desktop.
tags: [cors, web, desktop, wms, wfs, arcgis]
status: stable
sources:
  - id: readme
    resource: https://github.com/ondata/openrndt-geolibre/blob/f9c631c/README.md
    title: README before 2026-10-05, "Known limits"
  - id: host
    resource: ../../src/rndt/host.ts
    title: Fetch helpers
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02
---

# The limit

In GeoLibre's web version the browser reads the services itself. A WMS, WFS or ArcGIS server that sends no CORS headers cannot be read there, and the plugin cannot work around it. The same services work in GeoLibre Desktop, which reads them through its native client.[^readme]

# What the panel says

The box of the service shows, for example: "WMS error: wms.cartografia.agenziaentrate.gov.it answers, but a web page cannot read it: the server sends no CORS headers. The service works in GeoLibre Desktop". No error report is offered, since the server is not at fault.

A server that sends two `Access-Control-Allow-Origin` headers is refused by browsers as well, and is reported the same way.[^log]

# ArcGIS images

ArcGIS layers are added as images fetched by the webview, also in Desktop, so the server must send CORS headers: the panel asks one test image first and says so when they are missing.

# The way around

Save the project in the web version and open it in Desktop: see [From the web version to Desktop](../guides/web-to-desktop.md).

[^readme]: README before 2026-10-05, "Known limits"
[^log]: LOG, 2026-10-02
