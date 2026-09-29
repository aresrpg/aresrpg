// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import './game/hud/world_responsive.css'

import { useSyncExternalStore } from 'react'
import { MAX_TRACKED_CHARACTERS } from '@aresrpg/protocol'
import type { CharacterCreateInput } from '@aresrpg/sdk/character'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { Check, Copy } from 'lucide-react'
import { useCallback, useRef, useState, type ComponentType } from 'react'
import { ThinkingOrb } from 'thinking-orbs'

import { read_scene, subscribe_scene } from './game/core/scene_feed.ts'
import { WorldLoading } from './components/WorldLoading.tsx'
import {
  character_creation_failure_message,
  character_creation_funding_text,
  character_creation_insufficient,
} from './character_creation_funding.ts'
import { CrushResultModal } from './characters/CrushResultModal.tsx'
import { Login } from './components/Login.tsx'
import { AddFundsModal } from './components/AddFundsModal.tsx'
import {
  CANVAS_OVERLAY_CLASS,
  dungeon_lobby_visible,
  graphics_notice_visible,
  WORLD_FRAME_LAYER,
} from './components/app_layout.ts'
import { CharacterCreateModal } from './components/CharacterCreateModal.tsx'
import { CityArrivalBanner } from './components/CityArrivalBanner.tsx'
import { DungeonLobby } from './components/DungeonLobby.tsx'
import { engine_notice_kind, EngineNotice } from './components/EngineNotice.tsx'
import { SessionIndexingCatchup } from './components/IndexingCatchupModal.tsx'
import { PlayerContextMenu } from './components/PlayerContextMenu.tsx'
import { Toasts } from './components/Toasts.tsx'
import { TravelModal } from './components/TravelModal.tsx'
import { worlds_source } from './content/worlds.ts'
import { env } from './env.ts'
import { BiomeMusic } from './game/audio/BiomeMusic.tsx'
import { FightLevelUpCard, FightResultCard } from './game/fight/FightResultCard.tsx'
import { BackgroundGatherProgress } from './game/hud/GatherProgress.tsx'
import { MobInspectionOverlay } from './game/hud/MobInspectionOverlay.tsx'
import { JobLevelUpCard } from './game/jobs/JobLevelUpCard.tsx'
import { type AppCopy } from './i18n/copy.ts'
import type { Locale } from './i18n/locale.ts'
import { LocaleScope } from './i18n/LocaleScope.tsx'
import { useNumbers } from './i18n/useNumbers.ts'
import { JourneyHost } from './journey/JourneyHost.tsx'
import { selected_dungeon_run } from './modules/dungeon.ts'
import { type Page } from './modules/navigation.ts'
import type { PlayerShellProps } from './player_presentation.ts'
import { dispatch_app, useAppStore } from './store.ts'
import { toast } from './toast.ts'
import { TutorialHost } from './tutorial/TutorialHost.tsx'

const city_arrival_active = (in_app: boolean, page: Page, fight_active: boolean, dungeon_active: boolean): boolean =>
  in_app && page === 'world' && !fight_active && !dungeon_active

