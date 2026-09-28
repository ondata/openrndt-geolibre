# Piano - filtri tematici della Ricerca Dettagliata del portale

## Contesto (2026-09-27, misure su geodati.gov.it, 23.831 record)

Il form del portale ha cinque filtri che il plugin non ha. "Tipo servizio" il plugin lo ha già. Valori e query ricavati dal codice della pagina (`tmp/rd.html`, `tmp/groups.json`); il portale li applica solo con "Dati".

| Filtro del portale | Campo | Record con il campo | Note |
|---|---|---|---|
| Dataset prioritari | `PriorityDataset_s` | 1.055 | Acqua 272 confermato dal portale (screenshot 2026-09-27). 6 gruppi, ognuno una lista di decine di valori (direttive UE): Acqua 272, Aria e rumore 23, Industria 11, Marina 12, Natura e biodiversità 693, Rifiuti 18. "National legislation" (631) non sta in nessun gruppo. Il portale mette "National legislation" nel gruppo Natura e biodiversità: 631 record che hanno solo quel valore, quasi tutti Alto Adige (Provincia di Bolzano 441, Consorzio dei Comuni BZ 83, Protezione civile 64, Merano 39), con titoli come "Numeri civici", "Infrastrutture". Senza quel valore Natura scende da 693 a 62 e il totale da 1.055 a 424. 35 record hanno solo valori fuori dalle liste del portale (varianti e refusi: "Monitoring stations associated to water bodies" 24, "River network (Water Framework Directive)" 20, "Direttiva 2000/60/EC" 14), per lo più Autorità di bacino del Po |
| Dati aperti (temi DCAT) | `OpenDataTheme_s` | 23.831 (tutti) | 9 gruppi, ognuno una lista di temi INSPIRE (it + en): Agricoltura 201, Ambiente 8.951, Economia 10.498, Governo 1.385, Popolazione 264, Regioni e città 11.298, Salute 288, Scienza 2.855, Trasporti 1.135. Il campo contiene anche parole chiave sparse: è una rimappatura dei temi INSPIRE, si sovrappone al filtro INSPIRE theme |
| Dati di elevato valore (HVD) | `DatiElevatoValore_s` | 499, 0 servizi | Dati geospaziali 361, Osservazione della terra e ambiente 138, Meteorologici 0, Mobilità 0 |

