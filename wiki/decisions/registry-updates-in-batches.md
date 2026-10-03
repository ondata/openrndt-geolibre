---
type: Decision
title: Registry updates in batches
description: Releases of the repository come as they come; the GeoLibre plugin registry gets one pull request when there is enough to send.
tags: [release, registry]
status: stable
decided: 2026-10-02
sources:
  - id: log
    resource: ../../LOG.md
    title: LOG, 2026-10-02 and 2026-10-03
---

# Decision

A release in this repository and an update of the registry are two separate things. Releases here are made when a change is ready. The registry gets a pull request when there is enough, with a higher numeric version each time.[^log]

# Why

Each registry update is a pull request reviewed by the registry's maintainer. Sending one per release asks for a review each time.

# In practice

- A pull request to the registry still open can take a newer version in place of the one it was opened for: opengeos/geolibre-plugins#64 was opened for 0.1.6 and updated to 0.1.7 before any review by the maintainer.
- A release, a push and a pull request are each made on the maintainer's explicit request.
- The version in the registry can therefore be behind the latest release: see [Registry status](../upstream/registry-status.md).

[^log]: LOG, 2026-10-02 and 2026-10-03
