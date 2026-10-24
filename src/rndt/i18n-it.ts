/**
 * The Italian catalogue (#3): short keys, registered with GeoLibre under
 * `plugin.<id>.`. The English text is in the code, next to each `tr(key, …)`.
 * Plurals take `_one` and `_other`. No key may be a prefix of another
 * (`a.b` and `a.b.c`): GeoLibre nests the keys and drops a clash.
 */
export const IT: Record<string, string> = {
  "menu.open": "Apri il pannello di ricerca",
  "menu.footprints": "Nascondi o mostra le impronte",
  "menu.clear": "Cancella risultati e impronte",
  "status.start": "Cerca nel Repertorio Nazionale dei Dati Territoriali (RNDT).",
};
