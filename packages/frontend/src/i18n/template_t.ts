import { useTranslation } from 'react-i18next'

import { ITEM_DESC_NS } from './lazy_locale'

/**
 * Resolve a template's localized `name`/`description` for the active language.
 *
 * `description` resolution order (non-EN):
 *   1. the lazy item-description catalog (i18next `item_desc` ns, keyed by desc_key ?? id) — the
 *      forward path for chain templates whose Display carries EN only (lazy_locale.ts);
 *   2. the template's inline `i18nJson` blob — the legacy path for bundled/encyclopedia content;
 *   3. the EN `template[field]` (chain Display / seed EN) as the final fallback.
 * `name` keeps the inline-`i18nJson`-then-EN path (no name catalog — descriptions are the bulk).
 */
export function use_template_t() {
  const { i18n } = useTranslation()

  return function template_t(
    template: { name?: string; description?: string; i18nJson?: string; desc_key?: string; id?: string },
    field: 'name' | 'description'
  ): string {
    const lang = i18n.resolvedLanguage || i18n.language?.split('-')[0] || 'en'
    if (lang === 'en') return template[field] || ''

    if (field === 'description') {
      const key = template.desc_key ?? template.id
      // getResource is a raw path lookup (no interpolation) — safe for prose values.
      if (key) {
        const hit = i18n.getResource(lang, ITEM_DESC_NS, key)
        if (typeof hit === 'string' && hit) return hit
      }
    }

    try {
      const i18n_data = JSON.parse(template.i18nJson || '{}')
      const translated = i18n_data[field]?.[lang]
      if (translated) return translated
    } catch {
      /* fallback to english */
    }

    return template[field] || ''
  }
}
