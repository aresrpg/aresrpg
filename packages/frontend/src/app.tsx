// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity -- the app root explicitly composes mutually exclusive route surfaces. */

import { effective_flattened, type EngineQuality } from '@aresrpg/engine'
import type { CharacterCreateInput } from '@aresrpg/sdk/character'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { MAX_TRACKED_CHARACTERS } from '@aresrpg/protocol'
import { Check, Copy } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { ThinkingOrb } from 'thinking-orbs'

import { AddFundsModal } from './components/AddFundsModal.tsx'
import { AppShell } from './components/AppShell.tsx'
import {
  CANVAS_OVERLAY_CLASS,
  dungeon_lobby_visible,
  graphics_notice_visible,
  social_hud_visible,
  WORLD_FRAME_LAYER,
  world_frame_visibility,
} from './components/app_layout.ts'
import { CharacterCreateModal } from './components/CharacterCreateModal.tsx'
import { WorldChat } from './components/Chat.tsx'
import { CompassStrip } from './game/hud/CompassStrip.tsx'
import { RunToProgress } from './game/hud/RunToProgress.tsx'
import { Minimap } from './game/hud/Minimap.tsx'
import { OverworldVitals } from './game/hud/OverworldVitals.tsx'
import { fight_access_from } from './game/core/settings.ts'
import { GatherProgress } from './game/hud/GatherProgress.tsx'
import { BiomeMusic } from './game/audio/BiomeMusic.tsx'
import { MountPrompt } from './components/MountPrompt.tsx'
import { PortalPrompt } from './components/PortalPrompt.tsx'
import { TravelModal } from './components/TravelModal.tsx'
import { FightPrompt } from './components/FightPrompt.tsx'
import { DungeonPortalPrompt } from './components/DungeonPortalPrompt.tsx'
import { DungeonLobby } from './components/DungeonLobby.tsx'
import { PlayerNametag } from './components/PlayerNametag.tsx'
import { ZonePrompt } from './components/ZonePrompt.tsx'
import { ZoneRevealBanner } from './components/ZoneRevealBanner.tsx'
import { CityArrivalBanner } from './components/CityArrivalBanner.tsx'
import { SpawnNametag } from './components/SpawnNametag.tsx'
import { AmbushPrompt } from './components/AmbushPrompt.tsx'
import { PlayerContextMenu } from './components/PlayerContextMenu.tsx'
import { FpsPanel } from './components/FpsPanel.tsx'
import { Toasts } from './components/Toasts.tsx'
import { HUD_PANEL_CLASS, HudPanel } from './components/ui/HudPanel.tsx'
import { dispatch_app, useAppStore } from './store.ts'
import { worlds_source } from './content/worlds.ts'
import { env } from './env.ts'
import { copy_text, type AppCopy } from './i18n/copy.ts'
import type { Locale } from './i18n/locale.ts'
import type { Page } from './modules/navigation.ts'
import { selected_dungeon_run } from './modules/dungeon.ts'
import { selected_party } from './modules/party.ts'
import { toast } from './toast.ts'
import { TutorialHost } from './tutorial/TutorialHost.tsx'
import { format_sui } from './wallet_amount.ts'
import { FightLevelUpCard, FightResultCard } from './game/fight/FightResultCard.tsx'
import { FriendsPanel } from './components/FriendsPanel.tsx'
import { PartyFrame } from './components/PartyFrame.tsx'
import { CrushResultModal } from './characters/CrushResultModal.tsx'
import { SessionIndexingCatchup } from './components/IndexingCatchupModal.tsx'
import {
  character_creation_failure_message,
  character_creation_funding_text,
  character_creation_insufficient,
} from './character_creation_funding.ts'

const city_arrival_active = (in_app: boolean, page: Page, fight_active: boolean, dungeon_active: boolean): boolean =>
  in_app && page === 'world' && !fight_active && !dungeon_active

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285f4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34a853"
    />
    <path
      d="M5.84 14.09a6.5 6.5 0 0 1 0-4.18V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#fbbc05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      fill="#ea4335"
    />
  </svg>
)

const Divider = () => <div className="h-px bg-white/10" />

const login_lead = (copy: AppCopy, gift: boolean): string =>
  gift ? copy_text(copy.airdrop_page)('gift_login') : copy.sign_in_to_play