const Welcome = ({
  copy,
  create,
  funding_address,
}: Readonly<{ copy: AppCopy; create: () => void; funding_address: string | null }>) => {
  const localized_numbers = useNumbers()
  const [copied, set_copied] = useState(false)
  const copy_address = (): void => {
    if (!funding_address) return
    void navigator.clipboard.writeText(funding_address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }
  return (
    <section className="absolute inset-0 z-[140] grid place-items-center bg-bg/34 p-5 backdrop-blur-[3px]">
      <div className="w-full max-w-xl border border-white/10 border-t-[#c8963c] bg-bg/94 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <p className="mb-3 text-[8px] tracking-[0.28em] text-[#c8963c] uppercase">AresRPG</p>
        <h2 className="text-xl font-semibold tracking-[0.06em]">{copy.welcome_title}</h2>
        <p className="mt-4 text-[11px] leading-6 text-[#9da0a9]">{copy.welcome_body}</p>
        {funding_address && (
          <div className="mt-5 border border-[#c8963c]/35 bg-[#c8963c]/6 p-4">
            <p className="text-[11px] leading-6 text-[#d9af57]">
              {character_creation_funding_text(copy.welcome_need_sui, localized_numbers.sui).replaceAll(
                '{{price}}',
                localized_numbers.sui(CHARACTER_PRICE_MIST, 0)
              )}
            </p>
            <div className="mt-3 flex items-center gap-2 border border-white/10 bg-black/30 px-3 py-2">
              <span className="min-w-0 flex-1 font-mono text-[10px] break-all text-[#c8963c] select-all">
                {funding_address}
              </span>
              <button
                aria-label={copy.wallet_copy_address}
                className="shrink-0 cursor-pointer opacity-55 hover:opacity-95"
                onClick={copy_address}
                type="button"
              >
                {copied ? <Check className="text-emerald-400" size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>
        )}
        <button
          className="mt-7 h-11 cursor-pointer border border-[#4a9eff]/40 bg-[#4a9eff]/8 px-6 text-[9px] tracking-[0.18em] text-[#67adff] uppercase hover:border-[#4a9eff]/70 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-[#5a5e68]"
          disabled={!!funding_address}
          onClick={create}
          type="button"
        >
          {copy.create_character}
        </button>
      </div>
    </section>
  )
}

export function PlayerRuntime({
  Shell,
  WorldHud,
  WorldStatus,
}: Readonly<{
  Shell: ComponentType<PlayerShellProps>
  WorldHud: ComponentType<Readonly<{ copy: AppCopy }>>
  WorldStatus?: ComponentType<Readonly<{ copy: AppCopy }>>
}>) {
  const loading_scene = useSyncExternalStore(subscribe_scene, read_scene, read_scene)
  const session = useAppStore(({ session }) => session)
  const navigation = useAppStore(({ navigation }) => navigation)
  const settings = useAppStore((state) => state.settings)
  const locale = useAppStore((state) => state.locale)
  const copy = useAppStore((state) => state.copy)
  const engine_status = useAppStore((state) => state.engine)
  const fight_active = useAppStore(({ fight }) => fight.mounted)
  const dungeon_active = useAppStore((state) => selected_dungeon_run(state) !== null)
  const dungeon_lobby_open = dungeon_lobby_visible(navigation.page, fight_active, dungeon_active)
  const { wallet } = session
  const [show_wallets, set_show_wallets] = useState(false)
  const [graphics_notice_dismissed, set_graphics_notice_dismissed] = useState<string | null>(null)
  const attached_canvas = useRef<HTMLCanvasElement | null>(null)
  const in_app = !!wallet
  /* eslint-disable functional/prefer-immutable-types, functional/immutable-data -- React owns this mutable DOM ref; the engine needs the real canvas element. */
  const attach_canvas = useCallback((canvas: HTMLCanvasElement | null): void => {
    const previous = attached_canvas.current
    if (previous === canvas) return
    attached_canvas.current = canvas
    if (previous) dispatch_app({ type: 'engine/canvas_detached', canvas: previous })
    if (canvas) dispatch_app({ type: 'engine/canvas_attached', canvas })
  }, [])
  /* eslint-enable functional/prefer-immutable-types, functional/immutable-data */

  const change_locale = useCallback(
    (next_locale: Locale): void => dispatch_app({ type: 'locale/changed', locale: next_locale }),
    []
  )
  const disconnect = useCallback((): void => dispatch_app({ type: 'auth/disconnected' }), [])
  const open_page = useCallback((page: Page): void => dispatch_app({ type: 'page/open', page }), [])
  const open_path = useCallback((pathname: string): void => dispatch_app({ type: 'path/open', pathname }), [])
  const select_character = useCallback(
    (character_id: string): void => dispatch_app({ type: 'character/select', character_id }),
    []
  )
  const create_character = useCallback(
    async (character: CharacterCreateInput): Promise<void> => {
      if (!wallet) throw new Error('The wallet session is unavailable')
      if (session.characters.length >= MAX_TRACKED_CHARACTERS) return
      dispatch_app({ type: 'character/creation_started', wallet })
      const pending = toast.loading(copy?.creating_character ?? 'Creating character…')
      try {
        const first_world = worlds_source[0]?.world
        if (!first_world) throw new Error('No authored world is available')
        const receipt = await wallet.create_character(character, first_world)
        dispatch_app({ type: 'character/creation_confirmed', wallet, digest: receipt.digest })
        pending.success(copy?.character_created ?? 'Character created')
        dispatch_app({ type: 'dialog/open', dialog: null })
        dispatch_app({ type: 'wallet/refresh' })
      } catch (error) {
        dispatch_app({ type: 'character/creation_failed', wallet })
        pending.error(character_creation_failure_message(error, copy, locale))
        dispatch_app({ type: 'wallet/refresh' })
        throw error
      }
    },
    [copy, locale, session.characters.length, wallet]
  )
  const sui_insufficient = character_creation_insufficient(session.sui_balance_mist)
  const notice_kind = engine_notice_kind(engine_status, engine_status.recovery === 'minimum')
  const show_graphics_notice = graphics_notice_visible(
    false,
    notice_kind === 'failed',
    notice_kind === 'world',
    graphics_notice_dismissed === notice_kind,
    notice_kind !== null
  )
  const loading_universe = session.auth_status === 'connecting' || (in_app && !session.roster_loaded)
  if (!copy) return <main className="fixed inset-0 bg-bg" />

  return (
    <LocaleScope locale={locale}>
      <main className="app-ui fixed inset-0 overflow-hidden bg-bg font-mono text-[#e8e4dc]">
        {in_app && (
          <>
            <div
              data-world-frame=""
              className={`fixed overflow-hidden transition-opacity duration-150 ${WORLD_FRAME_LAYER} app-world-frame rounded-[14px] shadow-[0_18px_50px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04)]`}
            >
              <BiomeMusic />
              <CityArrivalBanner
                active={city_arrival_active(in_app, navigation.page, fight_active, dungeon_active)}
                copy={copy}
              />
              <canvas
                key={engine_status.recovery}
                ref={attach_canvas}
                className="absolute inset-0 size-full touch-none"
              />

              <WorldLoading
                source={loading_scene}
                quality={settings.quality}
                render_distance={settings.render_distance}
              />

              {!fight_active && !dungeon_active && (
                <div className={`${CANVAS_OVERLAY_CLASS} z-[105]`}>
                  <WorldHud copy={copy} />
                </div>
              )}
              {dungeon_lobby_open && (
                <div className={`${CANVAS_OVERLAY_CLASS} z-[105]`}>
                  <DungeonLobby key={session.selected_character_id} copy={copy} />
                </div>
              )}
              {WorldStatus && (
                <div className={`${CANVAS_OVERLAY_CLASS} z-[110]`}>
                  <WorldStatus copy={copy} />
                </div>
              )}

              {loading_universe && (
                <div className={`${CANVAS_OVERLAY_CLASS} z-[130] bg-bg/35 backdrop-blur-[9px]`}>
                  <div className="absolute inset-0 grid place-items-center">
                    <ThinkingOrb aria-label={copy.loading_universe} size={64} state="connecting" theme="dark" />
                  </div>
                </div>
              )}
              {navigation.page === 'world' && navigation.dialog === 'welcome' && (
                <Welcome
                  copy={copy}
                  create={() => dispatch_app({ type: 'dialog/open', dialog: 'character_create' })}
                  funding_address={sui_insufficient && wallet ? wallet.address : null}
                />
              )}
              {
                <>
                  <FightResultCard copy={copy} />
                  <FightLevelUpCard copy={copy} />
                </>
              }
              <JobLevelUpCard copy={copy} />
              <MobInspectionOverlay copy={copy} />
            </div>
            {
              <div className="pointer-events-none fixed inset-0 z-[100] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(200,150,60,0.014)_2px,rgba(200,150,60,0.014)_4px)]" />
            }
          </>
        )}
        <PlayerContextMenu copy={copy} />
        <JourneyHost copy={copy} />
        {in_app && wallet && navigation.dialog === 'top_up' && (
          <AddFundsModal
            address={wallet.address}
            copy={copy}
            on_close={() => dispatch_app({ type: 'dialog/open', dialog: null })}
            warning={copy.out_of_sui_body}
          />
        )}
        {in_app &&
          navigation.page === 'world' &&
          navigation.dialog === 'character_create' &&
          session.characters.length < MAX_TRACKED_CHARACTERS && (
            <CharacterCreateModal
              cancel={() =>
                dispatch_app({ type: 'dialog/open', dialog: session.characters.length === 0 ? 'welcome' : null })
              }
              copy={copy}
              create={create_character}
              insufficient={sui_insufficient}
              view_spells={(classe) => {
                open_path(`/encyclopedia/classes/${encodeURIComponent(classe)}`)
              }}
            />
          )}
        {in_app && navigation.dialog === 'travel' && <TravelModal copy={copy} />}
        <Toasts />
        <BackgroundGatherProgress copy={copy} />
        <CrushResultModal copy={copy} />
        <SessionIndexingCatchup copy={copy} indexing_lag={session.indexing_lag} status={session.link_status} />

        {show_graphics_notice && (
          <EngineNotice
            copy={copy}
            status={engine_status}
            minimum_graphics={notice_kind === 'minimum'}
            dismiss={() => set_graphics_notice_dismissed(notice_kind)}
            reload={() => globalThis.location.reload()}
          />
        )}

        {!session.wallet && (
          <Login
            auth_ready={session.auth_ready}
            wallets={session.wallets}
            copy={copy}
            gift={navigation.page === 'airdrop'}
            login_google={() => dispatch_app({ type: 'auth/login_google' })}
            login_wallet={(name) => dispatch_app({ type: 'auth/login_wallet', name })}
            set_show_wallets={set_show_wallets}
            show_wallets={show_wallets}
          />
        )}

        {session.wallet && (
          <>
            <Shell
              change_locale={change_locale}
              copy={copy}
              create_character={() => dispatch_app({ type: 'dialog/open', dialog: 'character_create' })}
              disconnect={disconnect}
              locale={locale}
              network={env.network}
              open_page={open_page}
              open_path={open_path}
              page={navigation.page}
              pathname={navigation.pathname}
              select_character={select_character}
              session={session}
              settings={settings}
            />
            <TutorialHost blocked={show_graphics_notice} copy={copy} />
          </>
        )}
      </main>
    </LocaleScope>
  )
}
