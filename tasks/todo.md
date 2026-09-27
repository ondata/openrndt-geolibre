# Piano - `crs` in `addWmsLayer` (issue #1)

## Contesto (2026-09-27)

- Dopo l'apertura della issue #1 è stata unita opengeos/GeoLibre#2695: il protocollo WMS nativo del desktop ridisegna in Web Mercator anche i CRS proiettati (`EPSG:<n>` qualsiasi, risolto offline). La lista "solo `GEOGRAPHIC_WMS_CRS`" della issue è superata.
- Python (`_normalize_wms_crs` in `project.py`) accetta `EPSG:3857`, i CRS geografici della lista, `CRS:84` (solo con 1.3.0) e qualsiasi `EPSG:\d{4,6}`. La PR si allinea a questo.
- Il CRS vive nell'URL delle tessere, che viene salvato nel progetto; Python non lo scrive in `source`. Nessun codice ricostruisce il GetMap da `source` con un CRS (Cesium usa il suo schema, l'export dei ritagli forza EPSG:4326 1.1.1). Voce "crs in source" tolta.
- La riproiezione c'è solo nel desktop (Tauri). Nel web un `crs` diverso da 3857 dà tessere sbagliate.
- `createWmsTileUrl` usa `appendQuery`, che accoda senza togliere `SRS`/`VERSION` già presenti nell'endpoint (Python invece li toglie). Da verificare se `addWmsLayer` riceve endpoint già ripuliti.
- Il WMS Basilicata oggi non risponde per un problema DNS dell'ente: i name server di `regione.basilicata.it` (78.40.170.22, 78.40.170.36) non rispondono, SERVFAIL anche da dns.google. Non è un difetto del plugin.

## Fase 1 - Issue upstream (da confermare)

- [x] Saltata su richiesta: PR diretta, le domande sono nella PR
- Domande da porre al maintainer: comportamento sul web (warn, errore o solo documentazione), come fa un plugin a sapere se l'host supporta `crs` (oggi nessuna versione esposta; un host vecchio ignora `crs` in silenzio)

## Fase 2 - PR a GeoLibre (branch nuovo da `origin/main` in `~/git/GeoLibre`)

- [x] `normalizeWmsCrs` in `add-data/helpers.ts`, accanto a `normalizeWmsVersion`, che importa `GEOGRAPHIC_WMS_CRS` → verify: test unitari
- [x] `createWmsTileUrl` con `crs?` (default `EPSG:3857`): Add Data dialog invariato → verify: test esistenti verdi
- [x] `addWmsLayer`: destruttura `crs`, valida, errore esplicito per valori non ammessi e per `CRS:84` con 1.1.1 → verify: test
- [x] test: 4326 1.1.1 (`SRS=`), 4326 1.3.0 (`CRS=`), `CRS:84` 1.3.0, 25833, rifiuto `CRS:84` + 1.1.1
- [x] JSDoc di `GeoLibreWmsLayerOptions` e `docs/plugin-api.md` ("solo desktop") → verify: lettura
- [x] `pre-commit run --files ...`, suite frontend, typecheck → verify: tutto verde
- [x] PR in inglese, struttura come #2695

## Fase 3 - Plugin (dopo il merge)

- [ ] ordine di scelta: `EPSG:3857`, poi geografici della lista, poi altri EPSG; `CRS:84` solo con 1.3.0; evitare EPSG:3003 se c'è altro (scarto di circa 70 m, #2695)
- [ ] rilevamento del supporto secondo la risposta del maintainer
- [ ] verifica in GeoLibre Desktop: catasto AdE allineato al WFS, Basilicata quando il DNS torna

## Domande aperte

- issue upstream prima, o PR diretta?
- sul web: errore o solo doc?
- rilevamento supporto `crs` da plugin: come?

## Review

- PR aperta: opengeos/GeoLibre#2701 (branch `feat/plugin-wms-crs` sul fork). Test frontend 10079 ok, typecheck ok, eslint e oxfmt sui file toccati ok (`docs/plugin-api.md` aveva già problemi oxfmt, non toccati). `pre-commit` sul lint dell'intero repo va in out of memory in WSL.
- Non provata in una build desktop.
