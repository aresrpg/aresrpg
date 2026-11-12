// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { AuthSession } from '../../src/auth.ts'
import { create_app } from '../../src/store.ts'
import { adventure_assets_ready } from '../../src/adventure/useDemoAnalytics.ts'
import { adventure_available_inventory, ADVENTURE_INVENTORY } from '../../src/adventure/projection.ts'
import { adventure_quest, adventure_completed_quests } from '../../src/adventure/quest.ts'
import { read_adventure_choice, remember_adventure_choice, forget_adventure_choice } from '../../src/adventure/visit.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const settle_opening = (app: ReturnType<typeof create_app>, winner: bigint) => {
  const checkpoint = app.store.getState().fight.checkpoint!
  app.dispatch({
    type: 'adventure/settled',
    checkpoint: {
      ...checkpoint,
      contract: { ...checkpoint.contract, ended: true, winner, ended_ms: 10000n },
    },
  })
}

test('the victory choice waits for fight presentation, then continuation opens the earned equipment lesson once', () => {
  const app = create_app()
  const stop = app.observe(['adventure', 'fight'])
  try {
    app.dispatch({ type: 'adventure/entered' })
    app.dispatch({ type: 'adventure/choice', choice: 'play' })
    expect(app.store.getState().adventure.phase).toBe('fighting')
    settle_opening(app, 0n)
    expect(app.store.getState().adventure.phase).toBe('reward')
    app.dispatch({ type: 'fight/closed', fight: null })
    expect(app.store.getState().adventure.phase).toBe('choice')
    app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })
    expect(app.store.getState().adventure.phase).toBe('choice')
    app.dispatch({ type: 'adventure/choice', choice: 'continue' })
    const { adventure, navigation, session } = app.store.getState()
    expect(adventure.phase).toBe('explore')
    expect(adventure_quest(adventure)).toBe('equip')
    expect(adventure_available_inventory(adventure)).toEqual([...ADVENTURE_INVENTORY])
    expect(adventure.character!.loadout).toEqual({})
    expect(navigation.dialog).toBe('character_equipment')
    expect(session.wallet).toBeNull()
    app.dispatch({ type: 'fight/closed', fight: null })
    expect(app.store.getState().adventure).toBe(adventure)
  } finally {
    stop()
  }
})

test('defeat keeps encounter zero and acknowledging the result starts a fresh healthy fight', () => {
  const app = create_app()
  const stop = app.observe(['adventure', 'fight'])
  try {
    app.dispatch({ type: 'adventure/entered' })
    const initial_hp = app.store.getState().fight.checkpoint!.contract.fighters[0]!.hp
    settle_opening(app, 1n)
    app.dispatch({ type: 'fight/closed', fight: null })
    app.dispatch({ type: 'adventure/choice', choice: 'play' })
    expect(app.store.getState().adventure.phase).toBe('reward')
    expect(app.store.getState().adventure.encounter).toBe(0)
    expect(adventure_available_inventory(app.store.getState().adventure)).toEqual([])
    app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })
    const { adventure, fight } = app.store.getState()
    expect(adventure.phase).toBe('fighting')
    expect(adventure.character!.level).toBe(199)
    expect(fight.mounted).toBe(true)
    expect(fight.checkpoint!.contract.ended).toBe(false)
    expect(fight.checkpoint!.contract.fighters[0]!.hp).toBe(initial_hp)
  } finally {
    stop()
  }
})

test('Start playing preserves live requirements and waits for successful authentication', () => {
  const app = create_app()
  const stop = app.observe(['adventure', 'fight'])
  try {
    app.dispatch({ type: 'adventure/entered' })
    const { session } = app.store.getState()
    settle_opening(app, 0n)
    app.dispatch({ type: 'fight/closed', fight: null })
    app.dispatch({ type: 'adventure/choice', choice: 'play' })
    expect(app.store.getState().adventure.phase).toBe('onboarding')
    expect(app.store.getState().session).toBe(session)
    app.dispatch({ type: 'adventure/game_entered' })
    expect(app.store.getState().adventure.phase).toBe('onboarding')
    expect(adventure_completed_quests(app.store.getState().adventure)).toEqual(['goblins'])
    app.dispatch({ type: 'adventure/choice', choice: 'continue' })
    expect(app.store.getState().adventure.phase).toBe('onboarding')
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: { address: 'real-account' } as AuthSession })
    app.dispatch({ type: 'adventure/game_entered' })
    expect(app.store.getState().adventure.phase).toBe('entered')
    expect(app.store.getState().session.characters).toEqual([])
  } finally {
    stop()
  }
})

