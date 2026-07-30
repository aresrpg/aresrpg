// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/MobModal.tsx — a mob seat's modal: WHICH mob and at WHAT level, and nothing else.
//
// A mob is not built, it is chosen: its spells are the authored kit minted into its MobTemplate, so they load
// with the mob and are shown READ-ONLY — the player can see what the enemy brings without being offered an
// allocation that has no chain counterpart.
//
// The GAME's own components, never lookalikes (the no-divergence law):
//   · mob art     → EncyclopediaMobImage (the bestiary's mob image)
//   · the roster  → MobPicker (this page's picker, over the shared SearchPickerModal)
//   · the kit     → MobSpellsSection + mob_spell_views (the bestiary detail's spell section, hover cards included)
//   · the dialog  → ModalFrame (components/modal_frame.tsx)
//
// Both doors into this modal — a red board cell and a right-panel seat — write the SAME `mob_picked` /
// `mob_level_set` inputs against the SAME cell, so the two surfaces cannot drift apart.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

import { ModalFrame } from '../components/modal_frame'
import { EncyclopediaMobImage } from '../pages/encyclopedia/mob_image'
import { mob_spell_views } from '../pages/encyclopedia/mob_spells'
import { MobSpellsSection } from '../pages/encyclopedia/mob_spells_section'
import { mob_corpus_of, type CorpusMob } from '../pages/encyclopedia/world_corpus'

import { build_mob } from './content.js'
import { MobPicker, use_mob_index } from './MobPicker'
import type { SimMobPick } from './reducer'
import { use_simulator } from './store'

const GOLD = '#c8963c'
const micro = 'text-[9px] tracking-[0.22em] uppercase'

/** The corpus row a stored pick refers to, or null when the corpus no longer publishes it. Subscribed: the
 *  corpus is fetched at boot (main.tsx `load_world_corpus`), so a seat mounted before it lands must be told
 *  when it does — an index frozen at first read would call every stored pick a vanished mob. */
export const use_mob_of = (template_id: string | undefined): CorpusMob | null =>
  use_mob_index().get(template_id ?? '') ?? null

export function MobModal({
  cell,
  pick,
  on_close,
}: Readonly<{ cell: number; pick: SimMobPick | null; on_close: () => void }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const [picking, set_picking] = useState(pick === null)
  const mob = use_mob_of(pick?.template_id)

  // A pick whose corpus row vanished is still a stored seat: say so instead of rendering an empty editor.
  if (picking || !mob || !pick)
    return (
      <MobPicker
        value={pick?.template_id}
        on_close={pick ? () => set_picking(false) : on_close}
        on_pick={(picked) => {
          input({
            type: 'mob_picked',
            cell,
            template_id: picked.id,
            level: pick?.level ?? picked.minLevel,
            min_level: picked.minLevel,
            max_level: picked.maxLevel,
          })
          set_picking(false)
        }}
      />
    )

  const built = build_mob(mob, pick.level)
  const spells = mob_spell_views(mob_corpus_of(mob.name)?.spells)
  const levels = Array.from({ length: mob.maxLevel - mob.minLevel + 1 }, (_, index) => mob.minLevel + index)

  return (
    <ModalFrame on_close={on_close} max_width="max-w-lg" label={mob.name}>
      <div className="flex flex-col gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <EncyclopediaMobImage mob={mob} className="w-12 h-12" style={{ imageRendering: 'pixelated' }} />
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-[12px] tracking-[0.2em] uppercase truncate" style={{ color: GOLD }}>
              {mob.name}
            </span>
            <span className={`${micro} text-muted`}>
              {t('simulator.mob_band', { min: mob.minLevel, max: mob.maxLevel })}
            </span>
          </div>
        </div>

        <div className="w-full h-px bg-border" />

        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2">
            <span className={`${micro} font-semibold text-muted`}>{t('simulator.level')}</span>
            <select
              className="template-input w-24 cursor-pointer"
              aria-label={t('simulator.level')}
              value={pick.level}
              onChange={(event) =>
                input({
                  type: 'mob_level_set',
                  cell,
                  level: Number(event.target.value),
                  min_level: mob.minLevel,
                  max_level: mob.maxLevel,
                })
              }
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={`${micro} px-3 py-2 cursor-pointer text-muted hover:text-white`}
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
            onClick={() => set_picking(true)}
          >
            {t('simulator.pick_mob')}
          </button>
          <button
            type="button"
            className={`${micro} flex items-center gap-1 px-3 py-2 cursor-pointer`}
            style={{ border: '1px solid rgba(255,95,95,0.4)', color: '#ff5f5f' }}
            onClick={() => {
              input({ type: 'mob_unpicked', cell })
              on_close()
            }}
          >
            <Trash2 size={11} />
            {t('simulator.remove_mob')}
          </button>
        </div>

        {/* HP is the fight's own number for this level — the S2 seam is stated, never papered over. */}
        <div className="flex items-center gap-3">
          <span className={`${micro} text-muted`}>{t('simulator.mob_hp', { hp: built.hp })}</span>
          {!built.combat_block_published && (
            <span className={`${micro}`} style={{ color: '#ff9f43' }}>
              {t('simulator.combat_block_unpublished')}
            </span>
          )}
        </div>

        <span className={`${micro} text-muted`} style={{ opacity: 0.6 }}>
          {t('simulator.mob_spells_auto')}
        </span>
        <MobSpellsSection spells={spells} />
      </div>
    </ModalFrame>
  )
}