Difetto del portale: per "Dati relativi all'osservazione della terra e all'ambiente" manda l'apostrofo dritto `'`, nei dati c'è `’` → 0 risultati invece di 138.

## Fase 1 - Decisioni (da confermare, un filtro alla volta)

- [x] Ambito territoriale: escluso. Campo compilato a discrezione dell'ente: dei 2.270 record dei Comuni 1.994 non lo hanno, 248 dicono "Regionale" e solo 28 "Locale"; 25 record delle Regioni sono "Locale"; "Regionale" copre il 92% dei valori. Per ente si usa Organisation
- [x] Categoria ISO: esclusa. Compilata sul 99,5% dei dati, lista chiusa di 19 codici, ma ripete INSPIRE theme (20.660 record) con una griglia più grossa e in inglese tecnico; `planningCadastre` (11.714) è per 7.694 il catasto dell'Agenzia delle Entrate; legame con i temi INSPIRE debole (Idrografia: 564 inlandWaters, 232 planningCadastre)
- [x] Dataset prioritari: rinviati. Valori sporchi ("National legislation" nel gruppo Natura, 35 record fuori dalle liste): misure nella tabella sopra, per quando si riprende
- [ ] quali filtri aggiungere (proposta: HVD; "Dati aperti" no, perché ripete INSPIRE theme con gruppi larghi)
- [ ] con "Services" ignorati, come INSPIRE theme e Open data only
- [ ] selezione singola (come INSPIRE theme oggi) o multipla
- [ ] HVD: mandare entrambe le forme dell'apostrofo; nascondere o no le due voci a 0

## Fase 2 - Query

- [ ] campi nuovi in `SearchForm`, clausole in `buildQuery` (gruppi espansi in OR di valori tra virgolette) → verify: fixture in `tests/fixtures/queries.json`, `npm test`
- [ ] gruppi e liste in `constants.ts`, etichette in inglese come il resto del pannello → verify: typecheck

## Fase 3 - Pannello

- [ ] select nel pannello, nascoste con "Services", con "?" nello schema di `WHERE_HELP` → verify: test UI, prova in GeoLibre Desktop
- [ ] conteggi dal vivo per ogni filtro contro le misure qui sopra → verify: stessi numeri

## Fase 4 - Chiusura

- [ ] LOG.md, README se elenca i filtri; nota sull'apostrofo HVD in openrndt `knowledge/api/known-issues.md` → verify: lettura

## Domande aperte

- "Dati aperti" dentro o fuori?
- singola o multipla?
- prima si chiude il lavoro in corso (help dei filtri, Date), poi questo?

---

# Piano - help "?" per tutti i filtri e revisione del filtro Date

## Contesto (2026-09-27, misure su geodati.gov.it, 23.831 record)

- Oggi hanno un "?" solo i modi di ricerca, "Search in" e "Where". Mancano: Resources, INSPIRE theme, Keywords, Organisation, Open data only, Date, Sort by.
- Date: con la casella "Include records without this date" spuntata (default) il filtro filtra poco. Revision dal 2024: 6.517 record con la data, ma la casella aggiunge i 10.480 senza revisione, 17.000 risultati su 23.831. Senza data: Revision 10.480, Publication 15.338, Creation 13.536.
- La casella non ha effetto se non si scrive almeno una data.
- Le tre date sono date della risorsa (creazione, pubblicazione, revisione). "Sort by" ordina invece per data del metadato (`apiso_Modified_dt`, presente in tutti i record): due date diverse, da dire.
- Keywords: corrispondenza esatta e sensibile alle maiuscole. `opendata` 2.742, `OpenData` 8; `Idrografia` 976, `idrografia` 117.
- INSPIRE theme e Open data only si applicano a All e Data, sono ignorati con Services: nessun servizio ha un tema (0) né il flag open data (0).
- Organisation: "contiene", senza maiuscole, sul responsabile della risorsa (`EnteResponsabile_s`), non sul contatto dei metadati.
- Resources: Data = dataset e serie (20.667), Services = servizi (3.164).

## Fase 1 - Filtro Date

Misure aggiuntive (2026-09-27): nessun record è privo di tutte e tre le date (0). 17.363 record su 23.831 (73%) ne hanno una sola: solo revisione 9.313, solo creazione 4.725, solo pubblicazione 3.325; tutte e tre 1.840. Il default del portale "Considera valori vuoti" compensa questo: un filtro stretto su Revision perde i record datati solo con creazione o pubblicazione. Con "qualsiasi delle tre date" dal 2024: 7.938 (contro 6.517 su Revision stretta e circa 17.000 con la casella).

- [x] decisione: togliere la casella "Include records without this date" (filtro stretto quando c'è una data)
- [x] decisione: niente "Any date", restano le tre date distinte
- [ ] nota piccola, sempre visibile, sopra la select: molti record non hanno la data scelta → verify: prova in GeoLibre Desktop
- [ ] togliere `includeMissingDates` da form, query e fixture → verify: `npm test`
- [ ] help "?" della legenda Date: cosa sono le tre date, che quasi tutti i record ne hanno una sola, differenza con la data del metadato del Sort → verify: lettura

## Fase 2 - Help degli altri filtri

- [ ] Resources: cosa sono Data e Services; con Services tema e open data sono ignorati
- [ ] INSPIRE theme: ignorato con Services
- [ ] Keywords: esatte e sensibili alle maiuscole, con esempi cliccabili `opendata` / `OpenData`
- [ ] Organisation: contiene, senza maiuscole, ente responsabile; si può cliccare il nome di un ente nei risultati
- [ ] Open data only: tiene i record in cui l'ente ha compilato il campo open data (`isOpendata`, 16.792). Valore libero e non controllato: licenze (CC BY 4.0 535 su un campione di 1000), il solo marcatore "open data"/"opendata" (404 su 1000), anche licenze non commerciali (286 con NC, non open data in senso stretto). Perde 1.367 record senza il campo ma con licenza CC dichiarata altrove. Ignorato con Services
- [ ] Sort by: Relevance e data del metadato
- stesso schema di `WHERE_HELP` (costante + `helpToggle`) → verify: `npm test`, typecheck, prova in GeoLibre Desktop

## Fase 4 - Relazione spaziale (fatta)

- `spatialRel=Within` supportato dal REST: box di Palermo 94 record contro 878 di Intersects; `Contains` 706 (i nazionali)
- [x] scelta in "Where" tra "touches the area" (Intersects, default) e "inside the area" (Within) → verify: test `buildQuery`, conteggi dal vivo

## Fase 5 - Escludere enti (fatta)

- [x] casella "Invert" sotto Organisation (più enti con la virgola), al posto di un secondo campo → verify: fixture `buildQuery`, test dal vivo (Messina 72 → 2, `ispra, torino` 517)
- [x] pulsante "Hide" sul nome dell'ente nei risultati → verify: test UI
- [x] esempio NOT nell'help Lucene → verify: conteggio dal vivo 8.133 → 436

## Fase 6 - Record type e Available as (fatta)

- [x] verifica su campione: filtro `links_s` contro badge del plugin → 99% concordi su 2.400 record
- [x] "Resources" → "Record type", help con la differenza tipo/link
- [x] "Available as" WMS/WFS → verify: fixture, test UI, test dal vivo (`idrografia` 586)
- [ ] ArcGIS REST in "Available as" quando il plugin saprà aprirlo

## Fase 3 - Chiusura

- [ ] LOG.md, README se descrive i filtri → verify: lettura

## Domande aperte

- decisi: casella tolta; un "?" per ogni campo; `isOpendata` verificato

---

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

Stato 2026-09-28: #2701, #2702 e #2707 unite, non ancora in release (ultima 3.1.0). Il maintainer non ha risposto sul rilevamento del supporto. Proposta: `typeof app.importLayerStyle === "function"` come segnale per entrambe (unite a un minuto di distanza); con host vecchio il pulsante resta disattivato come oggi.

- [ ] `crs?` in `WmsLayerOptions` (`host.ts`), `importLayerStyle?` nel tipo dell'app → verify: typecheck
- [ ] stessa regola di `defaultWmsCrs` di #2707 (3857, poi geografici, poi primo EPSG), così plugin e dialog nativo scelgono lo stesso CRS → verify: test unitari
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

---

# Piano - stile SLD dei WFS (issue #10)

Sbloccata da opengeos/GeoLibre#2702 (`importLayerStyle(layerId, text)`, SLD/QML/Mapbox GL), unita il 2026-09-27, non ancora in release.

## Fase 1 - Plugin

- [ ] dopo `addGeoJsonLayer`, WMS `GetStyles` sullo stesso GeoServer (`layers=<nome>`) → verify: test con fixture SLD Liguria `M5:L4`
- [ ] passare il testo a `importLayerStyle`; se manca l'API, o GetStyles fallisce, o l'esito è `unsupported-layer`, resta lo stile di default senza errore → verify: test UI
- [ ] prova in GeoLibre Desktop (build da `main`): Liguria `M5:L4`, 33 classi su `classe` → verify: screenshot

## Domande aperte

- GetStyles sempre, o solo se il capabilities WMS dello stesso host ha il layer?
- `minZoom: 12` dalla SLD: tenerlo (il layer sparisce a scala piccola) o toglierlo?
