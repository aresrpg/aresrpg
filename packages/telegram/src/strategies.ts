// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_at_position } from '@aresrpg/engine/data'
import type { BotResult } from '@aresrpg/protocol/hosted-bot-client'
import {
  bind_strategy,
  hero_place,
  strategies as catalogue,
  type StrategyArea,
  type StrategyScript,
} from '@aresrpg/protocol/strategies'

/** The solo trees of the shared catalogue Telegram offers, and the area each one is reviewed and bound with. */
const SCOPES: Readonly<Record<string, 'city' | 'world'>> = { fight_nearby: 'city', gather_craft: 'world' }
export const strategies = catalogue.filter(({ id }) => Object.hasOwn(SCOPES, id))

type Row = Readonly<Record<string, unknown>>
type BoundStrategy = Readonly<{ script: StrategyScript; area: StrategyArea }>
/** Binds an offered tree to one hero where it stands now: its world, or the city it is in. Never a destination. */
export const bind_hero = (id: string, hero: Row, title: string): BotResult<BoundStrategy> => {
  if (!Object.hasOwn(SCOPES, id)) return { ok: false, error: 'unknown_strategy' }
  const place = hero_place(hero, city_at_position)
  if (!place) return { ok: false, error: 'observation_unknown' }
  const { world, city } = place
  const bound = (area: StrategyArea) =>
    ({ ok: true, value: { area, script: bind_strategy(id, { character: String(hero.id), title, area }) } }) as const
  if (SCOPES[id] === 'world') return bound({ world })
  // A hero held by a protector cannot start a patrol.
  if (hero.ambush) return { ok: false, error: 'character_changed' }
  return city ? bound({ world, city }) : { ok: false, error: 'city_required' }
}
