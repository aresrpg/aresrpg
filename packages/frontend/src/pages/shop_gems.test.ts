import { describe, expect, test } from 'bun:test'

import { gem_variant_label, localized_shop_description, localized_shop_name } from './shop_gems'

const translations: Record<string, string> = {
  'shop.cosmetic_enka_muru_cloak': 'Cape Enka Muru',
  'shop.cosmetic_enka_muru_cloak_description': 'Une cape de voyage.',
  'shop.cosmetic_momaku_cloak': 'Cape Momaku',
  'shop.cosmetic_momaku_cloak_description': 'Une bannière au masque spirituel.',
  'shop.gem_amber': 'Ambre',
  'shop.gem_amethyst': 'Améthyste',
  'shop.gem_emerald': 'Émeraude',
  'shop.gem_rose_quartz': 'Quartz rose',
  'shop.gem_ruby': 'Rubis',
  'shop.gem_sapphire': 'Saphir',
}
const translate = (key: string) => translations[key] ?? key

describe('shop cosmetic naming', () => {
  test('localizes all six canonical Lorito gemstone labels', () => {
    expect(
      ['Emerald', 'Sapphire', 'Ruby', 'Amber', 'Rose Quartz', 'Amethyst'].map((name) =>
        gem_variant_label(name, translate)
      )
    ).toEqual(['Émeraude', 'Saphir', 'Rubis', 'Ambre', 'Quartz rose', 'Améthyste'])
  })

  test('localizes corrected cloak listings and parenthesized variants', () => {
    expect(localized_shop_name('Momaku Mask', translate)).toBe('Cape Momaku')
    expect(localized_shop_name('Momaku Cloak', translate)).toBe('Cape Momaku')
    expect(localized_shop_name('Enka Muru Hood', translate)).toBe('Cape Enka Muru')
    expect(localized_shop_name('Enka Muru Cloak', translate)).toBe('Cape Enka Muru')
    expect(localized_shop_name('Lorito Cloak (Agility)', translate)).toBe('Lorito Cloak (Émeraude)')
    expect(localized_shop_name('Lorito Cloak (Rose Quartz)', translate)).toBe('Lorito Cloak (Quartz rose)')
  })

  test('localizes legacy and corrected back-garment descriptions', () => {
    expect(
      localized_shop_description(
        'A spirit-mask worn to frighten debtors and impress no one who is already dead.',
        translate
      )
    ).toBe('Une bannière au masque spirituel.')
    expect(
      localized_shop_description('A traveller’s cloak stitched for long roads and short conversations.', translate)
    ).toBe('Une cape de voyage.')
  })
})
