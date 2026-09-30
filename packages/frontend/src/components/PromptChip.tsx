// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE interaction-prompt chip (one design, every "press X to…" surface): mount, fight swords,
// star gate. The ENGINE owns each element's position (CSS2D riding the frame's camera pass);
// this component only renders the content portaled into it. Per the owner's 2026-08-21 law,
// the chip's pixels have exactly one home.

import { useEffect, type ReactNode, type ComponentProps } from 'react'

import { world_keyboard_eligible } from '../game/core/world_input.ts'

/** Splits a `{{key}}` copy template into [before, after]. */
export const split_key_template = (template: string): readonly [string, string] => {
  const [before, after] = template.split('{{key}}')
  return [before ?? '', after ?? '']
}

const CHIP_CLASS =
  'flex items-center gap-1.5 rounded-xl border border-white/12 bg-bg/82 px-3 py-1.5 text-[10px] tracking-[0.18em] whitespace-nowrap text-[#e8e4dc] uppercase shadow-[0_4px_18px_rgba(0,0,0,0.45)] backdrop-blur-md'

export const PromptChip = ({
  children,
  activate,
  on_context_menu,
}: Readonly<{
  children: ReactNode
  activate?: () => void
  on_context_menu?: ComponentProps<'button'>['onContextMenu']
}>) => (
  <div className="pointer-events-none -translate-y-full">
    {activate ? (
      <button
        data-world-interaction
        type="button"
        className={`${CHIP_CLASS} pointer-events-auto min-h-11`}
        onClick={activate}
        onContextMenu={on_context_menu}
      >
        {children}
      </button>
    ) : (
      <div className={CHIP_CLASS}>{children}</div>
    )}
  </div>
)

export const PromptKey = ({ label }: Readonly<{ label: string }>) => (
  <kbd className="inline-grid min-w-[18px] place-items-center rounded-[5px] border border-white/25 border-b-2 border-b-white/40 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold text-[#f5d0a9] shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)]">
    {label}
  </kbd>
)

export const PromptText = ({
  template,
  touch_template,
  label,
}: Readonly<{ template: string; touch_template: string; label: string }>) => {
  const [before, after] = split_key_template(template)
  return (
    <>
      <span className="inline-flex items-center gap-1.5 [@media(pointer:coarse)]:hidden">
        {before.trim()}
        {template.includes('{{key}}') && <PromptKey label={label} />}
        {after.trim()}
      </span>
      <span className="hidden [@media(pointer:coarse)]:inline">{touch_template}</span>
    </>
  )
}

/** Shared hotkey admission for actionable world prompts; domain callbacks own the action. */
export const usePromptKey = ({
  enabled,
  code = 'KeyF',
  activate,
}: Readonly<{
  enabled: boolean
  code?: string
  activate: () => void | boolean
}>) => {
  useEffect(() => {
    if (!enabled) return
    const key = (event: Readonly<KeyboardEvent>) => {
      if (event.code !== code || event.repeat || !world_keyboard_eligible(event, true)) return
      if (activate() !== false) event.preventDefault()
    }
    globalThis.addEventListener('keydown', key)
    return () => globalThis.removeEventListener('keydown', key)
  }, [enabled, code, activate])
}
