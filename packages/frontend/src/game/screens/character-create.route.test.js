// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PAID-vs-FREE create routing + price-copy proofs (the second zkLogin character costs 10 SUI — swap free
// for paid and label the button accordingly). `is_paid_create` is THE single home
// both the creator's price button and the hosts' PTB route (free create_character vs paid
// create_character_paid) read — these pin the routing matrix and the rendered price / insufficient-funds
// copy. Imports the REAL module (loads clean under DOM-less bun:test — the colors test proved the chain);
// locale strings assert through standalone i18next instances (the reveal_strings idiom — no detector).
import { describe, expect, test } from 'bun:test'
import { createInstance } from 'i18next'
import { readFileSync } from 'node:fs'

import app_i18n from '../../i18n'
import en from '../../i18n/locales/en.json'
import fr from '../../i18n/locales/fr.json'
import de from '../../i18n/locales/de.json'
import es from '../../i18n/locales/es.json'
import ja from '../../i18n/locales/ja.json'
import uk from '../../i18n/locales/uk.json'

import {
  is_paid_create,
  insufficient_funds_copy,
  create_badge_copy,
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

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

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

test('class tags describe AP, cooldowns, and cast limits in all six locales — never the retired deck rules', () => {
  for (const locale of [en, fr, de, es, ja, uk]) {
    expect(locale.characters.create.casting_ap).toBeTruthy()
    expect(locale.characters.create.casting_limits).toBeTruthy()
  }

  const source = read_fixture('./character-create.js')
  expect(source).toContain("i18n.t('characters.create.casting_ap')")
  expect(source).toContain("i18n.t('characters.create.casting_limits')")
  expect(source).not.toContain('15-card deck')
  expect(source).not.toContain('7-card hand')
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

describe('#443 — a WALLET (non-zkLogin) session pays for its FIRST character too', () => {
  test('is_paid_create: a wallet session is PAID even at roster 0 / free slot unclaimed', () => {
    expect(is_paid_create({ character_count: 0, claimed_free: false, zklogin_session: false })).toBe(true)
  })

  test('is_paid_create: a zkLogin session keeps the free first character — untouched (explicit + default)', () => {
    expect(is_paid_create({ character_count: 0, claimed_free: false, zklogin_session: true })).toBe(false)
    // omitting the param at all (every pre-#443 call site) must reproduce the exact old behavior
    expect(is_paid_create({ character_count: 0, claimed_free: false })).toBe(false)
  })

  test('create_badge_copy: a wallet session NEVER renders the free banner — the maintainer-sighted regression', async () => {
    await app_i18n.changeLanguage('en')
    const copy = create_badge_copy({ paid: true, character_count: 0, claimed_free: false, price_sui: 10 })
    expect(copy).not.toBe('★ First character free')
    expect(copy).not.toContain('First')
    // and it must not claim to be an ADDITIONAL character — it is honestly this wallet's first
    expect(copy).not.toContain('Additional')
    expect(copy).toBe('Character · 10 SUI')
  })

  test('create_badge_copy: the zkLogin free first character keeps the exact banner — untouched', () => {
    expect(create_badge_copy({ paid: false, character_count: 0, claimed_free: false, price_sui: 10 })).toBe(
      '★ First character free'
    )
  })

  test('create_badge_copy: a genuinely ADDITIONAL character (roster ≥1) keeps its existing copy — unchanged', async () => {
    await app_i18n.changeLanguage('en')
    expect(create_badge_copy({ paid: true, character_count: 1, claimed_free: false, price_sui: 10 })).toBe(
      'Additional character · 10 SUI'
    )
  })

  test('characters.create.wallet_price ships in all six locales and interpolates the live price', () => {
    for (const locale of [en, fr, de, es, ja, uk]) expect(locale.characters.create.wallet_price).toBeTruthy()
    expect(EN.t('characters.create.wallet_price', { price: 10 })).toBe('Character · 10 SUI')
    expect(FR.t('characters.create.wallet_price', { price: 10 })).toBe('Personnage · 10 SUI')
    expect(JA.t('characters.create.wallet_price', { price: 10 })).toBe('キャラクター · 10 SUI')
  })

  test('the world-slot onboarding host routes on_created by session kind, never unconditionally free', () => {
    const src = read_fixture('./hud/world/WorldCharacterCreate.jsx')
    // auth is dynamic-imported here (its module body eagerly registers the Enoki wallet — a static import
    // would break in a DOM-less test/bundle context), never a static top-level import in this file.
    expect(src).not.toMatch(/^import .*from '\.\.\/\.\.\/\.\.\/\.\.\/auth'/m)
    expect(src).toContain("import('../../../../auth')")
    expect(src).toContain('const zklogin_session = is_zklogin_session()')
    expect(src).toContain('const paid = is_paid_create({ character_count: 0, claimed_free: false, zklogin_session })')
    expect(src).toContain('create_character_paid')
    expect(src).toContain('await (paid ? create_character_paid(draft) : create_character(draft))')
  })

  test('the characters-drawer create host and its price-badge gates account for a wallet session too', () => {
    const src = `${read_fixture('./hud/CharacterCreateHost.jsx')}\n${read_fixture('./hud/CharactersDrawer.jsx')}`
    expect(src).toContain('const zklogin_session = is_zklogin_session()')
    expect(src).toContain('const paid = is_paid_create({ character_count, claimed_free, zklogin_session })')
    expect(src).toContain(
      'const paid_create = is_paid_create({ character_count: roster.length, claimed_free, zklogin_session: is_zklogin_session() })'
    )
  })
})
