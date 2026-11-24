// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names } from '@aresrpg/immutable'
import type { CharacterCreateInput } from '@aresrpg/sdk/character'
import { CHARACTER_NAME_MAX_LENGTH, is_valid_character_name } from '@aresrpg/sdk/character-name'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { NativeModal } from '@aresrpg/ui'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { character_creation_funding_text } from '../character_creation_funding.ts'
import { docs_path } from '../docs/routes.ts'
import type { CharacterRenderSource } from '../game/character_entities.ts'
import { dispatch_app } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { NewTabLink } from './links.tsx'

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

export const character_name_error_text = (copy: AppCopy, name: string): string | null =>
  name.length > 0 && !is_valid_character_name(name) ? copy.name_invalid : null

export const CharacterCreateModal = ({
  copy,
  cancel,
  create,
  insufficient,
  preview,
}: Readonly<{
  copy: AppCopy
  cancel: () => void
  create: (input: CharacterCreateInput) => Promise<void>
  insufficient: boolean
  /**
   * The picture of the character being made. Its caller owns it: the 3D game draws the model, a page
   * without a canvas draws a portrait.
   */
  preview: (source: CharacterRenderSource) => ReactNode
}>) => {
  const localized_numbers = useNumbers()
  const [identity, set_identity] = useState<CharacterIdentity>(DEFAULT_IDENTITY)
  const [submitting, set_submitting] = useState(false)
  const name_error = character_name_error_text(copy, identity.name)
  const valid = is_valid_character_name(identity.name)
  const preview_source = useMemo(() => ({ ...identity, id: 'creation_preview', loadout: {} }), [identity])

  useEffect(() => {
    const close_on_escape = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') cancel()
    }
    globalThis.addEventListener('keydown', close_on_escape)
    return () => globalThis.removeEventListener('keydown', close_on_escape)
  }, [cancel])
  const submit = (event: Readonly<FormEvent>): void => {
    event.preventDefault()
    if (!valid || submitting || insufficient) return
    const [color_1, color_2, color_3] = identity.colors.map((color) => Number.parseInt(color.slice(1), 16))
    const transaction = run_direct_transaction(() =>
      create({
        name: identity.name,
        classe: identity.classe,
        male: identity.male,
        color_1: color_1!,
        color_2: color_2!,
        color_3: color_3!,
      })
    )
    if (!transaction) return
    set_submitting(true)
    void transaction.catch((error: unknown) => error).finally(() => set_submitting(false))
  }

  return (
    <NativeModal close={null} label={copy.create_title} className="aui-modal-scrim">
      <form
        className="max-h-[92dvh] w-full max-w-5xl overflow-auto border border-border border-t-gold bg-surface/97 p-6 shadow-[0_26px_90px_rgba(0,0,0,0.52)]"
        onSubmit={submit}
      >
        <h2 className="text-[17px] font-bold tracking-[0.14em] uppercase">{copy.create_title}</h2>
        <p className="mt-1 text-[10px] tracking-[0.04em] text-faint">{copy.create_lead}</p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="relative grid min-h-80 place-items-center overflow-hidden border border-white/8 bg-[radial-gradient(circle_at_50%_42%,rgba(200,150,60,0.12),transparent_58%)]">
            {preview(preview_source)}
            <div className="pointer-events-none absolute bottom-5 left-0 w-full text-center uppercase">
              <div className="text-[12px] tracking-[0.25em]">{identity.classe}</div>
              <div className="mt-1 text-[8px] tracking-[0.18em] text-faint">
                {copy.simulator_page[`class_${identity.classe}_title`]}
              </div>
            </div>
          </div>
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-[9px] tracking-[0.18em] text-faint uppercase">{copy.class_label}</legend>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {class_names.map((classe) => (
                  <button
                    className={`flex h-12 cursor-pointer flex-col items-center justify-center border uppercase ${
                      identity.classe === classe
                        ? 'border-cyan/55 bg-cyan/10 text-cyan'
                        : 'border-white/8 bg-white/2 text-faint hover:border-white/15'
                    }`}
                    key={classe}
                    onClick={() => set_identity(Object.freeze({ ...identity, classe }))}
                    type="button"
                  >
                    <span className="text-[9px] tracking-[0.12em]">{classe}</span>
                    <span className="mt-0.5 text-[7px] tracking-[0.08em] text-faint">
                      {copy.simulator_page[`class_${classe}_title`]}
                    </span>
                  </button>
                ))}
              </div>
              <NewTabLink
                className="mt-2 grid h-9 w-full place-items-center border border-cyan/25 bg-cyan/5 text-[8px] tracking-[0.14em] text-cyan uppercase hover:border-cyan/55 hover:bg-cyan/10"
                href={docs_path('classes', identity.classe)}
                new_tab={copy.site.new_tab}
              >
                {copy.view_class_spells}
              </NewTabLink>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-[9px] tracking-[0.18em] text-faint uppercase">{copy.sex_label}</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {[true, false].map((male) => (
                  <button
                    className={`h-10 cursor-pointer border text-[9px] tracking-[0.14em] uppercase ${
                      identity.male === male ? 'border-gold/50 bg-gold/8 text-gold' : 'border-white/8 text-faint'
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
              <legend className="mb-2 text-[9px] tracking-[0.18em] text-faint uppercase">
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
              <span className="mb-2 block text-[9px] tracking-[0.18em] text-faint uppercase">{copy.name_label}</span>
              <input
                aria-invalid={name_error ? true : undefined}
                className={`h-11 w-full border bg-black/25 px-3 text-[11px] outline-none ${
                  name_error
                    ? 'border-[#ff5a6f]/70 text-[#ff8a98] focus:border-[#ff5a6f]'
                    : 'border-white/10 focus:border-cyan/45'
                }`}
                maxLength={CHARACTER_NAME_MAX_LENGTH}
                placeholder={copy.name_placeholder}
                value={identity.name}
                onChange={(event) => set_identity(Object.freeze({ ...identity, name: event.target.value }))}
              />
              <span
                aria-live="polite"
                className="mt-1.5 block min-h-4 text-[9px] leading-4 text-[#ff667c]"
                data-character-name-error=""
                role={name_error ? 'alert' : undefined}
              >
                {name_error}
              </span>
            </label>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 border-t border-white/8 pt-4">
          <div className="mr-auto border-l border-gold/45 pl-3">
            <div className="text-[8px] tracking-[0.18em] text-faint uppercase">{copy.character_price}</div>
            <div className="mt-1 text-[12px] font-semibold tracking-[0.12em] text-gold">
              {localized_numbers.sui(CHARACTER_PRICE_MIST, 0)} SUI
            </div>
            {insufficient && (
              <div className="mt-1 text-[9px] tracking-[0.08em] text-[#ff667c]" role="alert">
                {character_creation_funding_text(copy.insufficient_sui, localized_numbers.sui)}
              </div>
            )}
          </div>
          <button
            className="h-10 cursor-pointer border border-white/10 px-5 text-[9px] tracking-[0.16em] text-faint uppercase"
            disabled={submitting}
            onClick={cancel}
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            className="h-10 cursor-pointer border border-gold/45 bg-gold/8 px-5 text-[9px] tracking-[0.16em] text-gold uppercase hover:border-gold/75 disabled:cursor-not-allowed disabled:border-gold/20 disabled:bg-gold/5 disabled:text-gold/45"
            disabled={!valid || submitting}
            onClick={
              insufficient
                ? (event) => {
                    event.preventDefault()
                    dispatch_app({ type: 'funding/open', cost_mist: CHARACTER_PRICE_MIST })
                  }
                : undefined
            }
            type="submit"
          >
            {submitting
              ? copy.creating_character
              : insufficient
                ? copy.wallet_send_shared.add_funds
                : copy.create_and_play}
          </button>
        </div>
      </form>
    </NativeModal>
  )
}
