# Update Log

## 2026-10-05
* **Update**: [Registry status](upstream/registry-status.md): 0.3.2 is in the registry (opengeos/geolibre-plugins#94); [Footprints](reference/footprints.md): from 0.3.2.
* **Update**: [Requests to GeoLibre](upstream/geolibre-requests.md): #2951, `maxFeatures` on `addWfsLayer`.
* **Update**: [Footprints](reference/footprints.md): they stand down while Identify is on (#38).
* **Update**: [Requests to GeoLibre](upstream/geolibre-requests.md): #2944 closed by #2946; #2949 opened.
* **Update**: [Registry status](upstream/registry-status.md): 0.3.1 is in the registry (opengeos/geolibre-plugins#93).
* **Update**: [Services that fail](limits/services-that-fail.md): the DNS check goes to `dns.google`, said in the README too.
* **Update**: [Registry status](upstream/registry-status.md): 0.3.1 in opengeos/geolibre-plugins#93.
* **Update**: [Release](development/release.md): the zip carries a minified bundle and the catalog screenshots (0.3.1).
* **Update**: [Add layers to the map](guides/add-layers.md), [GeoLibre hooks used](reference/geolibre-hooks.md): provenance metadata on WMS and ArcGIS image layers (#36).
* **Update**: [proj4 from GeoLibre](decisions/proj4-in-the-bundle.md) (was "proj4 in the bundle"), [Coordinate systems converted](reference/coordinate-systems.md), [GeoLibre hooks used](reference/geolibre-hooks.md): the plugin uses `app.getProj4()` (#29).
* **Update**: [Requests to GeoLibre](upstream/geolibre-requests.md), [Strip credentials](limits/strip-credentials.md): #2944, the Elevation Profile's default state counted as 4 credentials.
* **Update**: [Add layers to the map](guides/add-layers.md), [GeoLibre hooks used](reference/geolibre-hooks.md): layers marked not queryable are added as such (#32).
* **Update**: [An update needs a reinstall](limits/update-needs-reinstall.md), [Install the plugin](guides/install.md): GeoLibre 3.3.0 offers Update, tried in Desktop.
* **Update**: [Strip credentials](limits/strip-credentials.md): with GeoLibre 3.3.0 the registry copy keeps its search, tried in Desktop (#27 closed).
* **Update**: [GeoLibre hooks used](reference/geolibre-hooks.md), [overview](overview.md), [Install the plugin](guides/install.md), [Add layers to the map](guides/add-layers.md): minimum GeoLibre 3.3.0 (#35); hooks checked at `v3.3.0`, with the 3.3.0 calls not used yet.

## 2026-10-04
* **Update**: [Requests to GeoLibre](upstream/geolibre-requests.md): #2886, #2887, #2888 closed by #2889, #2890, #2896, merged; #32 opened for `queryable: false`.
* **Update**: [Registry status](upstream/registry-status.md): 0.2.0 is in the registry (opengeos/geolibre-plugins#78); [URL parameters](reference/url-parameters.md), [Share a search](guides/share-a-search.md) and the README name 0.2.0.
* **Update**: [URL parameters](reference/url-parameters.md): a parameter for every field of the form, a link starts from an empty form (#30). [Share a search](guides/share-a-search.md): Share, through the system share sheet (#31).
* **Update**: [URL parameters](reference/url-parameters.md), [Share a search](guides/share-a-search.md), [Requests to GeoLibre](upstream/geolibre-requests.md): `?plugin=openrndt-geolibre` tried on web.geolibre.app, the plugin never opens in `layout=viewer` (#2898).
* **Update**: [Requests to GeoLibre](upstream/geolibre-requests.md): #2855, the source of a WMS layer in its Metadata dialog.
* **Update**: [Requests to GeoLibre](upstream/geolibre-requests.md): all seven closed by merged pull requests, none released yet; #2840 added. [An update needs a reinstall](limits/update-needs-reinstall.md), [Strip credentials](limits/strip-credentials.md), [Project file names](limits/project-file-names.md), [Services that fail](limits/services-that-fail.md), [proj4 in the bundle](decisions/proj4-in-the-bundle.md), [GeoLibre hooks used](reference/geolibre-hooks.md) and the README say what changes after GeoLibre 3.2.0.

## 2026-10-03
* **Update**: [Registry status](upstream/registry-status.md): 0.1.9 is in the registry.
* **Update**: [Search the catalogue](guides/search.md) and [Settings and error log](reference/settings-and-error-log.md): recent searches (#25).
* **Update**: [Share a search](guides/share-a-search.md): Copy for an agent (#23).
* **Creation**: [Write to the organisation](guides/contact-the-organisation.md) (#20); [Services that fail](limits/services-that-fail.md) for the new shape of the error report.
* **Update**: [The two copies of the plugin](development/two-copies.md): the development copy has its own CSS prefix, and why.
* **Update**: [Search the catalogue](guides/search.md) for the panel refinements of #19: Filters link, no results, the fixed way back and the cut abstract in the detail view.
* **Creation**: [An update needs a reinstall](limits/update-needs-reinstall.md), with [Install the plugin](guides/install.md) and [Requests to GeoLibre](upstream/geolibre-requests.md) (opengeos/GeoLibre#2833).
* **Creation**: [The two copies of the plugin](development/two-copies.md): the plugin from the registry and the development copy, with its own id, in one GeoLibre.
* **Update**: [Installing in GeoLibre Desktop](development/installing-in-desktop.md) and [Build and test](development/build-and-test.md) point to it.
* **Update**: [Registry status](upstream/registry-status.md): 0.1.7 is in the registry.
* **Update**: [Services that fail](limits/services-that-fail.md), [Add layers to the map](guides/add-layers.md), [GeoLibre hooks used](reference/geolibre-hooks.md) and [Requests to GeoLibre](upstream/geolibre-requests.md) for the WFS without GeoJSON output: the new message of the panel and the request of an `addWfsLayer` (opengeos/GeoLibre#2823).
* **Initialization**: Created the bundle for plugin version 0.1.7, with [overview](overview.md), [guides](guides/), [reference](reference/), [limits](limits/), [decisions](decisions/), [development](development/) and [upstream](upstream/).
