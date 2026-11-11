// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { LIFECYCLE_WORLD } from '../../../engine/test/browser_lifecycle.ts'
import { TouchControls } from '../../../mobile/src/TouchControls.tsx'
import { create_world } from '../../src/game/core/world.ts'
import { load_character_appearance, world_character_entity } from '../../src/game/character_entities.ts'
import { read_pose, read_displayed_pose } from '../../src/game/core/pose_feed.ts'
import { AgentSpectator } from '../../src/agents/AgentSpectator.tsx'
import { dispatch_app, read_app_state, initialize_app_store, useAppStore } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import type { AuthSession } from '../../src/auth.ts'
import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'
import '../../src/game/hud/world_responsive.css'

const ObservationHud = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore((state) => state.session.wallet)
  const cost_mist = useAppStore((state) => state.navigation.funding_cost_mist)
  return (
    <>
      <AgentSpectator copy={copy} />
      {wallet && cost_mist !== null && (
        <AddFundsModal
          key={wallet.address}
          address={wallet.address}
          copy={copy}
          cost_mist={cost_mist}
          on_close={() => dispatch_app({ type: 'funding/close' })}
        />
      )}
    </>
  )
}

const boot = async () => {
  initialize_app_store({ quality: 'low', render_distance: 1, music_enabled: false })
  const copy = await load_app_copy('en')
  dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session: { address: 'human' } as AuthSession })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  dispatch_app({
    type: 'agent/watch',
    observation: {
      pairing: { address: 'agent', multisig_public_key: 'key', signer_mode: 'disposable' },
      public_identifier: 'google',
      character_id: 'remote',
    },
  })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: read_app_state().session.agent_view.serial,
      characters: [
        {
          ...character(),
          id: 'remote',
          name: 'Watched agent',
          sex: 'female',
          color_1: 0xf3eadb,
          color_2: 0x7755bb,
          color_3: 0xddbb55,
        },
      ],
      selected_character_id: 'remote',
      failed: false,
    },
  })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/party',
      character_id: 'remote',
      party: {
        id: 'party',
        members: [
          { character_id: 'remote', name: 'Watched agent' },
          { character_id: 'ally', name: 'Companion' },
        ],
        invited: [{ character_id: 'invite', name: 'Invitee' }],
      },
    },
  })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/server_info',
      online: 7,
      online_characters: 12,
      indexing_lag: 0,
      current_epoch: null,
      chain_timestamp_ms: null,
      chain_sample_age_ms: null,
    },
  })
  window.addEventListener('rewatch', () =>
    dispatch_app({ type: 'agent/watch', observation: read_app_state().session.agent_view.request })
  )
  window.addEventListener('disconnect', () => dispatch_app({ type: 'auth/disconnected' }))
  const world = create_world({
    canvas: document.querySelector('canvas')!,
    world: LIFECYCLE_WORLD,
    quality: 'low',
    render_distance: 1,
    initial_focus: [0, 0],
  })
  world.set_audio_volume(0)
  const appearance = await load_character_appearance({
    id: 'own',
    classe: 'senshi',
    male: false,
    colors: ['#f3eadb', '#7755bb', '#ddbb55'],
    loadout: {},
  })
  const position = { x: 0, y: world.ground_height(0, 0), z: 0 }
  const watch = () => {
    world.set_character(null)
    world.set_entities([
      world_character_entity(
        { id: 'remote', appearance },
        { position: [position.x, position.y, position.z], facing_yaw: 0, anim: 'IDLE', gait_scale: 1 }
      ),
    ])
    world.observe_character({ id: 'remote', position: [position.x, position.y, position.z] })
    world.set_interactive(true, false)
    document.body.dataset.mode = 'observed'
  }
  const own = () => {
    world.observe_character(null)
    world.set_entities([])
    world.set_character({ id: 'own', appearance })
    world.point_at(position)
    world.set_interactive(true, true)
    document.body.dataset.mode = 'owned'
  }
  watch()
  world.set_active(true)
  window.addEventListener('observe', watch)
  window.addEventListener('own', own)
  window.addEventListener('probe', () => {
    document.body.dataset.pose = JSON.stringify(read_pose())
    document.body.dataset.displayed_pose = JSON.stringify(read_displayed_pose())
    document.body.dataset.dialog = String(read_app_state().navigation.dialog)
    document.body.dataset.run = String(read_app_state().run_to.run)
    document.body.dataset.ready = String(world.state().render.settled)
    document.body.dataset.remote = String(world.entity_height('remote') !== null)
  })
  createRoot(document.getElementById('controls')!).render(
    new URLSearchParams(location.search).has('hud') ? (
      <ObservationHud copy={copy} />
    ) : (
      <TouchControls copy={copy} device={{ set_movement: world.set_movement, set_jump: world.set_jump }} />
    )
  )
  window.addEventListener('party-empty', () =>
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/party', character_id: 'remote', party: null } })
  )
  window.addEventListener('pagehide', () => world.dispose(), { once: true })
}
void boot().catch(console.error)
