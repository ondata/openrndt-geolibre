# Decisions

* [A link searches anywhere](link-searches-anywhere.md) - A search opened from a link with no box is on the whole catalogue, not on the current map view.
* [A project without a search empties the panel](project-without-search-empties-panel.md) - Opening a project that carries no saved search clears the search on screen, so a search never passes from one project to another.
* [proj4 from GeoLibre](proj4-in-the-bundle.md) - The plugin converts coordinates with GeoLibre's own proj4 (app.getProj4, GeoLibre 3.3.0) and carries no copy; until 0.2.0 it bundled one.
* [Newest first without a text](newest-first-without-text.md) - With no text searched and the sort on Relevance, the panel asks the catalogue for the newest metadata first.
* [Registry updates in batches](registry-updates-in-batches.md) - Releases of the repository come as they come; the GeoLibre plugin registry gets one pull request when there is enough to send.
