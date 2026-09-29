// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  ATMOSPHERE_CONTROLS,
  resolve_atmosphere_tuning,
  type AtmosphereTuning,
  type EngineQuality,
} from '@aresrpg/engine'
import { CloudFog, RotateCcw } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

const AtmosphereSliders = ({
  apply,
  preset,
  quality,
  text,
}: Readonly<{
  apply: (overrides: Partial<AtmosphereTuning> | null) => void
  preset: Parameters<typeof resolve_atmosphere_tuning>[0]
  quality: EngineQuality
  text: AppCopy['demo_page']
}>) => {
  const [overrides, set_overrides] = useState<Partial<AtmosphereTuning> | null>(null)
  const input_id = useId()
  const values = resolve_atmosphere_tuning(preset, overrides)
  useEffect(() => apply(overrides), [apply, overrides])
  useEffect(() => () => apply(null), [apply])
  return (
    <section className="grid gap-3 pt-3" aria-label={text.hillaire_title}>
      <h2 className="flex items-center gap-2 text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">
        <CloudFog size={12} /> {text.hillaire_title}
      </h2>
      <p className="text-[8px] leading-4 text-[#a3a5ad]">{text.hillaire_preview}</p>
      {quality === 'low' && <p className="text-[8px] leading-4 text-[#c8963c]">{text.hillaire_quality}</p>}
      {(['haze', 'ground', 'sky'] as const).map((group) => (
        <fieldset
          className="grid min-w-0 gap-3 border-t border-white/8 pt-3 disabled:opacity-40"
          disabled={quality === 'low' || (group === 'ground' && quality !== 'high')}
          key={group}
        >
          <legend className="text-[8px] tracking-[0.14em] text-[#a3a5ad] uppercase">{text[`hillaire_${group}`]}</legend>
          {Object.entries(ATMOSPHERE_CONTROLS)
            .filter(([, control]) => control.group === group)
            .map(([name, control]) => {
              const key = name as keyof AtmosphereTuning
              return (
                <label className="grid gap-1 text-[8px] text-[#a3a5ad]" htmlFor={`${input_id}-${key}`} key={key}>
                  <span className="flex justify-between gap-2">
                    <span>{text[`hillaire_${key}`]}</span>
                    <output className="text-[#d5d2cb] tabular-nums">{Number(values[key].toFixed(5))}</output>
                  </span>
                  <input
                    aria-label={text[`hillaire_${key}`]}
                    id={`${input_id}-${key}`}
                    className="h-6 w-full cursor-pointer accent-[#4a9eff] disabled:cursor-not-allowed"
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={values[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      set_overrides((current) => ({ ...current, [key]: value }))
                    }}
                  />
                </label>
              )
            })}
        </fieldset>
      ))}
      <button
        className="flex h-9 cursor-pointer items-center justify-center gap-2 border border-[#4a9eff]/30 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase disabled:opacity-30"
        disabled={overrides === null}
        onClick={() => set_overrides(null)}
        type="button"
      >
        <RotateCcw size={11} /> {text.hillaire_reset}
      </button>
    </section>
  )
}

export const AtmosphereControls = ({
  world,
  quality,
  text,
}: Readonly<{
  world: Readonly<{
    set_atmosphere: (overrides: Partial<AtmosphereTuning> | null) => void
    atmosphere_preset: Parameters<typeof resolve_atmosphere_tuning>[0]
  }> | null
  quality: EngineQuality
  text: AppCopy['demo_page']
}>) =>
  world === null ? null : (
    <AtmosphereSliders apply={world.set_atmosphere} preset={world.atmosphere_preset} quality={quality} text={text} />
  )