const Login = ({
  auth_ready,
  wallets,
  copy,
  show_wallets,
  set_show_wallets,
  login_google,
  login_wallet,
  spectate,
  gift,
}: Readonly<{
  auth_ready: boolean
  wallets: readonly string[]
  copy: AppCopy
  show_wallets: boolean
  set_show_wallets: (shown: boolean) => void
  login_google: () => void
  login_wallet: (name: string) => void
  spectate: () => void
  gift: boolean
}>) => {
  const auth_status = useAppStore(({ session }) => session.auth_status)
  const error = useAppStore(({ session }) => session.auth_error)
  const loading = auth_status === 'connecting'

  return (
    <>
      <div className="fixed inset-0 z-2 bg-bg/50 backdrop-blur-[7px]" />
      <section className="fixed top-1/2 left-1/2 z-3 flex w-[min(384px,calc(100vw-32px))] -translate-1/2 flex-col items-center gap-[27px] rounded-[5px] border border-white/9 bg-[linear-gradient(135deg,rgba(18,18,26,0.92),rgba(10,10,15,0.82))] px-9 py-10 shadow-[0_18px_60px_rgba(0,0,0,0.45),inset_0_1px_rgba(255,255,255,0.05)] backdrop-blur-3xl max-[600px]:px-6 max-[600px]:py-8">
        <img className="size-[72px] drop-shadow-[0_0_20px_rgba(200,150,60,0.3)]" src="/logo.png" alt="AresRPG" />
        <div className="text-center">
          <h1 className="mb-2 pl-[0.35em] text-sm font-semibold tracking-[0.35em] uppercase">AresRPG</h1>
          <p className="text-[10px] tracking-[0.3em] text-gray-500">{login_lead(copy, gift)}</p>
        </div>
        <div className="flex w-full flex-col gap-3 [&_button]:h-[46px] [&_button]:w-full [&_button]:cursor-pointer [&_button]:rounded-[5px] [&_button]:transition-all [&_button]:duration-150 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-45">
          <button
            className="flex items-center justify-center gap-3 border-0 bg-white/96 text-xs font-semibold text-[#282b31] hover:not-disabled:bg-white"
            disabled={!auth_ready || loading}
            onClick={login_google}
          >
            <GoogleIcon />
            {loading ? copy.loading_universe : copy.continue_google}
          </button>
          <div className="contents" hidden={gift}>
            {import.meta.env.DEV && auth_ready && (
              <>
                <Divider />
                <button
                  className="border border-[#c8963c]/35 bg-transparent text-[11px] font-semibold tracking-[0.16em] text-[#c8963c] uppercase hover:border-[#c8963c]/70 hover:bg-[#c8963c]/8"
                  onClick={() => set_show_wallets(!show_wallets)}
                >
                  {copy.connect_wallet}
                </button>
                {show_wallets && (
                  <div className="flex flex-col gap-1.5 border border-white/8 bg-black/18 p-2">
                    {wallets.map((wallet) => (
                      <button
                        className="!h-9 border border-white/8 bg-white/4 text-[11px] text-[#e8e4dc]"
                        key={wallet}
                        onClick={() => login_wallet(wallet)}
                      >
                        {wallet}
                      </button>
                    ))}
                    {wallets.length === 0 && (
                      <span className="p-[7px] text-center text-[10px] text-gray-500">{copy.no_wallet}</span>
                    )}
                  </div>
                )}
              </>
            )}
            <>
              <Divider />
              <button
                className="border border-[#4a9eff]/30 bg-transparent text-[11px] font-semibold tracking-[0.16em] text-[#67adff] uppercase hover:border-[#4a9eff]/70 hover:bg-[#4a9eff]/8"
                onClick={spectate}
              >
                {copy.watch_world}
              </button>
            </>
          </div>
          {error && <div className="text-center text-[10px] leading-6 text-[#ff7d7d]">{error}</div>}
        </div>
      </section>
    </>
  )
}

