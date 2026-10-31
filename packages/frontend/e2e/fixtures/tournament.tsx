// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { create_character_source, create_fight } from '@aresrpg/fight'
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'
import type { AuthSession } from '@aresrpg/sdk/auth'
import type { CharacterRow, TournamentRow } from '@aresrpg/protocol'

import AdminControls from '../../src/admin/AdminControls.tsx'
import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { on_gas_empty } from '../../src/toast.ts'
import { WorldChat } from '../../src/components/Chat.tsx'
import { GamePageWindow } from '../../src/components/GamePageWindow.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import type { Locale } from '../../src/i18n/locale.ts'
import { dispatch_app, observe_app, read_app_state, useAppStore } from '../../src/store.ts'
import { action_key } from '../../src/modules/tournament.ts'
import { FightResultCard } from '../../src/game/fight/FightResultCard.tsx'
import { TournamentRewards } from '../../src/tournament/TournamentRewards.tsx'
import { audio_playback_revision } from '../../src/game/audio/audio_registry.ts'
import '../../src/tailwind.css'
import '../../src/game/hud/world_responsive.css'
import '@aresrpg/ui/styles.css'

import { NOW, tournament_scenario } from './tournament_scenarios.ts'

const params = new URLSearchParams(location.search)
const scenario =
  params.get('scenario') ?? (params.has('live') ? 'live8' : params.has('expired') ? 'expired' : 'open_funded')
const admin = params.has('admin') || scenario === 'admin_start'
const hud = params.has('hud')
const locale = (params.get('locale') ?? 'en') as Locale
const scenario_data = tournament_scenario(scenario)
let { rows } = scenario_data
const { characters } = scenario_data
const calls: unknown[] = []
let complete: (() => void) | null = null
const record = (kind: string, args: unknown) => {
  calls.push({ kind, args })
  document.body.dataset.calls = JSON.stringify(calls, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
  const receipt = params.has('rewards')
    ? {
        $kind: 'Transaction',
        Transaction: { digest: `fixture-${calls.length}`, effects: { status: { success: true } } },
      }
    : {}
  if (params.has('failure'))
    return Promise.reject(
      new Error(params.has('funding') ? 'gas selection: insufficient SUI balance' : 'Insufficient gas balance')
    )
  if (params.has('pending'))
    return new Promise((resolve) => {
      complete = () => resolve(receipt)
    })
  return Promise.resolve(receipt)
}
const wallet = {
  address: 'owner',
  is_transaction_idle: () => true,
  derive_character_id: (name: string) => `character-${name}`,
  tournament: {
    start: (id: string) => record('start', { id }),
    donate: (id: string, asset: string, amount: bigint) => record('donate', { id, asset, amount }),
    join_team: (args: unknown) => record('join', args),
    create_team: (args: unknown) => record('create', args),
    leave_team: (tournament: string, team: number, character: string) =>
      record('leave', { tournament, team, character }),
    expire: (id: string, pool: string | null) => record('expire', { id, pool }),
    open: (args: unknown) => record('open', args),
    join: (args: unknown) => record('enter', args),
    crank: (args: unknown) => record('crank', args),
    crank_unopened: (tournament: string, index: number) => record('crank_unopened', { tournament, index }),
    claim_coins: (id: string, team: number, seat: number, assets: unknown) =>
      record('coins', { id, team, seat, assets }),
    claim_item: (args: unknown) => record('item', args),
    refund_kares: (id: string, pool: string) => record('refund', { id, pool }),
  },
} as unknown as AuthSession
const copy = await load_app_copy(locale)
dispatch_app({ type: 'locale/changed', locale })
dispatch_app({ type: 'locale/loaded', locale, copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: wallet })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [...characters] } })
if (params.has('admin')) rows = []
const publish = () => dispatch_app({ type: 'server/packet', packet: { type: 'packet/tournaments', tournaments: rows } })
if (scenario !== 'loading') publish()
if (scenario === 'unavailable')
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/tournaments_error', reason: 'unavailable' } })
if (admin)
  dispatch_app({ type: 'external_wallet/connected', sequence: 0, session: { ...wallet, wallet_name: 'Fixture' } })
const base_time = performance.now()
const tick = () =>
  dispatch_app({
    type: 'clock/observed',
    chain_ms: NOW + Math.floor(performance.now() - base_time),
    received_ms: performance.now(),
  })
if (params.has('stale_clock'))
  dispatch_app({ type: 'clock/observed', chain_ms: NOW, received_ms: performance.now() - 16_000 })
