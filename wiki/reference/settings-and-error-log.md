---
type: Reference
title: Settings and error log
description: The one setting of the panel, the log of failing service URLs, and where they are stored.
tags: [settings, error-log, storage]
status: stable
sources:
  - id: settings
    resource: ../../src/rndt/settings.ts
    title: Settings and error log
  - id: readme
    resource: ../../README.md
    title: README, "What it does"
---

# Settings

Opened from **Settings** (⚙) in the footer of the panel.

| Setting | Default | Effect |
|---|---|---|
| Log the service URLs that fail | off | each failing service is added to the error log |

# Error log

One entry per failing service:

| Field | Content |
|---|---|
| `time` | ISO 8601, UTC |
| `recordId`, `recordTitle`, `organisation` | the record the service belongs to |
| `serviceKind` | the kind of service |
| `url` | the address that failed |
| `error` | the message |

The log keeps the last 1,000 entries and can be exported as JSON Lines.

# Where they are stored

In the storage of the webview (`localStorage`), under the keys `openrndt-geolibre:settings` and `openrndt-geolibre:error-log`: per user and per computer, never in the project and never sent anywhere. Without storage the panel works the same, and a setting lasts for the session.[^settings]

# Not to be confused with

**Copy error report**, in the box of a failing service: it prepares an email for the record's contact, with RNDT in copy, about a broken service. It is copied to the clipboard, because GeoLibre Desktop opens no `mailto:` link from a plugin.[^readme]

[^settings]: Settings and error log
[^readme]: README, "What it does"
