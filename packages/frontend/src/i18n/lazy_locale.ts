// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lazy per-language locale loading — the single home for "fetch everything this language needs".
// Only the ACTIVE language's chunks are ever downloaded/retained: the ~150-230 KB main translation
// bundle (locales/<lang>.json) AND the ~290-435 KB item-description catalog (catalogs/item_desc.<lang>.json)
// are BOTH code-split and fetched on demand instead of the old "all six statically imported at boot"
// (~1.1 MB main + ~1.6 MB desc parsed and held on the JS heap the moment the tab opened — a big slice of
// the iPhone-Safari full-GC OOM).
//
// EN is the exception: index.ts bundles locales/en.json statically because it is the init fallback the
// runtime needs synchronously, and template_t.ts returns the on-chain/EN template.description directly
// for `en` — so EN needs no lazy chunk at all (its loader is a no-op). That same EN string is also the
// runtime fallback (fallbackLng: 'en') for any key a non-EN bundle hasn't landed yet, so the brief window
// between boot and the async chunk shows EN, then re-renders the moment it lands (index.ts enables
// `react.bindI18nStore: 'added'`, which fires on addResourceBundle).
import i18n from 'i18next'

export const ITEM_DESC_NS = 'item_desc'

type Bundle = { default: Record<string, unknown> }

// Static, Vite-analyzable dynamic imports => one lazy JS chunk per file (no new dep, no backend).
const TRANSLATION: Record<string, () => Promise<Bundle>> = {
  fr: () => import('./locales/fr.json'),
  es: () => import('./locales/es.json'),
  de: () => import('./locales/de.json'),
  uk: () => import('./locales/uk.json'),
  ja: () => import('./locales/ja.json'),
}

const ITEM_DESC: Record<string, () => Promise<Bundle>> = {
  fr: () => import('./catalogs/item_desc.fr.json'),
  de: () => import('./catalogs/item_desc.de.json'),
  es: () => import('./catalogs/item_desc.es.json'),
  ja: () => import('./catalogs/item_desc.ja.json'),
  uk: () => import('./catalogs/item_desc.uk.json'),
}

const loaded = new Set<string>()

/**
 * Load (once) a language's main translation bundle + item-description catalog and register them as
 * i18next resource bundles. No-op for `en`, an already-loaded, or an unknown language. Safe to call on
 * every `languageChanged` and at boot — idempotent and fire-and-forget. On any chunk-load failure the
 * language is un-marked so a later switch can retry a transient failure.
 */
export async function load_locale(lng?: string): Promise<void> {
  const [lang] = (lng || i18n.resolvedLanguage || i18n.language || 'en').split('-')
  if (lang === 'en' || loaded.has(lang) || !TRANSLATION[lang]) return
  loaded.add(lang)
  try {
    const [translation, item_desc] = await Promise.all([TRANSLATION[lang](), ITEM_DESC[lang]?.()])
    // deep=true, overwrite=true: merge into any existing bundle, the loaded strings win.
    i18n.addResourceBundle(lang, 'translation', translation.default, true, true)
    if (item_desc) i18n.addResourceBundle(lang, ITEM_DESC_NS, item_desc.default, true, true)
  } catch {
    loaded.delete(lang) // let a later language switch retry a transient chunk-load failure
  }
}
