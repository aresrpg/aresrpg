import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../i18n/locales/en.json'

import {
  PET_MAX_FEEDS,
  PetPowerCard,
  pet_effective_stats,
  pet_feed_count,
  pet_feed_foods,
  pet_feed_is_available,
  pet_next_feed_at_ms,
  pet_stats_at_power,
} from './pet_power_card'

const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const render = (pet, pet_max_stats) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(PetPowerCard, { pet, pet_max_stats, now_ms: 1_000 }))
  )

describe('pet power projection card', () => {
  test('reads the Move-projected count, next timestamp, and effective stats without deriving the stat curve', () => {
    const pet = {
      feed_count: 23,
      next_feed_at_ms: 2_000,
      effective_stats: { strength: 27, chance: 0 },
    }
    expect(pet_feed_count(pet)).toBe(23)
    expect(pet_next_feed_at_ms(pet)).toBe(2_000)
    expect(pet_effective_stats(pet)).toEqual({ strength: 27 })
    const html = render(pet)
    expect(html).toContain(`23 / ${PET_MAX_FEEDS}`)
    expect(html).toContain('+27')
    expect(html).toContain('Next feed')
  })

  test('renders the zero and capped endpoints honestly', () => {
    expect(render({ feed_count: 0, next_feed_at_ms: 0, effective_stats: {} })).toContain('0 / 60')
    expect(render({ feed_count: 61, next_feed_at_ms: 0, effective_stats: {} })).toContain('60 / 60')
    expect(pet_feed_count({ feed_count: null, pet_power: 42 })).toBeNull()
    expect(pet_next_feed_at_ms({ next_feed_at_ms: null })).toBeNull()
    expect(pet_next_feed_at_ms({ next_feed_at_ms: '' })).toBeNull()
    expect(pet_feed_is_available({ feed_count: null, next_feed_at_ms: 0 }, 1_000)).toBe(false)
    expect(pet_feed_is_available({ feed_count: 1, next_feed_at_ms: null }, 1_000)).toBe(false)
    expect(pet_feed_is_available({ feed_count: 1, next_feed_at_ms: 2_000 }, 1_000)).toBe(false)
    expect(pet_feed_is_available({ feed_count: 60, next_feed_at_ms: 0 }, 1_000)).toBe(false)
    expect(pet_feed_is_available({ feed_count: 1, next_feed_at_ms: 1_000 }, 1_000)).toBe(true)
  })

  test('pet_stats_at_power derives the SAME floor-scaled magnitude item_stats::scale_field computes on-chain', () => {
    // template ceiling {wisdom:80, vitality:80} (pet_diamantine_cactee-shaped), half power (30/60) ->
    // floor(80*30/60) = 40 each, mirroring pet.move's advance_pet -> item_stats::pet_stats_at_count exactly.
    expect(pet_stats_at_power({ wisdom: 80, vitality: 80 }, 30)).toEqual({ wisdom: 40, vitality: 40 })
    expect(pet_stats_at_power({ wisdom: 80, vitality: 80 }, 60)).toEqual({ wisdom: 80, vitality: 80 })
    // zero power -> every magnitude floors to zero -> filtered out (honest "no bonus yet", never a lie)
    expect(pet_stats_at_power({ wisdom: 80, vitality: 80 }, 0)).toEqual({})
    // a malus (negative authored ceiling) keeps its sign through the floor-scale
    expect(pet_stats_at_power({ strength: -10 }, 30)).toEqual({ strength: -5 })
    // no resolvable template ceiling / no feed count -> null (the genuine unresolvable-pet edge case)
    expect(pet_stats_at_power(null, 30)).toBeNull()
    expect(pet_stats_at_power({ wisdom: 80 }, null)).toBeNull()
  })

  test('the card computes real stats-at-power from pet_max_stats when the indexer has not projected effective_stats yet', () => {
    const pet = { feed_count: 30, next_feed_at_ms: 0 } // no effective_stats/effective_stats_json at all
    const html = render(pet, { wisdom: 80, vitality: 80 })
    expect(html).toContain('+40')
    expect(html).not.toContain('Current stats unavailable')
  })

  test('still shows the honest unavailable fallback when NEITHER the indexer NOR pet_max_stats can resolve it', () => {
    const pet = { feed_count: 30, next_feed_at_ms: 0 }
    const html = render(pet, undefined)
    expect(html).toContain('Current stats unavailable')
  })

  test('offers only positive, unlisted resources from the pet kiosk and capability', () => {
    const pet = { kiosk_id: 'kiosk-a', kiosk_cap_id: 'cap-a' }
    const resource = {
      id: 'food',
      item_category: 'resource',
      pet_feed_allowed: true,
      kiosk_id: 'kiosk-a',
      kiosk_cap_id: 'cap-a',
      amount: 2,
    }
    expect(
      pet_feed_foods(
        [
          resource,
          { ...resource, id: 'listed', listed: true },
          { ...resource, id: 'empty', amount: 0 },
          { ...resource, id: 'gear', item_category: 'head' },
          { ...resource, id: 'unconfigured', pet_feed_allowed: false },
          { ...resource, id: 'other-kiosk', kiosk_id: 'kiosk-b' },
          { ...resource, id: 'other-cap', kiosk_cap_id: 'cap-b' },
        ],
        pet
      )
    ).toEqual([resource])
  })
})
