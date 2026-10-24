---
type: Reference
title: Language
description: The panel follows GeoLibre's language - Italian when GeoLibre is in Italian, English otherwise; what stays in English and why.
tags: [language, i18n, italian]
status: stable
sources:
  - id: i18n
    resource: ../../src/rndt/i18n.ts
    title: The translation helpers
  - id: catalogue
    resource: ../../src/rndt/i18n-it.ts
    title: The Italian catalogue
  - id: issue
    resource: https://github.com/ondata/openrndt-geolibre/issues/3
    title: Italian UI, follow GeoLibre's language (#3)
---

# What follows the language

From the next release (#3). The panel speaks the language GeoLibre is set to in **Settings > Language**: Italian when GeoLibre is in Italian (`it`, `it-IT`), English in every other language. There is one plugin, not an Italian copy.

In Italian, besides the labels and the messages:

- the INSPIRE themes are shown with their official Italian names, the values the catalogue itself holds;
- numbers are written the Italian way (12.345);
- the items of the RNDT menu in the toolbar follow too.

Switching language with the panel open builds it again: the search shown comes back, run again on the catalogue, with the record that was open. What was typed in the form and not searched yet is lost.

# How

GeoLibre 3.4.0 lets a plugin follow the app language (`getLocale`, `onLocaleChange`, `translate`, `registerTranslations`, see [GeoLibre hooks used](geolibre-hooks.md)). The plugin hands GeoLibre its Italian catalogue once, under keys of its own id (`plugin.openrndt-geolibre.…`), and GeoLibre picks the language for app and plugin alike, so the two never disagree. The English text stays in the code next to each key: it is what a GeoLibre without translations shows. The minimum GeoLibre stays 3.4.0.

# What stays in English

| What | Why |
|---|---|
| The plugin's name in the Plugins menu and in the registry | the name comes from `plugin.json`, and its menu label is a key of GeoLibre's own catalogue: `registerTranslations` takes only keys under `plugin.` |
| The descriptions of the AI Assistant tools and their guidance | they are read by the model, not by the user |
| The names of the link parameters (`rndt`, `rndtTheme`, …) | a shared link must work in every language |
| **Copy for an agent** | Markdown for an AI agent, with the filters in words |
| The warnings in the browser console | they are for developers |

The emails to an organisation or to RNDT (**Contact**, **Copy error report**) are in Italian in every language: they go to Italian public bodies.

# Recent searches

The list of recent searches keeps each search's filters as the chips said them, in the language of that moment. A search saved in one language and run again in the other keeps its area: the plugin reads the area chip in both languages.