test('both saved choices restore their opening checkpoint without replaying combat or changing real characters', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  try {
    for (const choice of ['play', 'continue'] as const) {
      remember_adventure_choice(choice)
      expect(read_adventure_choice()).toBe(choice)
      const app = create_app()
      const stop = app.observe(['adventure', 'fight'])
      const { session } = app.store.getState()
      app.dispatch({ type: 'adventure/entered', choice: read_adventure_choice() })
      const { adventure, fight } = app.store.getState()
      expect(adventure.phase).toBe(choice === 'play' ? 'onboarding' : 'explore')
      expect(adventure.encounter).toBe(1)
      expect(adventure.character!.strength).toBe(397)
      expect(fight.mounted).toBe(false)
      expect(app.store.getState().session).toBe(session)
      stop()
    }
    for (const choice of ['play', 'continue'] as const) {
      const live = create_app()
      const stop = live.observe(['adventure', 'fight'])
      try {
        live.dispatch({ type: 'adventure/entered' })
        settle_opening(live, 0n)
        live.dispatch({ type: 'fight/closed', fight: null })
        live.dispatch({ type: 'adventure/choice', choice })
        expect(read_adventure_choice()).toBe(choice)
      } finally {
        stop()
      }
    }
    forget_adventure_choice()
    expect(read_adventure_choice()).toBeNull()
    remember_adventure_choice('continue')
    values.forEach((_, key) => values.set(key, 'unrecognized'))
    expect(read_adventure_choice()).toBeNull()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('direct combat loading waits for the actual fight hero rather than an absent overworld hero', () => {
  const app = create_app()
  const stop = app.observe(['adventure', 'fight'])
  try {
    app.dispatch({ type: 'adventure/entered' })
    const checkpoint = app.store.getState().fight.checkpoint!
    expect(adventure_assets_ready({ entity_height: () => null }, 'adventure_senshi', checkpoint)).toBe(false)
    const world = { entity_height: (id: string) => (id === 'fight_character_0' ? 2 : null) }
    expect(adventure_assets_ready(world, 'adventure_senshi', checkpoint)).toBe(true)
    expect(adventure_assets_ready(world, 'adventure_senshi', null)).toBe(false)
  } finally {
    stop()
  }
})

test('every supported locale supplies both choices and explains the real-game requirements', async () => {
  for (const { code } of LOCALES) {
    const { adventure } = await load_app_copy(code)
    for (const key of [
      'choice_title',
      'choice_body',
      'start_playing',
      'play_description',
      'continue_tutorial',
      'continue_description',
    ])
      expect(adventure[key]?.length).toBeGreaterThan(0)
    expect(adventure.play_description).toContain('SUI')
  }
})

test('restoring a tutorial choice is silent and early sign-in is excluded from replay', async () => {
  const { analytics_events } = await import('../../src/modules/analytics.ts')
  const { audio_snapshot, game_audio_cues } = await import('../../src/modules/audio.ts')
  const { replay_eligible } = await import('../../src/analytics/replay.ts')
  const { analytics_context } = await import('../../src/analytics/context.ts')
  for (const choice of ['play', 'continue'] as const) {
    const app = create_app()
    const before = app.store.getState()
    app.dispatch({ type: 'adventure/entered', choice })
    const after = app.store.getState()
    expect(analytics_events(after, before).some(({ name }) => name === 'demo_quest_completed')).toBe(false)
    expect(game_audio_cues(audio_snapshot(before), audio_snapshot(after))).not.toContain('quest_completed')
    expect(replay_eligible(after, '/play-demo')).toBe(choice === 'continue')
    if (choice === 'play') expect(analytics_context(after).onboarding_step).toBe('login')
  }
})
