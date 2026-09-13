// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useRef } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { JourneyPanel } from './JourneyPanel.tsx'

export const JourneyHost = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const journey = useAppStore((state) => state.journey)
  const unobstructed = useAppStore(
    (state) =>
      state.navigation.dialog === null &&
      !state.fight.mounted &&
      state.settings.completed_tutorials?.includes('world') === true &&
      !Object.values(state.fight_result.current_by_character).some(
        ({ result_open, level_up_open }) => result_open || level_up_open
      ) &&
      !state.job_level_up.current
  )
  const visible = useAppStore((state) => state.navigation.page === 'world' || state.journey.journal_open)
  const played = useRef<string | null>(null)
  const [celebration] = journey.celebrations
  const sound_key = celebration ? `${journey.identity}:${journey.generation}:${celebration}` : null
  useEffect(() => {
    if (journey.saving || !unobstructed || !visible || !sound_key || played.current === sound_key) return
    // eslint-disable-next-line functional/immutable-data -- presentation-only ref prevents replay when the journal opens.
    played.current = sound_key
    play_procedural_cue('level_up')
  }, [journey.saving, sound_key, unobstructed, visible])
  if (!journey.journal_open || !journey.ready) return null
  const text = copy_text(copy.journey)
  return (
    <ModalFrame
      close={() => dispatch_app({ type: 'journey/journal', open: false })}
      close_label={text('close')}
      label={text('title')}
      max_width="max-w-2xl"
      soft
    >
      <JourneyPanel compact={false} copy={copy} />
    </ModalFrame>
  )
}
