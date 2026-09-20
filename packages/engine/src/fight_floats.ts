// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Semantic combat numbers. Callers provide resolved meaning; this layer owns text, motion, and disposal.

import { Vector3 } from 'three'

import type { CaptionLayer } from './caption_layer.ts'
import type { WorldCaption } from './caption_types.ts'

export type FightFloatKind = 'damage' | 'critical' | 'heal' | 'ap' | 'mp'
type FloatAnchors = Readonly<{ world_anchor: (id: string) => Vector3 | null }>
type FightFloat = Readonly<{
  id: string
  caption: WorldCaption
  position: Vector3
  entity_id: string
  anchor: Vector3
  started_at: number
  drift: number
  scale: number
  kind: FightFloatKind
}>

const IMPACT_LAG_MS = 220
const LIFE_MS = 900
const POP_MS = 150
const RISE = 1
const DRIFT = 0.4
const DROP = 0.2
const COLORS: Readonly<Record<FightFloatKind, string>> = Object.freeze({
  damage: '#ff2f1c',
  critical: '#ffb454',
  heal: '#ff6bb0',
  ap: '#5db4ff',
  mp: '#4fd6a0',
})

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

// Amount is a SIGNED delta for ap/mp (gain +, loss −); damage is always a loss, heal a gain.
export const fight_float_text = (amount: number, kind: FightFloatKind): string => {
  const gain = kind === 'heal' || ((kind === 'ap' || kind === 'mp') && amount > 0)
  return `${gain ? '+' : '−'}${Math.round(Math.abs(amount))}`
}

export const fight_float_frame = (
  elapsed_ms: number,
  kind: FightFloatKind
): Readonly<{ visible: boolean; opacity: number; scale: number; y: number; x: number }> => {
  if (elapsed_ms < IMPACT_LAG_MS) return Object.freeze({ visible: false, opacity: 0, scale: 0, y: 0, x: 0 })
  const age = elapsed_ms - IMPACT_LAG_MS
  const progress = clamp01(age / LIFE_MS)
  const pop = clamp01(age / POP_MS)
  const overshoot = kind === 'critical' ? 0.8 : 0.45
  const scale = pop < 1 ? 1 + overshoot * Math.sin(pop * Math.PI) : 1
  const travel = progress < 0.45 ? progress / 0.45 : 1
  const fall = progress < 0.45 ? 0 : (progress - 0.45) / 0.55
  return Object.freeze({
    visible: progress < 1,
    opacity: progress < 0.62 ? 1 : 1 - (progress - 0.62) / 0.38,
    scale,
    y: travel * RISE - fall * fall * DROP,
    x: progress * DRIFT,
  })
}

const magnitude_scale = (amount: number): number => {
  const magnitude = Math.abs(amount)
  const normalized = clamp01((Math.max(5, Math.min(50, magnitude)) - 5) / 45)
  return 0.75 + normalized * 0.55
}

const drift_sign = (source: string): number => {
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1)
    hash = Math.imul(hash ^ source.charCodeAt(index), 16_777_619) >>> 0
  return (hash & 1) === 0 ? -1 : 1
}

export const create_fight_float_layer = ({
  captions,
  entities,
}: Readonly<{ captions: Pick<CaptionLayer, 'set'>; entities: FloatAnchors }>) => {
  const floats: FightFloat[] = []
  let previous_tick = performance.now()
  let serial = 0

  const dispose_float = (effect: FightFloat): void => captions.set(effect.id, null, () => null)

  return Object.freeze({
    play: (entity_id: string, amount: number, kind: FightFloatKind): boolean => {
      const anchor = entities.world_anchor(entity_id)
      if (!anchor) return false
      serial += 1
      floats.push(
        Object.freeze({
          id: `float:${serial}`,
          caption: {
            name: fight_float_text(amount, kind),
            color: COLORS[kind],
            variant: 'float',
            accessible: false,
          } satisfies WorldCaption,
          position: anchor.clone(),
          entity_id,
          anchor: anchor.clone(),
          started_at: previous_tick,
          drift: drift_sign(`${entity_id}:${serial}`),
          scale: magnitude_scale(amount) * (kind === 'critical' ? 1.5 : 1),
          kind,
        })
      )
      return true
    },
    tick: (now: number): void => {
      previous_tick = now
      for (let index = floats.length - 1; index >= 0; index -= 1) {
        const effect = floats[index]!
        const frame = fight_float_frame(now - effect.started_at, effect.kind)
        const anchor = entities.world_anchor(effect.entity_id)
        if (anchor) effect.anchor.copy(anchor)
        effect.position.set(effect.anchor.x + frame.x * effect.drift, effect.anchor.y + frame.y, effect.anchor.z)
        captions.set(
          effect.id,
          {
            ...effect.caption,
            opacity: frame.opacity,
            world_size: [7 * frame.scale * effect.scale, 1.75 * frame.scale * effect.scale],
          },
          () => effect.position
        )
        if (now - effect.started_at < IMPACT_LAG_MS + LIFE_MS) continue
        floats.splice(index, 1)
        dispose_float(effect)
      }
    },
    dispose: (): void => {
      floats.forEach(dispose_float)
      floats.length = 0
    },
  })
}
