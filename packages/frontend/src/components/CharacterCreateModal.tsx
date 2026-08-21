// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_preview, type CharacterPreview } from '@aresrpg/engine'
import { class_names } from '@aresrpg/immutable'
import type { CharacterCreateInput } from '@aresrpg/sdk/character'
import { CHARACTER_NAME_MAX_LENGTH, is_valid_character_name } from '@aresrpg/sdk/character-name'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'
import { toast } from '../toast.ts'

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

const CharacterPreviewCanvas = ({ identity }: Readonly<{ identity: CharacterIdentity }>) => {
  const canvas_ref = useRef<HTMLCanvasElement>(null)
  const preview_ref = useRef<Promise<CharacterPreview | null> | null>(null)

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas) return
    const preview = create_character_preview(canvas).catch((error: unknown) => {
      console.error('Failed to initialize the character preview.', error)
      return null
    })
    // eslint-disable-next-line functional/immutable-data -- This ref owns the modal renderer lifecycle.
    preview_ref.current = preview
    return () => {
      // eslint-disable-next-line functional/immutable-data -- Cleanup detaches the renderer before disposal resolves.
      preview_ref.current = null
      void preview.then((handle) => handle?.dispose())
    }
  }, [])

  useEffect(() => {
    const preview = preview_ref.current
    if (!preview) return
    let current = true
    void Promise.all([
      preview,
      import('../content/character_models.ts').then(({ load_character_model_urls }) =>
        load_character_model_urls(identity.classe, identity.male)
      ),
    ])
      .then(async ([handle, urls]) => {
        if (!current || !handle) return
        await handle.set_appearance({
          ...urls,
          colors: identity.colors,
          worn: Object.freeze({ head: null, back: null }),
        })
      })
      .catch((error: unknown) => console.error('Failed to display the selected character.', error))
    return () => {
      current = false
    }
  }, [identity.classe, identity.colors, identity.male])

  return (
    <canvas
      className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing"
      data-character-preview=""
      ref={canvas_ref}
    />
  )
}

export const CharacterCreateModal = ({
  copy,
  cancel,
  create,
  insufficient,
}: Readonly<{
  copy: AppCopy
  cancel: () => void
  create: (input: CharacterCreateInput) => Promise<void>
  insufficient: boolean
}>) => {
  const [identity, set_identity] = useState<CharacterIdentity>(DEFAULT_IDENTITY)
  const [submitting, set_submitting] = useState(false)
  const name_error = character_name_error_text(copy, identity.name)
  const valid = is_valid_character_name(identity.name)
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
    set_submitting(true)
    const [color_1, color_2, color_3] = identity.colors.map((color) => Number.parseInt(color.slice(1), 16))
    void create({
      name: identity.name,
      classe: identity.classe,
      male: identity.male,
      color_1: color_1!,
      color_2: color_2!,
      color_3: color_3!,
    })
      .catch((error: unknown) => {
        console.error('Character creation failed.', error)
        toast.add(error)
      })
      .finally(() => set_submitting(false))
  }

  return (
    <section className="absolute inset-0 z-[160] grid place-items-center bg-[#050508]/72 p-5 backdrop-blur-lg">
      <form
        className="max-h-[92dvh] w-full max-w-5xl overflow-auto border border-white/10 border-t-[#c8963c] bg-[#0d0d14]/95 p-6 shadow-[0_26px_90px_rgba(0,0,0,0.58)]"
        onSubmit={submit}
      >
        <h2 className="text-[17px] font-bold tracking-[0.14em] uppercase">{copy.create_title}</h2>
        <p className="mt-1 text-[10px] tracking-[0.04em] text-[#8d9099]">{copy.create_lead}</p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="relative grid min-h-80 place-items-center overflow-hidden border border-white/8 bg-[radial-gradient(circle_at_50%_42%,rgba(200,150,60,0.12),transparent_58%)]">
            <CharacterPreviewCanvas identity={identity} />
            <div className="pointer-events-none absolute bottom-5 left-0 w-full text-center text-[12px] tracking-[0.25em] uppercase">
              {identity.classe}
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
                aria-invalid={name_error ? true : undefined}
                className={`h-11 w-full border bg-black/25 px-3 text-[11px] outline-none ${
                  name_error
                    ? 'border-[#ff5a6f]/70 text-[#ff8a98] focus:border-[#ff5a6f]'
                    : 'border-white/10 focus:border-[#4a9eff]/45'
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
          <div className="mr-auto border-l border-[#c8963c]/45 pl-3">
            <div className="text-[8px] tracking-[0.18em] text-[#777b86] uppercase">{copy.character_price}</div>
            <div className="mt-1 text-[12px] font-semibold tracking-[0.12em] text-[#d9af57]">
              {format_sui(CHARACTER_PRICE_MIST, 0)} SUI
            </div>
            {insufficient && (
              <div className="mt-1 text-[9px] tracking-[0.08em] text-[#ff667c]" role="alert">
                {copy.insufficient_sui}
              </div>
            )}
          </div>
          <button
            className="h-10 cursor-pointer border border-white/10 px-5 text-[9px] tracking-[0.16em] text-[#8d9099] uppercase"
            disabled={submitting}
            onClick={cancel}
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            className="h-10 cursor-pointer border border-[#c8963c]/45 bg-[#c8963c]/8 px-5 text-[9px] tracking-[0.16em] text-[#d9af57] uppercase hover:border-[#c8963c]/75 disabled:cursor-not-allowed disabled:border-[#c8963c]/20 disabled:bg-[#c8963c]/5 disabled:text-[#c8963c]/45"
            disabled={!valid || submitting || insufficient}
            type="submit"
          >
            {submitting ? copy.creating_character : copy.create_and_play}
          </button>
        </div>
      </form>
    </section>
  )
}
