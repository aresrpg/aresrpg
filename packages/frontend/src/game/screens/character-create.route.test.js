// PAID-vs-FREE create routing + price-copy proofs (the second zkLogin character costs 10 SUI — swap free
// for paid and label the button accordingly). `is_paid_create` is THE single home
// both the creator's price button and the hosts' PTB route (free create_character vs paid
// create_character_paid) read — these pin the routing matrix and the rendered price / insufficient-funds
// copy. Imports the REAL module (loads clean under DOM-less bun:test — the colors test proved the chain);
// locale strings assert through standalone i18next instances (the reveal_strings idiom — no detector).
import { describe, expect, test } from 'bun:test'
import { createInstance } from 'i18next'

import app_i18n from '../../i18n'
import en from '../../i18n/locales/en.json'
import fr from '../../i18n/locales/fr.json'
import ja from '../../i18n/locales/ja.json'

import {
  is_paid_create,
  insufficient_funds_copy,
  ADDITIONAL_CHARACTER_PRICE_SUI,
} from './character-create.js'

const inst = (lng, resources) => {
  const i = createInstance()
  i.init({ lng, fallbackLng: 'en', resources, interpolation: { escapeValue: false } })
  return i
}
const EN = inst('en', { en: { translation: en } })
const FR = inst('fr', { fr: { translation: fr } })
const JA = inst('ja', { ja: { translation: ja } })

describe('is_paid_create — the ONE free-vs-paid route (button copy AND submitted PTB read it)', () => {
  test('FIRST character (roster 0, free slot unclaimed) → FREE route', () => {
    expect(is_paid_create({ character_count: 0, claimed_free: false })).toBe(false)
  })

  test('roster ≥1 → PAID route (the second zkLogin character costs 10 SUI)', () => {
    expect(is_paid_create({ character_count: 1, claimed_free: false })).toBe(true)
    expect(is_paid_create({ character_count: 1, claimed_free: true })).toBe(true)
    expect(is_paid_create({ character_count: 5, claimed_free: true })).toBe(true)
  })

  test('claimed-then-emptied account (count 0, claim burned on-chain) stays PAID — the C2 trap', () => {
    expect(is_paid_create({ character_count: 0, claimed_free: true })).toBe(true)
  })
})

describe('the price is WRITTEN ON THE BUTTON (characters.create.create_paid) — design ruling 2026-07-11', () => {
  test('en / fr / ja render the live price on the confirm label', () => {
    expect(EN.t('characters.create.create_paid', { price: 10 })).toBe('Create · 10 SUI →')
    expect(FR.t('characters.create.create_paid', { price: 10 })).toBe('Créer · 10 SUI →')
    expect(JA.t('characters.create.create_paid', { price: 10 })).toBe('作成 · 10 SUI →')
  })
})

describe('insufficient_funds_copy — the honest broke line (price + live balance, never a raw throw)', () => {
  test('renders price + 3-decimal balance through the REAL app i18n instance (en)', async () => {
    await app_i18n.changeLanguage('en')
    expect(insufficient_funds_copy({ price_sui: 10, balance_sui: 0.0512 })).toBe(
      'Not enough SUI — this character costs 10 SUI, you have 0.051.'
    )
  })

  test('a 0-SUI wallet reads an honest "needs 10 SUI · balance 0" (null balance never NaN/blank)', async () => {
    await app_i18n.changeLanguage('en')
    expect(insufficient_funds_copy({ price_sui: 10, balance_sui: 0 })).toBe(
      'Not enough SUI — this character costs 10 SUI, you have 0.'
    )
    expect(insufficient_funds_copy({ price_sui: 10, balance_sui: null })).toBe(
      'Not enough SUI — this character costs 10 SUI, you have 0.'
    )
  })

  test('the key localizes (fr / ja, same interpolation slots)', () => {
    expect(FR.t('characters.create.insufficient_funds', { price: 10, balance: '2.5' })).toBe(
      'Pas assez de SUI — ce personnage coûte 10 SUI, tu as 2.5.'
    )
    expect(JA.t('characters.create.insufficient_funds', { price: 10, balance: '2.5' })).toBe(
      'SUIが足りません — このキャラクターは10 SUI、所持額は2.5です。'
    )
  })
})

test('the client price mirror stays 10 (display fallback only — the gate price is authoritative)', () => {
  expect(ADDITIONAL_CHARACTER_PRICE_SUI).toBe(10)
})