else if (!params.has('unknown_clock')) tick()
const timer = params.has('stale_clock') || params.has('unknown_clock') ? null : setInterval(tick, 5000)
if (scenario === 'timeout') {
  const fight = create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      fight_id: 'fight-1',
      world: 'nauvis',
      board_seed: 17n,
      spells: {},
      mobs: [],
      players: ['hero', 'enemy'].map((id, index) => ({
        character: id,
        owner: index === 0 ? 'owner' : 'other',
        team: BigInt(index),
        hp: 55n,
        source: create_character_source({ name: id, classe: 'senshi', level: 1n }),
      })),
    },
  })
  dispatch_app({ type: 'fight/cached', checkpoint: fight.state() })
  dispatch_app({ type: 'character/select', character_id: 'hero' })
}
if (!hud && !admin) dispatch_app({ type: 'page/open', page: 'kolizeum' })
if (scenario === 'entry_failure') {
  const entry = { id: 'cup', index: 1, character: 'hero', version: '7' }
  dispatch_app({
    type: 'tournament/entry_result',
    key: action_key(rows[0], { kind: 'enter', index: 1, character: 'hero' }),
    entry,
    reason: 'Insufficient gas balance',
  })
}
observe_app(['tournament'])
window.addEventListener(
  'pagehide',
  () => {
    if (timer) clearInterval(timer)
  },
  { once: true }
)
Object.assign(window, {
  tournament_fixture: {
    combat_results: () => {
      const checkpoint = create_fight({
        mode: 'local',
        seed: 17n,
        setup: {
          fight_id: 'final-fight',
          world: 'tournament',
          board_seed: 17n,
          mobs: [],
          players: ['hero', 'teammate', 'enemy'].map((character, index) => ({
            character,
            owner: index < 2 ? 'owner' : 'other',
            team: index < 2 ? 0n : 1n,
            hp: 55n,
            source: create_character_source({ name: character, classe: 'senshi', level: 1n }),
          })),
        },
      }).state()
      const ended = { ...checkpoint, contract: { ...checkpoint.contract, ended: true, winner: 0n } }
      dispatch_app({ type: 'character/select', character_id: 'hero' })
      for (const character_id of ['hero', 'teammate']) {
        dispatch_app({
          type: 'fight_result/checkpoint',
          character_id,
          checkpoint: ended,
          observed_at_ms: NOW,
          gas_spent_mist: 0n,
        })
        dispatch_app({ type: 'fight_result/settled', character_id, fight: 'final-fight', paid_mist: null })
      }
    },
    complete: () => complete?.(),
    publish,
    empty: () => {
      rows = []
      publish()
    },
    close_feature: () => dispatch_app({ type: 'page/open', page: 'world' }),
    close_funding: () => dispatch_app({ type: 'funding/close' }),
    urgent: () => window.dispatchEvent(new Event('tournament-urgent')),
    state: () => ({
      page: read_app_state().navigation.page,
      pathname: read_app_state().navigation.pathname,
      fight_mounted: read_app_state().fight.mounted,
      pending: read_app_state().tournament.pending,
      collections: read_app_state().tournament.collections.length,
      audio: audio_playback_revision(),
    }),
    finish: () => {
      rows = [
        {
          ...tournament_scenario('finished').rows[0]!,
          version: String(BigInt(rows[0]!.version) + 1n),
          finished_at_ms: NOW,
        },
      ]
      publish()
    },
    claimed: () => {
      rows = rows.map((row) => ({
        ...row,
        version: String(BigInt(row.version) + 1n),
        teams: row.teams.map((team) => ({
          ...team,
          seats: team.seats.map((seat) => ({ ...seat, sui_claimed: true, token_claimed: true, items_claimed: '1023' })),
        })),
      }))
      publish()
    },
    busy: (busy: boolean) => dispatch_app({ type: 'dialog/open', dialog: busy ? 'travel' : null }),
    character: (patch: Partial<CharacterRow>) => {
      const { session } = read_app_state()
      dispatch_app({
        type: 'server/packet',
        packet: {
          type: 'packet/characters',
          characters: session.characters.map((row) =>
            row.id === session.selected_character_id ? { ...row, ...patch } : row
          ),
        },
      })
    },
    update: (patch: Partial<TournamentRow>) => {
      rows = [{ ...rows[0], ...patch }, ...rows.slice(1)]
      publish()
    },
    disconnect: () => dispatch_app({ type: 'link/failed', error: 'offline' }),
    clock: (chain_ms: number, received_ms = performance.now()) => {
      if (timer) clearInterval(timer)
      dispatch_app({ type: 'clock/observed', chain_ms, received_ms })
    },
  },
})
if (params.has('funding')) on_gas_empty(() => dispatch_app({ type: 'dialog/open', dialog: 'top_up' }))
const FundingProbe = () => {
  const open = useAppStore((state) => state.navigation.funding_cost_mist !== null)
  const [urgent, set_urgent] = useState(false)
  useEffect(() => {
    const show = () => set_urgent(true)
    window.addEventListener('tournament-urgent', show)
    return () => window.removeEventListener('tournament-urgent', show)
  }, [])
  return (
    <>
      {open && (
        <AddFundsModal
          copy={copy}
          address="0x1"
          network="mainnet"
          on_close={() => dispatch_app({ type: 'funding/close' })}
        />
      )}
      {urgent && (
        <NativeModal label="Newer dialog" close={() => set_urgent(false)} className="aui-modal-scrim">
          <Button onClick={() => set_urgent(false)}>Close newer dialog</Button>
        </NativeModal>
      )}
    </>
  )
}
const close = () => {
  document.body.dataset.closed = 'true'
}
createRoot(document.getElementById('root')!).render(
  <LocaleScope locale={locale}>
    <main
      data-world-frame=""
      style={{
        width: '100vw',
        height: '100dvh',
        position: 'relative',
        containerType: 'size',
        background: 'var(--aui-bg)',
      }}
    >
      {hud ? (
        <>
          <WorldChat copy={copy} />
          <GamePageWindow copy={copy} />
        </>
      ) : admin ? (
        <NativeModal label={copy.tournament_page.admin} close={close} className="aui-modal-scrim">
          <GameWindow
            title={copy.tournament_page.admin}
            meta={<AdminControls />}
            close={close}
            close_label={copy.wallet_close}
            className="aui-feature-port aui-live-page aui-admin-port"
          >
            <div className="aui-live-page-content aui-workspace-main" />
          </GameWindow>
        </NativeModal>
      ) : (
        <GamePageWindow copy={copy} />
      )}
      {params.has('funding') && <FundingProbe />}
      <FightResultCard copy={copy} />
      <TournamentRewards />
    </main>
  </LocaleScope>
)
