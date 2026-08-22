// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/* eslint-disable functional/prefer-immutable-types -- React lifecycle boundary. */
import { useEffect } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { selected_character } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { NametagCard } from './NametagCard.tsx'
import { PromptKey, split_key_template } from './PromptChip.tsx'

export const AmbushPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const ambush = useAppStore((state) => selected_character(state.session)?.ambush ?? null)
  useEffect(() => {
    if (!ambush) return
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyE' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return
      event.preventDefault()
      dispatch_app({ type: 'world/resolve_ambush' })
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [ambush])
  if (!ambush) return null
  const text = copy_text(copy.world_hud)
  const [before, after] = split_key_template(text('resource_face_protector'))
  return (
    <div className="pointer-events-none absolute top-[98px] left-1/2 z-20 -translate-x-1/2 translate-y-full">
      <NametagCard
        name={text('resource_ambush_title')}
        lines={[
          {
            key: 'press',
            text: (
              <span className="inline-flex items-center gap-1.5">
                {before.trim()}
                <PromptKey label="E" />
                {after.trim()}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}