const Welcome = ({
  copy,
  create,
  funding_address,
}: Readonly<{ copy: AppCopy; create: () => void; funding_address: string | null }>) => {
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
              {character_creation_funding_text(copy.welcome_need_sui).replaceAll(
                '{{price}}',
                format_sui(CHARACTER_PRICE_MIST, 0)
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

export function App() {
  const session = useAppStore(({ session }) => session)
  const navigation = useAppStore(({ navigation }) => navigation)
  const settings = useAppStore((state) => state.settings)
  const locale = useAppStore((state) => state.locale)
  const copy = useAppStore((state) => state.copy)
  const engine_status = useAppStore((state) => state.engine)
  const gift_link_ready = useAppStore((state) => state.distribution.gift_link_ready)
  const fight_active = useAppStore((state) => {
    const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    return (
      state.fight.mounted ||
      !!character?.active_fight ||
      !!state.fight.spectating_by_character[state.session.selected_character_id ?? '']
    )
  })
  const dungeon_active = useAppStore((state) => selected_dungeon_run(state) !== null)
  const dungeon_lobby_open = dungeon_lobby_visible(navigation.page, fight_active, dungeon_active)
  const social_hud_open = social_hud_visible(navigation.page, fight_active, dungeon_active)
  const fight_access = fight_access_from(settings.fight_access)
  const party_available = useAppStore((state) => selected_party(state) !== null)
  const flatten_locked = engine_status.backend === 'grid'
  const { wallet } = session
  const [show_wallets, set_show_wallets] = useState(false)
  const [graphics_notice_dismissed, set_graphics_notice_dismissed] = useState(false)
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

  const change_quality = useCallback(
    (quality: EngineQuality): void =>
      dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, quality }) }),
    [settings]
  )
  const toggle_flattened = useCallback(
    (): void =>
      dispatch_app({
        type: 'settings/changed',
        settings: Object.freeze({ ...settings, flat_mode: !settings.flat_mode }),
      }),
    [settings]
  )
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
      const pending = toast.loading(copy?.creating_character ?? 'Creating character…')
      try {
        const first_world = worlds_source[0]?.world
        if (!first_world) throw new Error('No authored world is available')
        await wallet.create_character(character, first_world)
        pending.success(copy?.character_created ?? 'Character created')
        dispatch_app({ type: 'dialog/open', dialog: null })
        dispatch_app({ type: 'wallet/refresh' })
      } catch (error) {
        pending.error(character_creation_failure_message(error, copy))
        dispatch_app({ type: 'wallet/refresh' })
        throw error
      }
    },
    [copy, session.characters.length, wallet]
  )
  const sui_insufficient = character_creation_insufficient(session.sui_balance_mist)
  const world_unavailable = engine_status.issue?.code === 'world_unavailable'
  const show_graphics_notice = graphics_notice_visible(
    gift_link_ready,
    engine_status.state === 'failed',
    world_unavailable,
    graphics_notice_dismissed,
    engine_status.state === 'degraded'
  )
  const loading_universe = session.auth_status === 'connecting' || (in_app && !session.roster_loaded)
  if (!copy) return <main className="fixed inset-0 bg-bg" />

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg font-mono text-[#e8e4dc]">
      <div
        aria-hidden={navigation.page !== 'world' && !(navigation.page === 'kolizeum' && fight_active)}
        data-world-frame=""
        className={`fixed overflow-hidden transition-opacity duration-150 ${WORLD_FRAME_LAYER} ${world_frame_visibility(navigation.page, fight_active)} ${
          in_app
            ? 'top-[46px] right-3 bottom-3 left-[224px] rounded-[14px] shadow-[0_18px_50px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04)]'
            : 'inset-0'
        }`}
      >
        <BiomeMusic />
        <CityArrivalBanner
          active={city_arrival_active(in_app, navigation.page, fight_active, dungeon_active)}
          copy={copy}
        />
        <canvas ref={attach_canvas} className="absolute inset-0 size-full touch-none" />

        {in_app && navigation.page === 'world' && !fight_active && !dungeon_active && (
          <div className={`${CANVAS_OVERLAY_CLASS} z-[105]`}>
            <MountPrompt copy={copy} />
            <FightPrompt copy={copy} />
            <DungeonPortalPrompt copy={copy} />
            <PortalPrompt copy={copy} />
            <PlayerNametag />
            <SpawnNametag copy={copy} />
            <AmbushPrompt copy={copy} />
            <CompassStrip copy={copy} />
            <RunToProgress copy={copy} />
            <ZonePrompt copy={copy} />
            <ZoneRevealBanner copy={copy} />
            <Minimap copy={copy} />
            <OverworldVitals />
            <GatherProgress copy={copy} />
            <WorldChat copy={copy} />
          </div>
        )}
        {in_app && dungeon_lobby_open && (
          <div className={`${CANVAS_OVERLAY_CLASS} z-[105]`}>
            <DungeonLobby key={session.selected_character_id} copy={copy} />
          </div>
        )}
        <div className={`${CANVAS_OVERLAY_CLASS} z-[110]`}>
          <div className="flex w-fit flex-col items-start gap-2">
            <FpsPanel
              active={navigation.page === 'world'}
              change_quality={change_quality}
              copy={copy}
              fight_access={party_available ? fight_access : 0}
              flatten_locked={flatten_locked}
              flattened={effective_flattened(settings.flat_mode, engine_status.backend)}
              party_available={party_available}
              quality={settings.quality}
              toggle_fight_access={() =>
                dispatch_app({
                  type: 'settings/changed',
                  settings: Object.freeze({ ...settings, fight_access: fight_access === 0 ? 1 : 0 }),
                })
              }
              toggle_flattened={toggle_flattened}
            />
            {in_app && social_hud_open && <FriendsPanel copy={copy} />}
          </div>
          {in_app && social_hud_open && <PartyFrame copy={copy} />}
        </div>

        {loading_universe && (
          <div className={`${CANVAS_OVERLAY_CLASS} z-[130] bg-bg/35 backdrop-blur-[9px]`}>
            <div className="absolute inset-0 grid place-items-center">
              <ThinkingOrb aria-label={copy.loading_universe} size={64} state="connecting" theme="dark" />
            </div>
          </div>
        )}
        {in_app && navigation.page === 'world' && navigation.dialog === 'welcome' && (
          <Welcome
            copy={copy}
            create={() => dispatch_app({ type: 'dialog/open', dialog: 'character_create' })}
            funding_address={sui_insufficient && wallet ? wallet.address : null}
          />
        )}
        {in_app && (navigation.page === 'world' || navigation.page === 'kolizeum') && (
          <>
            <FightResultCard copy={copy} />
            <FightLevelUpCard copy={copy} />
          </>
        )}
      </div>
      <div className="pointer-events-none fixed inset-0 z-[100] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(200,150,60,0.014)_2px,rgba(200,150,60,0.014)_4px)]" />
      <PlayerContextMenu copy={copy} />
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
      <CrushResultModal copy={copy} />
      <SessionIndexingCatchup copy={copy} indexing_lag={session.indexing_lag} status={session.link_status} />

      {show_graphics_notice && (
        <section className="fixed inset-0 z-[200] grid place-items-center bg-bg/88 p-5 backdrop-blur-lg">
          <div className="w-full max-w-lg border border-[#ff5a8b]/35 bg-bg p-7 shadow-[0_0_80px_rgba(255,27,141,0.12)]">
            <h2 className="mb-4 text-base font-semibold text-[#e8e4dc]">
              {world_unavailable ? copy.world_unavailable_title : copy.title}
            </h2>
            <p className="mb-5 text-xs leading-6 text-[#a3a5ad]">
              {world_unavailable ? copy.world_unavailable : engine_status.state === 'failed' ? copy.fatal : copy.body}
            </p>
            {!world_unavailable && (
              <p className="mb-2 text-[11px] leading-5 text-[#d0ccd0]">
                {/Chrome|Chromium|Edg/.test(navigator.userAgent) ? copy.chrome : copy.other}
              </p>
            )}
            {(world_unavailable || engine_status.state === 'degraded') && (
              <button
                className="mt-5 h-10 w-full cursor-pointer border border-[#4a9eff]/40 bg-[#4a9eff]/8 text-[10px] tracking-[0.18em] text-[#67adff] uppercase"
                onClick={() => set_graphics_notice_dismissed(true)}
              >
                {copy.continue}
              </button>
            )}
          </div>
        </section>
      )}

      {!session.wallet && session.auth_status !== 'connecting' && !navigation.guest_spectating && (
        <Login
          auth_ready={session.auth_ready}
          wallets={session.wallets}
          copy={copy}
          gift={gift_link_ready}
          login_google={() => dispatch_app({ type: 'auth/login_google' })}
          login_wallet={(name) => dispatch_app({ type: 'auth/login_wallet', name })}
          set_show_wallets={set_show_wallets}
          show_wallets={show_wallets}
          spectate={() => dispatch_app({ type: 'spectate/changed', enabled: true })}
        />
      )}

      {!session.wallet && navigation.guest_spectating && (
        <>
          <button
            className={`${HUD_PANEL_CLASS} fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 cursor-pointer !border-[#4a9eff]/25 px-[22px] py-3 text-[10px] tracking-[0.2em] text-[#67adff]`}
            onClick={() => dispatch_app({ type: 'spectate/changed', enabled: false })}
          >
            {copy.sign_in}
          </button>
          <HudPanel className="fixed right-5 bottom-5 z-[120] px-3 py-2 text-[8px] tracking-[0.2em] text-[#a3a5ad] max-[600px]:hidden">
            {copy.drag_hint}
          </HudPanel>
        </>
      )}

      {session.wallet && (
        <>
          <AppShell
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
  )
}
