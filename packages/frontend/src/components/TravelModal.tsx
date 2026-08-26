// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The star gate's world cards. Authored world facts provide identity, entry level and biome copy;
// card art is presentation only. The chain reasserts entry level on every travel transaction.

import { Lock, MapPin, Snowflake, Trees } from 'lucide-react'
import { useState } from 'react'

import nauvis_art from '../assets/worlds/nauvis.webp'
import yakutia_art from '../assets/worlds/yakutia.webp'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { worlds_source } from '../content/worlds.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import { ModalFrame } from './ModalFrame.tsx'

const WORLD_ART = Object.freeze({ nauvis: nauvis_art, yakutia: yakutia_art })

export const world_card_rows = () =>
  worlds_source.map((world) =>
    Object.freeze({
      id: world.world,
      label: titleize(world.world),
      entry_level: world.entry_level,
      biomes:
        encyclopedia_catalog.world(world.world)?.terrain?.biomes.map(({ name }) => titleize(name)) ?? Object.freeze([]),
      art: WORLD_ART[world.world as keyof typeof WORLD_ART] ?? null,
    })
  )

export const TravelModal = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore((state) => state.session.wallet)
  const character = useAppStore(
    (state) => state.session.characters.find(({ id }) => id === state.session.selected_character_id) ?? null
  )
  const [travelling, set_travelling] = useState(false)
  const text = copy_text(copy.world_hud)
  const close = (): void => dispatch_app({ type: 'dialog/open', dialog: null })

  const travel = (world: string): void => {
    if (!wallet || !character || travelling) return
    if (world === character.world) return close()
    set_travelling(true)
    const pending = toast.loading(text('travel_pending'))
    void wallet.character
      .join_world({
        character_id: character.id,
        world,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
      .then(({ joined }) => {
        dispatch_app({ type: 'character/world_joined', character_id: character.id, joined })
        pending.success(text('travel_success', { world: titleize(joined.world) }))
        close()
      })
      .catch(pending.error)
      .finally(() => set_travelling(false))
  }

  return (
    <ModalFrame close={close} close_label={copy.cancel} label={text('travel_title')} max_width="max-w-5xl" soft>
      <section className="p-6 sm:p-8">
        <header className="mb-6 border-l-2 border-[#4a9eff] pl-4">
          <p className="text-[8px] tracking-[0.24em] text-[#67adff] uppercase">AresRPG</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[0.12em] text-[#e8e4dc] uppercase">
            {text('travel_title')}
          </h2>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          {world_card_rows().map((world) => {
            const current = world.id === character?.world
            const locked = (character?.level ?? 0) < world.entry_level
            const ClimateIcon = world.id === 'yakutia' ? Snowflake : Trees
            return (
              <button
                className={`group relative min-h-72 overflow-hidden rounded-xl border text-left transition duration-300 ${
                  current
                    ? 'cursor-pointer border-[#4a9eff]/80 shadow-[0_0_34px_rgba(74,158,255,0.16)]'
                    : locked
                      ? 'cursor-not-allowed border-white/8 opacity-50'
                      : 'cursor-pointer border-white/12 hover:-translate-y-0.5 hover:border-[#c8963c]/65 hover:shadow-[0_18px_45px_rgba(0,0,0,0.42)]'
                }`}
                data-world-card={world.id}
                disabled={locked || travelling}
                key={world.id}
                onClick={() => travel(world.id)}
                type="button"
              >
                {world.art && (
                  <img
                    alt=""
                    className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-[1.025]"
                    src={world.art}
                  />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-[#080b12] via-[#080b12]/28 to-black/8" />
                <span className="absolute inset-x-0 bottom-0 block p-5">
                  <span className="flex items-end justify-between gap-3">
                    <span>
                      <span className="block text-xl font-bold tracking-[0.12em] text-white uppercase drop-shadow-lg">
                        {world.label}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[9px] tracking-[0.14em] text-[#c4c8d0] uppercase">
                        <ClimateIcon size={12} />
                        {world.biomes.join(' · ')}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[8px] tracking-[0.12em] text-[#f5d0a9] uppercase backdrop-blur-md">
                      {locked ? <Lock size={10} /> : <MapPin size={10} />}
                      {text('travel_entry_level', { level: world.entry_level })}
                    </span>
                  </span>
                  {current && (
                    <span className="mt-3 block w-fit rounded-full border border-[#4a9eff]/45 bg-[#07182d]/70 px-2.5 py-1 text-[8px] tracking-[0.14em] text-[#67adff] uppercase">
                      {text('travel_selected', { label: world.label })}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </ModalFrame>
  )
}
