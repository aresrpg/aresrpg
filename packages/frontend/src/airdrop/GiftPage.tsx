// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { Button, GameWindow, CarvedIcon } from '@aresrpg/ui'
import { Volume2, VolumeX } from 'lucide-react'

import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { items_by_type } from '../content/items.ts'
import { item_icon } from '../content/assets.ts'
import { useBoxAnimation } from '../characters/useBoxAnimation.ts'
import { dispose_audio, sync_audio_volumes } from '../game/audio/audio_registry.ts'
import { observe_interface_audio } from '../game/audio/interface_audio.ts'
import { master_volume_from, set_master_audio_volume } from '../game/core/audio_volume.ts'
import { SETTINGS_STORAGE_KEY } from '../game/core/settings_storage.ts'

import { gift_content } from './gift_content.ts'
import { clear_gift_intent } from './gift_intent.ts'
import type { GiftRuntime } from './gift_runtime.ts'
import { GiftActions } from './GiftActions.tsx'
import { GiftScene } from './GiftScene.tsx'
import { gift_presentation } from './gift_presentation.ts'
import '../characters/box_reveal.css'
import './gift.css'

const saved_volume = (): number => {
  try {
    const source = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY)
    return master_volume_from(source ? (JSON.parse(source) as { master_volume?: number }).master_volume : 1)
  } catch (error) {
    console.warn('Saved audio volume is unavailable.', error)
    return 1
  }
}

const GiftContents = ({ content, text }: Readonly<{ content: ReturnType<typeof gift_content>; text: CopyText }>) => (
  <section className="gift-contents" aria-label={text('contents_title')}>
    <div className="gift-contents-heading">
      <strong>{text('contents_title')}</strong>
      <span>{text('contents_count', { count: content.rewards.length })}</span>
    </div>
    <div className="gift-possibilities">
      {content.rewards.map(({ item_type }) => (
        <div className="gift-possible" key={item_type}>
          <img src={item_icon(item_type) ?? undefined} alt="" loading="lazy" />
          <small>{items_by_type[item_type]?.name}</small>
        </div>
      ))}
    </div>
    <small>{text('contents_note')}</small>
  </section>
)

export const GiftPage = ({ runtime, copy }: Readonly<{ runtime: GiftRuntime; copy: AppCopy }>) => {
  const state = useStore(runtime.store)
  const text = copy_text(copy.gift_page)
  const content = useMemo(gift_content, [])
  const roll = content.reward(state.status)
  const animation = useBoxAnimation(state.celebrate && roll ? roll.claim_id : null, content.box.item_type)
  const view = gift_presentation(state)
  const volume = useMemo(saved_volume, [])
  const phase = !state.celebrate && roll ? 'reveal' : animation.phase
  const enter_game = (): void => {
    clear_gift_intent()
    globalThis.location.assign('/')
  }
  useEffect(() => runtime.observe(), [runtime])
  useEffect(() => {
    const controller = new AbortController()
    observe_interface_audio(controller.signal)
    return () => {
      controller.abort()
      dispose_audio()
    }
  }, [])
  useEffect(() => {
    set_master_audio_volume(state.muted ? 0 : volume)
    sync_audio_volumes()
  }, [state.muted, volume])
  useEffect(() => {
    if (state.celebrate && animation.phase === 'reveal') runtime.dispatch({ type: 'celebrated' })
  }, [state.celebrate, animation.phase, runtime])
  return (
    <main className="gift-page" data-gift-onboarding="">
      <header className="gift-masthead">
        <div className="gift-brand">
          <img src="/logo-192.png" alt="" />
          <strong>AresRPG</strong>
        </div>
        <span>{content.campaign.name}</span>
        <Button
          onClick={() => runtime.dispatch({ type: 'mute' })}
          aria-pressed={state.muted}
          aria-label={text(state.muted ? 'sound_on' : 'sound_off')}
        >
          {state.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </Button>
      </header>
      <GameWindow
        title={text('window_title')}
        icon={<CarvedIcon name="airdrop" />}
        close={null}
        close_label={copy.wallet_close}
        className="gift-window"
      >
        <nav className="gift-journey" aria-label={text('window_title')}>
          {['step_claim', 'step_open', 'step_play'].map((key, index) => (
            <span
              key={key}
              className={index === view.step ? 'active' : index < view.step ? 'done' : ''}
              aria-current={index === view.step ? 'step' : undefined}
            >
              <b>{index + 1}</b>
              {text(key)}
            </span>
          ))}
        </nav>
        <GiftScene view={view} state={state} content={content} roll={roll} phase={phase} copy={copy} text={text} />
        <GiftActions view={view} state={state} runtime={runtime} text={text} enter={enter_game} />
        {view.contents && <GiftContents content={content} text={text} />}
      </GameWindow>
    </main>
  )
}
