// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names } from '@aresrpg/immutable'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

type CharacterIdentity = Readonly<{
  name: string
  classe: string
  male: boolean
  colors: readonly [string, string, string]
}>

const DEFAULT_IDENTITY: CharacterIdentity = Object.freeze({
  name: '',
  classe: 'senshi',
  male: true,
  colors: Object.freeze(['#ffffff', '#d9af57', '#8b6539'] as const),
})

export const CharacterCreateModal = ({ copy, cancel }: Readonly<{ copy: AppCopy; cancel: () => void }>) => {
  const [identity, set_identity] = useState<CharacterIdentity>(DEFAULT_IDENTITY)

  return (
    <section className="absolute inset-0 z-[160] grid place-items-center bg-[#050508]/72 p-5 backdrop-blur-lg">
      <div className="max-h-[92dvh] w-full max-w-5xl overflow-auto border border-white/10 border-t-[#c8963c] bg-[#0d0d14]/95 p-6 shadow-[0_26px_90px_rgba(0,0,0,0.58)]">
        <h2 className="text-[17px] font-bold tracking-[0.14em] uppercase">{copy.create_title}</h2>
        <p className="mt-1 text-[10px] tracking-[0.04em] text-[#8d9099]">{copy.create_lead}</p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="grid min-h-80 place-items-center border border-white/8 bg-[radial-gradient(circle_at_50%_42%,rgba(200,150,60,0.12),transparent_58%)]">
            <div className="text-center">
              <div className="mx-auto grid size-28 place-items-center border border-[#c8963c]/25 bg-[#c8963c]/5 text-3xl text-[#d9af57] uppercase">
                {identity.classe.slice(0, 2)}
              </div>
              <div className="mt-4 text-[12px] tracking-[0.25em] uppercase">{identity.classe}</div>
            </div>
          </div>
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-[9px] tracking-[0.18em] text-[#777b86] uppercase">{copy.class_label}</legend>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {class_names.map((classe) => (
                  <button
                    className={`h-10 cursor-pointer border text-[9px] tracking-[0.12em] uppercase ${
                      identity.classe === classe
                        ? 'border-[#4a9eff]/55 bg-[#4a9eff]/10 text-[#67adff]'
                        : 'border-white/8 bg-white/2 text-[#8d9099] hover:border-white/15'
                    }`}
                    key={classe}
                    onClick={() => set_identity(Object.freeze({ ...identity, classe }))}
                    type="button"
                  >
                    {classe}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-[9px] tracking-[0.18em] text-[#777b86] uppercase">{copy.sex_label}</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {[true, false].map((male) => (
                  <button
                    className={`h-10 cursor-pointer border text-[9px] tracking-[0.14em] uppercase ${
                      identity.male === male
                        ? 'border-[#c8963c]/50 bg-[#c8963c]/8 text-[#d9af57]'
                        : 'border-white/8 text-[#777b86]'
                    }`}
                    key={String(male)}
                    onClick={() => set_identity(Object.freeze({ ...identity, male }))}
                    type="button"
                  >
                    {male ? copy.male : copy.female}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-[9px] tracking-[0.18em] text-[#777b86] uppercase">
                {copy.appearance_label}
              </legend>
              <div className="flex gap-2">
                {identity.colors.map((color, index) => (
                  <input
                    aria-label={`${copy.appearance_label} ${index + 1}`}
                    className="h-10 flex-1 cursor-pointer border border-white/10 bg-transparent p-1"
                    key={index}
                    type="color"
                    value={color}
                    onChange={(event) =>
                      set_identity(
                        Object.freeze({
                          ...identity,
                          colors: Object.freeze(
                            identity.colors.map((current, current_index) =>
                              current_index === index ? event.target.value : current
                            )
                          ) as readonly [string, string, string],
                        })
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-2 block text-[9px] tracking-[0.18em] text-[#777b86] uppercase">
                {copy.name_label}
              </span>
              <input
                className="h-11 w-full border border-white/10 bg-black/25 px-3 text-[11px] outline-none focus:border-[#4a9eff]/45"
                maxLength={20}
                placeholder={copy.name_placeholder}
                value={identity.name}
                onChange={(event) => set_identity(Object.freeze({ ...identity, name: event.target.value }))}
              />
            </label>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/8 pt-4">
          <span className="mr-auto max-w-md text-[8px] leading-4 tracking-[0.1em] text-[#777b86] uppercase">
            {copy.create_unavailable}
          </span>
          <button
            className="h-10 cursor-pointer border border-white/10 px-5 text-[9px] tracking-[0.16em] text-[#8d9099] uppercase"
            onClick={cancel}
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            className="h-10 cursor-not-allowed border border-[#c8963c]/20 bg-[#c8963c]/5 px-5 text-[9px] tracking-[0.16em] text-[#c8963c]/45 uppercase"
            disabled
            type="button"
          >
            {copy.create_and_play}
          </button>
        </div>
      </div>
    </section>
  )
}
