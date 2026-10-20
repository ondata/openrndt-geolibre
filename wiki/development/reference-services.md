---
type: Guide
title: Reference services for tests
description: Which service to try each case of the plugin against - WMS, small and large WFS, ArcGIS, no CORS, GML only, failures - with ready GeoLibre web links, and how to re-check them.
tags: [development, tests, services, cors]
status: stable
sources:
  - id: fixture
    resource: ../../tests/fixtures/reference-services.json
    title: the reference services
  - id: live
    resource: ../../tests/live.test.ts
    title: live reference services (#60)
  - id: issue
    resource: https://github.com/ondata/openrndt-geolibre/issues/60
    title: "#60, the search and the measures"
---

# What it is

A fixed set of services and failures to try the plugin against ([#60](https://github.com/ondata/openrndt-geolibre/issues/60)), in [`tests/fixtures/reference-services.json`](../../tests/fixtures/reference-services.json): two per kind of try where two were found, on different servers where possible, so a try does not depend on one host or on a server that happens to be down. Use them for tries by hand, headless tries and tries through the [AI Assistant](../guides/ai-assistant.md), instead of picking a service on the spot.

Each entry was checked on 2026-10-20 with the request the web version makes (`Origin: https://web.geolibre.app`): what came back (a tile with drawn pixels, real GeoJSON features) and the `Access-Control-Allow-Origin` header. Two kinds have one reference only: no second WMS that refuses EPSG:3857 was found (GeoServer and ArcGIS reproject; six candidates all drew), and HTTP only is a single case.

# Re-check

```sh
RUN_LIVE_TESTS=1 npx vitest --run tests/live.test.ts
```

The "live reference services (#60)" tests repeat the checks for every entry and name the one that stopped working; `tests/reference-services.test.ts` checks the file itself in every run (every kind covered, counts, CORS as the kind needs). When an entry fails for good, replace it with a measured one and update its `checked` date.

# Services and links

"Record" opens the record in GeoLibre web; "with its layer" also puts the layer on the map (`rndtLayer`, see [URL parameters](../reference/url-parameters.md)). Desktop-only cases have no layer link: open the record in GeoLibre Desktop.

| Try | Reference | Layer | GeoLibre web |
|---|---|---|---|
| WMS with CORS | Alberi monumentali - WMS (Regione Lombardia) (`lombardia-trees-wms`) | Alberi_monumentali9931 | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=r_lombar%3Aec6587b6-3ff4-481a-94bf-ec9ffdd3224d), [with its layer](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=r_lombar%3Aec6587b6-3ff4-481a-94bf-ec9ffdd3224d&rndtLayer=r_lombar%3Aec6587b6-3ff4-481a-94bf-ec9ffdd3224d~wms~Alberi_monumentali9931) |
| WMS with CORS | Genova - Catasto 1810 (`genova-1810-wms`) | V_CATASTO_1810 | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=c_d969%3Aae919f85-9d02-4337-ae33-85376c905d5e), [with its layer](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=c_d969%3Aae919f85-9d02-4337-ae33-85376c905d5e&rndtLayer=c_d969%3Aae919f85-9d02-4337-ae33-85376c905d5e~wms~V_CATASTO_1810) |
| WMS with CORS | AGEA 2020 RGB (Regione Emilia-Romagna) (`agea-2020-rgb-wms`) | Agea2020_RGB | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=r_emiro%3A2022-03-11T113115), [with its layer](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=r_emiro%3A2022-03-11T113115&rndtLayer=r_emiro%3A2022-03-11T113115~wms~Agea2020_RGB) |
| small WFS (GeoJSON, CORS) | Palazzi inclusi nel riconoscimento UNESCO di Genova (`genova-unesco-wfs`) | SITGEO:V_UNESCO_GEOPORT, 140 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=c_d969%3A6dcfeade-8c22-4f6f-beba-3140c7d982be) |
| small WFS (GeoJSON, CORS) | Stazioni idrometriche (Agenzia per la Protezione civile, Bolzano) (`bolzano-gauging-wfs`) | p_bz-Hydrology:GaugingStations, 55 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=assapcbz%3AHydrology%3AGaugingStations) |
| WFS above 10,000 features | Genova - Catasto 1810 (`genova-1810-wfs`) | SITGEO:V_CATASTO_1810, 23,979 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=c_d969%3Aae919f85-9d02-4337-ae33-85376c905d5e) |
| WFS above 10,000 features | Catasto: punti fiduciali (Bolzano) (`bolzano-fixpoints-wfs`) | p_bz-Cadastre:FixPoints, 13,020 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=p_bz%3ACadastre%3AFixPoints) |
| ArcGIS images | Milano 1910, carta tecnica (Comune di Milano) (`milano-1910-arcgis`) | - | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=C_F205%3ASIT_CENTRALE_M191081001%3A20161013), [with its layer](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=C_F205%3ASIT_CENTRALE_M191081001%3A20161013&rndtLayer=C_F205%3ASIT_CENTRALE_M191081001%3A20161013~arcgis~0) |
| ArcGIS images | Bacini idrografici (ARPA Piemonte) (`piemonte-basins-arcgis`) | 0, 27 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=arlpa_to%3A12.01.01-D_2011-06-21-11%3A30), [with its layer](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=arlpa_to%3A12.01.01-D_2011-06-21-11%3A30&rndtLayer=arlpa_to%3A12.01.01-D_2011-06-21-11%3A30~arcgis~0) |
| ArcGIS images | Depuratori della Regione Emilia-Romagna - edizione 2025 (ARPAE) (`arpae-pressures-arcgis`) | 0 | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=arpa%3A2026-06-09T102216), [with its layer](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=arpa%3A2026-06-09T102216&rndtLayer=arpa%3A2026-06-09T102216~arcgis~0) |
| ArcGIS features | Bacini idrografici (ARPA Piemonte) (`piemonte-basins-arcgis`) | 0, 27 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=arlpa_to%3A12.01.01-D_2011-06-21-11%3A30) |
| ArcGIS features | Depuratori della Regione Emilia-Romagna - edizione 2025 (ARPAE) (`arpae-pressures-arcgis`) | 0 | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=arpa%3A2026-06-09T102216) |
| no CORS (Desktop only) | PPR - Zone di interesse archeologico (Regione FVG) (`fvg-ppr-wfs`) | PPR:v_beni_culturali, 3,279 features | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=r_friuve%3Am10718-cc-i10973) |
| no CORS (Desktop only) | Cartografia catastale - Comune di MILANO (Agenzia delle Entrate) (`ade-cadastre-wms`) | Cartografia_Catastale | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=age%3AD_F205_MILANO) |
| no CORS (Desktop only) | Cartografia catastale - Comune di MILANO (Agenzia delle Entrate) (`ade-cadastre-wfs`) | - | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=age%3AD_F205_MILANO) |
| WMS not drawn in EPSG:3857 (Desktop only) | Cartografia catastale - Comune di MILANO (Agenzia delle Entrate) (`ade-cadastre-wms`) | Cartografia_Catastale | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=age%3AD_F205_MILANO) |
| WFS with GML only | Cartografia catastale - Comune di MILANO (Agenzia delle Entrate) (`ade-cadastre-wfs`) | - | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=age%3AD_F205_MILANO) |
| WFS with GML only | Microzone Censuarie (Comune di Torino) (`torino-microzones-wfs`) | Microzone | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=c_l219%3Acbd02575-de8e-4a76-a35d-c0ae48cbfc9a) |
| HTTP only | Corine Land Cover 2006 (Geoportale Nazionale) (`pcn-corine-wms`) | CS.CLC2006 | [record](https://web.geolibre.app/?plugin=openrndt-geolibre&rndt=m_amte%3A299FN3%3A79cbfd04-955b-4f8c-9de1-65a44ff0bdd9) |
| host missing | `https://geoportale.comune.milano.it/` (`milano-geoportal-dns`) | No DNS address since 2026-09-27; 228 records point to it. | - |
| host missing | `https://rndt-test.invalid/` (`invalid-tld`) | .invalid never resolves (RFC 6761); a browser fails in about 1 s. | - |
| never answers | `https://10.255.255.1/` (`unrouted-private`) | Still pending at 20 s in a browser on web.geolibre.app. | - |
| never answers | `https://192.0.2.1/` (`test-net-1`) | TEST-NET-1 (RFC 5737); still pending at 20 s in a browser on web.geolibre.app. | - |

Tried on 2026-10-20 on web.geolibre.app, headless: the Lombardy trees link and the ARPA Piemonte basins link each gave "Added 1 of 1 layer of the link.", Diagnostics 0.
