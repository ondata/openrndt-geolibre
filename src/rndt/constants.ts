/** Plugin id; must match `geolibre-plugin/plugin.json`. */
export const PLUGIN_ID = "openrndt-geolibre";
export const PLUGIN_NAME = "RNDT catalogue";
export const PLUGIN_VERSION = "0.1.0-alpha.6";

/** Right-panel id, unique across plugins. */
export const PANEL_ID = "openrndt-geolibre-search";

/** RNDT REST base URL (same default as the openrndt CLI). */
export const RNDT_BASE_URL = "https://geodati.gov.it/RNDT";

/** Results per page. */
export const PAGE_SIZE = 20;

/**
 * Features a WFS download takes without asking. Above it the panel asks the
 * user whether to download them all (slow, memory) or only this many.
 */
export const WFS_MAX_FEATURES = 10000;

export interface Option {
  value: string;
  label: string;
}

/**
 * INSPIRE themes. `value` is the Italian label stored in `INSPIRETheme_s`
 * (case- and accent-sensitive), `label` the English name shown in the panel.
 * All 34 values verified against the live catalogue on 2026-09-26.
 */
export const INSPIRE_THEMES: Option[] = [
  { value: "Indirizzi", label: "Addresses" },
  { value: "Unità amministrative", label: "Administrative units" },
  { value: "Impianti agricoli e di acquacoltura", label: "Agricultural and aquaculture facilities" },
  {
    value: "Zone sottoposte a gestione/limitazioni/regolamentazione e unità con obbligo di comunicare dati",
    label: "Area management/restriction/regulation zones and reporting units",
  },
  { value: "Condizioni atmosferiche", label: "Atmospheric conditions" },
  { value: "Regioni biogeografiche", label: "Bio-geographical regions" },
  { value: "Edifici", label: "Buildings" },
  { value: "Parcelle catastali", label: "Cadastral parcels" },
  { value: "Sistemi di coordinate", label: "Coordinate reference systems" },
  { value: "Elevazione", label: "Elevation" },
  { value: "Risorse energetiche", label: "Energy resources" },
  { value: "Impianti di monitoraggio ambientale", label: "Environmental monitoring facilities" },
  { value: "Sistemi di griglie geografiche", label: "Geographical grid systems" },
  { value: "Nomi geografici", label: "Geographical names" },
  { value: "Geologia", label: "Geology" },
  { value: "Habitat e biotopi", label: "Habitats and biotopes" },
  { value: "Salute umana e sicurezza", label: "Human health and safety" },
  { value: "Idrografia", label: "Hydrography" },
  { value: "Copertura del suolo", label: "Land cover" },
  { value: "Utilizzo del territorio", label: "Land use" },
  { value: "Elementi geografici meteorologici", label: "Meteorological geographical features" },
  { value: "Risorse minerarie", label: "Mineral resources" },
  { value: "Zone a rischio naturale", label: "Natural risk zones" },
  { value: "Elementi geografici oceanografici", label: "Oceanographic geographical features" },
  { value: "Orto immagini", label: "Orthoimagery" },
  { value: "Distribuzione della popolazione — demografia", label: "Population distribution - demography" },
  { value: "Produzione e impianti industriali", label: "Production and industrial facilities" },
  { value: "Siti protetti", label: "Protected sites" },
  { value: "Regioni marine", label: "Sea regions" },
  { value: "Suolo", label: "Soil" },
  { value: "Distribuzione delle specie", label: "Species distribution" },
  { value: "Unità statistiche", label: "Statistical units" },
  { value: "Reti di trasporto", label: "Transport networks" },
  { value: "Servizi di pubblica utilità e servizi amministrativi", label: "Utility and governmental services" },
];

/** INSPIRE spatial data service types (`apiso_ServiceType_s`). */
export const SERVICE_TYPES: Option[] = [
  { value: "view", label: "View (WMS, WMTS)" },
  { value: "download", label: "Download (WFS, ATOM)" },
  { value: "discovery", label: "Discovery (CSW)" },
  { value: "transformation", label: "Transformation" },
  { value: "invoke", label: "Invoke" },
  { value: "other", label: "Other" },
];

/** Fields the free text can be restricted to ("Ricerca tra" on the portal). */
export const SEARCH_FIELDS: Option[] = [
  { value: "", label: "Anywhere" },
  { value: "title", label: "Title" },
  { value: "description", label: "Abstract" },
  { value: "apiso_Lineage_txt", label: "Lineage" },
  { value: "apiso_AccessConstraints_s", label: "Use limitation" },
];

export const DATE_FIELDS: Option[] = [
  { value: "apiso_RevisionDate_dt", label: "Revision" },
  { value: "apiso_PublicationDate_dt", label: "Publication" },
  { value: "apiso_CreationDate_dt", label: "Creation" },
  { value: "sys_created_dt", label: "Added to catalogue" },
];

export const SORT_OPTIONS: Option[] = [
  { value: "", label: "Relevance" },
  { value: "title:asc", label: "Title A-Z" },
  { value: "title:desc", label: "Title Z-A" },
  { value: "apiso_Modified_dt:desc", label: "Metadata date, newest first" },
  { value: "apiso_Modified_dt:asc", label: "Metadata date, oldest first" },
];
