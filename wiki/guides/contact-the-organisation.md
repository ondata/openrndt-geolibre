---
type: Guide
title: Write to the organisation
description: From the detail view of a record, copy a ready email to who publishes the data, for any request; and what happens when the record gives no address.
tags: [contact, email, organisation, detail-view]
status: stable
sources:
  - id: panel
    resource: ../../src/rndt/panel.ts
    title: contactEmail, emailText and renderContact
  - id: issue
    resource: https://github.com/ondata/openrndt-geolibre/issues/20
    title: ondata/openrndt-geolibre#20
---

# What it is for

A question on the data, its licence, an update, another format: who publishes a record can be asked, and the record says whom. The panel puts that in sight and prepares the email.[^issue]

# Steps

1. Open a record: its detail view shows the organisation, with **Contact** at the right of its name.
2. **Contact** opens a box under that row:
   - **About**: title and id of the record;
   - **Organisation**: the owner of the resource, or "Not named in the record";
   - **Contact**: the addresses of the point of contact named in the record, which can be another office than the organisation.
3. **Copy email** copies recipients, subject and text to the clipboard: the button reads "Copied: paste it into a new email" for 3 seconds, and the recipients are written beside it. **Show text** shows what is copied.
4. Paste it into a new email of your mail program and write the request where the text says so.

**Close** folds the box. It starts closed at every record.

The email is in Italian, the language of the catalogue. It names the record (title, id, page in the catalogue, organisation) and leaves a place for the request. It goes to the record's contact alone: RNDT is not in copy.[^panel]

It is copied and not opened in a mail program because GeoLibre Desktop opens no `mailto:` link.

# A record with no address

**Contact** is there all the same. The box says "This record gives no email address." and offers **Copy email to RNDT**: an email to `info@rndt.gov.it`, which runs the catalogue, asking whom to write to for that record.[^panel]

# When a service fails

That is another email, about the failure, with RNDT in copy: **Copy error report**, under the error of the service. See [Services that fail](../limits/services-that-fail.md). The two have the same shape and the same addresses.

[^panel]: contactEmail, emailText and renderContact
[^issue]: ondata/openrndt-geolibre#20
