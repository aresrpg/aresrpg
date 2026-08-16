// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one mounted fight surface. Pages create fights; this game layer renders every active
// checkpoint with the shared engine and, beside it, the shared HUD.

import type { EntityRender } from '@aresrpg/engine'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'

import { fight_character_entity_sources, type FightCharacterAppearance } from './character_entity_sources.ts'
import { FightViewport } from './FightViewport.tsx'
import { FightHud } from './FightHud.tsx'
import type { FightMobRenderSource } from './mob_entities.ts'

const color_hex = (value: number): string => `#${value.toString(16).padStart(6, '0').slice(-6)}`

export const FightLayer = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const fight = useAppStore((state) => state.fight)
  const simulator = useAppStore((state) => state.simulator)
  const session = useAppStore((state) => state.session)
  const quality = useAppStore((state) => state.settings.quality)
  const [entities, set_entities] = useState<readonly EntityRender[]>(Object.freeze([]))
  const checkpoint = fight.checkpoint
  const appearances = useMemo<readonly FightCharacterAppearance[]>(
    () =>
      Object.freeze([
        ...simulator.characters,
        ...session.characters.map((character) =>
          Object.freeze({
            id: character.id,
            classe: character.classe,
            male: character.sex === 'male',
            colors: Object.freeze([
              color_hex(character.color_1),
              color_hex(character.color_2),
              color_hex(character.color_3),
            ]) as readonly [string, string, string],
            loadout: Object.freeze(
              Object.fromEntries(character.equipment.map(({ slot, item_type }) => [slot, item_type]))
            ),
          })
        ),
      ]),
    [session.characters, simulator.characters]
  )
  const character_sources = useMemo(
    () => (checkpoint ? fight_character_entity_sources(checkpoint, appearances) : Object.freeze([])),
    [appearances, checkpoint]
  )
  const mob_sources = useMemo<readonly FightMobRenderSource[]>(
    () =>
      checkpoint
        ? Object.freeze(
            checkpoint.contract.fighters.flatMap((fighter, seat) =>
              fighter.kind.type === 'mob'
                ? [
                    Object.freeze({
                      id: `fight_mob_${seat}`,
                      mob_type: fighter.kind.snapshot.mob_type,
                      cell: Number(fighter.cell),
                      side: fighter.team === 0n ? ('a' as const) : ('b' as const),
                    }),
                  ]
                : []
            )
          )
        : Object.freeze([]),
    [checkpoint]
  )

  useEffect(() => {
    let current = true
    void Promise.all([
      import('./character_entities.ts').then(({ load_fight_character_entities }) =>
        load_fight_character_entities(character_sources)
      ),
      import('./mob_entities.ts').then(({ load_fight_mob_entities }) => load_fight_mob_entities(mob_sources)),
    ]).then(
      ([characters, mobs]) => {
        if (current) set_entities(Object.freeze([...characters, ...mobs]))
      },
      (error: unknown) => {
        console.error('Failed to resolve fight entity models.', error)
        if (current) set_entities(Object.freeze([]))
      }
    )
    return () => {
      current = false
    }
  }, [character_sources, mob_sources])

  if (!checkpoint || !fight.mode) return null
  return (
    <section className="pointer-events-auto absolute inset-0 z-30 overflow-hidden bg-[#08090e]">
      <FightViewport
        board={checkpoint.contract.board}
        entities={entities}
        label={copy.fight_hud.board_label}
        quality={quality}
      />
      <FightHud copy={copy} />
      {fight.mode === 'local' && (
        <button
          className="absolute top-3 right-3 z-10 flex cursor-pointer items-center gap-2 border border-white/10 bg-black/55 px-3 py-2 text-[8px] tracking-[0.14em] text-[#a3a5ad] uppercase backdrop-blur hover:border-[#c8963c]/40 hover:text-[#c8963c]"
          onClick={() => dispatch_app({ type: 'fight/closed' })}
          type="button"
        >
          <RotateCcw size={12} /> {copy.simulator_page.back_to_setup}
        </button>
      )}
    </section>
  )
}
