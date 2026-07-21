// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'

import {
  use_auth,
  sponsor_and_execute_transaction,
  sign_and_execute_transaction,
  get_zklogin_address_seed,
} from '../auth'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { context } from '../game/core/game.js'
import { humanize_abort } from '../game/core/abort_copy.js'
import { remember_character_kiosk } from '../world-shell/kiosk_resolve.js'
import { begin_join } from '../world-shell/session_gate.js'
import { game_log } from '../core/log.js'
import { get_sdk, type ExpeditionSdk } from '../chain/sdk'
import { normalize_receipt } from '../chain/receipt'
import { normalize_character } from '../chain/read_character.js'
import { execute_create_routed } from '../chain/money_route'
import { is_aresrpg_character, ARESRPG_PACKAGE_ID } from '../chain/character_lineage'

import { load_roster } from './load_roster'
import {
  EXPEDITION_INITIAL_STATE,
  reduce_expedition,
  adopt_predicted_character,
  type ExpeditionInput,
} from './store_reducer'

// #42: a fresh character is its honest on-chain self — base stats all 0 (SSOT: the reference corpus's spec,
// "Default 0, manually allocated"; `character.move` mint = 0), 100 base HP (`base_hp = 100 + vit*5`),
// empty inventory. NO starter-stat hardcode (the old STARTER_STATS was a fabricated build — KILLED). Stats
// are earned by leveling; first gear from runs. A fresh char wins easy single-mob fights (100 HP + the base
// spell) but can't heal (0 potions) — a fully fun sustained fresh run needs real content (a lvl-1 world /
// starter consumables), a WS2/admin add, not a frontend hardcode.

// Legacy owned-Expedition scan suffix (T95: the merged package has NO ::expedition:: module — this scan stays
// empty post-cutover; kept only as the run-resume seam). The Character kiosk filter (`is_aresrpg_character`) and
// the package id both live in ./character_lineage now — DERIVED from the SDK deployment home, never a hardcoded
// retired lineage (audit row 12 fix), so a fresh publish that re-stamps PACKAGE_ID is followed automatically.
const EXPEDITION_TYPE_SUFFIX = '::expedition::Expedition'

// character.move ENameTaken (106) — names are globally unique; surfaced inline by the creator on collision.
const ENAME_TAKEN = /106\) in command/

// ── chain-derived view types ───────────────────────────────────────────────
type ExpeditionView = Awaited<ReturnType<ExpeditionSdk['get_expedition']>>

export type CharacterCard = {
  id: string
  type: string
  // the on-chain Display record (name / image_url / …) read off the kiosk item; null if Display is absent
  display: Record<string, unknown> | null
}

// #42: the chosen-identity draft from the EXISTING 3D creator (ExpeditionCreate → character_create).
// Colors are already u32 (the adapter converted from hex), matching what `sdk.character_new` packs.
export type CharacterDraft = {
  name: string
  classe: string
  male: boolean
  color_1: number
  color_2: number
  color_3: number
}

// expedition.status: 0 ACTIVE, 1 RETURNING, 2 DEAD (aresrpg::expedition)
const STATUS_ACTIVE = 0

function err_message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ONE home for the create-mint failure → player copy, shared by BOTH create paths and BOTH money doors: a
// taken name is inline-actionable; every other abort flows through the humanizing decoder (abort_copy.js).
// (The taken-name literal is pre-existing English — a known i18n gap, out of this fix's scope.)
function mint_error(error?: string | null): Error {
  const e = error ?? 'Character mint failed'
  return new Error(ENAME_TAKEN.test(e) ? 'That name is already taken, choose another.' : humanize_abort(e))
}

interface ExpeditionStore {
  // character / kiosk
  loading: boolean
  no_character: boolean
  character: CharacterCard | null
  kiosk_id: string | null
  personal_kiosk_cap_id: string | null

  // active run
  busy: boolean
  expedition_id: string | null
  expedition: ExpeditionView | null

  input: (message: ExpeditionInput) => void
  load_character: () => Promise<void>
  create_character: (draft: CharacterDraft) => Promise<void>
  create_character_paid: (draft: CharacterDraft) => Promise<void>
  refresh: () => Promise<void>
}

export const use_expedition = create<ExpeditionStore>((set, get) => ({
  ...EXPEDITION_INITIAL_STATE,

  input: (message) => set((state) => reduce_expedition(state, message)),

  // Resolve the player's PERSONAL kiosk (→ kiosk_id + personal_kiosk_cap_id) and the Character locked in it.
  // Also resumes an in-flight run: if an Expedition is already owned (character escrowed, not in the kiosk),
  // adopt it so a page reload drops straight back into the active run.
  load_character: async () => {
    const { address } = use_auth.getState()
    if (!address) return
    set({ loading: true })
    try {
      const sdk = await get_sdk()

      // an owned Expedition means a run is in progress (the character is escrowed inside it)
      // #23 gRPC: listOwnedObjects({type}) → { objects } (was the jsonRpc owned-object scan filter.StructType → { data }).
      // Guarded on a stamped package id so an unstamped network never hands listOwnedObjects a malformed type.
      const active_expedition_id = ARESRPG_PACKAGE_ID
        ? ((
            await sdk.grpc_client.core.listOwnedObjects({
              owner: address,
              type: `${ARESRPG_PACKAGE_ID}${EXPEDITION_TYPE_SUFFIX}`,
            })
          ).objects[0]?.objectId ?? null)
        : null

      const { kioskOwnerCaps } = await sdk.kiosk_client.getOwnedKiosks({
        address,
        pagination: { limit: 25 },
      })
      const personal_caps = kioskOwnerCaps.filter((cap) => cap.isPersonal)

      // Locate the personal kiosk holding a CURRENT-deployment Character. The player may own several personal
      // kiosks (a pre-existing one, plus the one our create-flow mints), so scan them and match the character
      // by the package-scoped type — never the bare struct suffix (which a foreign/dead lineage shares).
      let kiosk_id: string | null = null
      let personal_kiosk_cap_id: string | null = null
      let character: CharacterCard | null = null
      for (const cap of personal_caps) {
        const kiosk = await sdk.kiosk_client.getKiosk({ id: cap.kioskId, options: { withObjects: true } })
        const char_item = kiosk.items.find((item) => is_aresrpg_character(item.type))
        if (char_item) {
          kiosk_id = cap.kioskId
          personal_kiosk_cap_id = cap.objectId
          character = { id: char_item.objectId, type: char_item.type, display: char_item.data?.display?.data ?? null }
          break
        }
      }

      // No demo character found, but a run may be active (the character is escrowed in the Expedition,
      // not in any kiosk). Keep a personal-kiosk handle so withdraw has a kiosk to return it into.
      if (!character && personal_caps[0]) {
        kiosk_id = personal_caps[0].kioskId
        personal_kiosk_cap_id = personal_caps[0].objectId
      }

      set({
        loading: false,
        kiosk_id,
        personal_kiosk_cap_id,
        character,
        // no demo character AND no active run → needs provisioning (the create-character onboarding)
        no_character: !character && !active_expedition_id,
        expedition_id: active_expedition_id,
      })

      if (active_expedition_id) {
        await get().refresh()
      }
    } catch (e) {
      set({ loading: false })
      use_toast.getState().add(err_message(e), 'error')
    }
  },

  // Create a PLAYABLE first character, fully client-side, for a fresh zkLogin user with no character.
  // ONE tx (S-50): the SDK's create_character_free_ptb composes the personal-kiosk create + the FREE
  // first-character mint + the in-kiosk lock inline (creation::create_character_free). SPONSORED (gas paid by
  // the app gas station → satisfies the gate's optional sponsor check); the sender + the resulting
  // character/kiosk owner are the LIVE logged-in zkLogin address (the gate's check_zklogin_issuer binds it).
  // #42: the player's CHOSEN identity (name/class/colors) from the EXISTING 3D creator (ExpeditionCreate /
  // CharacterMenu → character_create), minted backend-off. A fresh character is its honest on-chain self (base
  // stats 0, 100 HP) — no starter-stats CAS. Re-throws on failure so the creator surfaces it inline (no
  // random-name retry — the name is the player's, retrying the same name is pointless).
  create_character: async (draft) => {
    const { address, wallet_name } = use_auth.getState()
    if (!address || !wallet_name) {
      use_toast.getState().add('Not signed in', 'error')
      return
    }
    set({ busy: true })
    try {
      const sdk = await get_sdk()

      // ── Tx A: personal kiosk + FREE first-character mint with the PLAYER's chosen identity.
      // The mint routes through the loading toast (pending spinner → 'Explorer ready' / error),
      // consistent with explore/stop-exploring. The status-check + wait live INSIDE the promise so a
      // submitted-but-failed tx (e.g. name taken) shows the error toast, never a false success.
      // S-50: the SDK's create_character_free_ptb composes the REAL on-chain entry
      // (creation::create_character_free) at the stamped merged-package ids — creating the personal kiosk +
      // locking the Character inline, in ONE tx. Retires the dead sdk.character_new (api::character_new: no
      // such module on the merged S-46 package → that mint always aborted).
      /** @type {any} the executed tx receipt — D93 receipt-ingest reads created objects from it */
      let receipt: any = null
      const t0 = performance.now()
      await use_toast.getState().promise(
        (async () => {
          // P0: the zkLogin seed read + PTB build MUST live INSIDE the toast-wrapped promise.
          // address_seed is the caller's zkLogin session seed the gate's check_zklogin_issuer verifies (read
          // from the Enoki wallet). Previously this ran BEFORE the toast wrapper, so a seed-less/proof-not-ready
          // wallet threw here BYPASSING every user surface — no toast, and the re-throw's inline error was wiped
          // by the creator's trailing validate() → the button flashed "Creating…", reverted, nothing happened.
          // Inside the promise, any throw flows through toast.promise's catch: a LOUD humanized error toast +
          // the [tx] failed console.error (no silent failure). A non-zkLogin/dev wallet gets a clear
          // "zkLogin required" toast, never silence.
          const address_seed = await get_zklogin_address_seed(wallet_name)
          const tx = sdk.create_character_free_ptb({
            name: draft.name,
            class: draft.classe,
            male: draft.male,
            color_1: draft.color_1,
            color_2: draft.color_2,
            color_3: draft.color_3,
            address_seed,
          })
          // ── MONEY ROUTING (live-400 fix) ── the @server sponsor's anti-drain law REFUSES a
          // wallet holding > 0.2 SUI (api/sponsor.mjs SELF_PAY_MIST), which is why a funded wallet can hit
          // a `self-pay-required` 400. Decide with a FRESH on-chain getBalance — NEVER the cached wallet-bar
          // value for a money call — and self-pay the SAME free-mint PTB when funded (verified live: testnet
          // Creation.sponsor == none ⇒ self-pay is permitted). A getBalance failure THROWS through the toast,
          // never a silent sponsor fallback; the sponsored path (≤ 0.2 SUI) is byte-for-byte unchanged.
          const { route, digest } = await execute_create_routed({
            tx,
            fetch_balance_mist: async () => {
              const { balance } = await sdk.grpc_client.core.getBalance({ owner: address })
              return BigInt(balance.balance)
            },
            run_self_pay: (t) => sign_and_execute_transaction(wallet_name, address, t),
            run_sponsored: (t) => sponsor_and_execute_transaction(wallet_name, address, t),
            on_mint_error: mint_error,
          })
          // #23 gRPC: waitForTransaction + normalize the receipt to the jsonRpc-ish { objectChanges } the D93
          // ingest reads (created Character/Kiosk/PersonalKioskCap from effects.changedObjects + objectTypes).
          receipt = normalize_receipt(
            await sdk.grpc_client.core.waitForTransaction({
              digest,
              include: { effects: true, objectTypes: true },
            })
          )
          // SELF-PAY returns BCS effects (no pre-check inside execute_create_routed), so its EXECUTED status is
          // read off the WAITED receipt — mirrors create_character_paid. A sim-refused self-pay already threw.
          if (route === 'self_pay' && receipt.effects?.status?.status !== 'success')
            throw mint_error(receipt.effects?.status?.error)
        })(),
        {
          pending: i18n.t('world.tx_create_character_pending', { name: draft.name }),
          success: i18n.t('world.tx_create_character_success', { name: draft.name }),
        }
      )
      game_log('d93', 'create tx+wait', Math.round(performance.now() - t0), 'ms')

      // ── D93 (live bug: character switch felt slow — a stale read before the receipt landed) — RECEIPT-INGEST, the read-after-write
      // class killer (3rd surface: place_at/D77, dungeon status, now create). The receipt NAMES everything:
      // the new Character/Kiosk/PersonalKioskCap ids. No blind full re-walks before routing — the lobby gets
      // a PREDICTED character (D9: we hold the full appearance from the form) THIS FRAME, and the truth
      // reconciles in the background with a found-guard so an index-lagging walk can never wipe it.
      const created = (receipt?.objectChanges ?? []).filter((c: any) => c.type === 'created')
      const char_created = created.find((c: any) => String(c.objectType ?? '').endsWith('::character::Character'))
      const kiosk_created = created.find((c: any) => String(c.objectType ?? '') === '0x2::kiosk::Kiosk')
      const cap_created = created.find((c: any) => String(c.objectType ?? '').includes('PersonalKioskCap'))
      // HYDRATE-FROM-OWN-EFFECTS (S-57 create→auto-join race, design ruling 2026-07-12): memoize the EXACT kiosk pair this mint
      // just created so the AUTO-JOIN firing seconds later (DiscoveryPrompts, off the world-less doc) resolves with
      // ZERO reads — never racing the chain-direct owned-object index on a just-minted object. The derive-from-
      // character resolver stays the truth for every other character (rejoin / legacy-unjoined / switch).
      if (char_created && kiosk_created && cap_created)
        remember_character_kiosk(String(char_created.objectId), {
          kiosk_id: String(kiosk_created.objectId),
          personal_kiosk_cap_id: String(cap_created.objectId),
        })
      const predicted = char_created
        ? {
            ...normalize_character(
              {
                name: draft.name,
                classe: draft.classe,
                sex: draft.male ? 'male' : 'female',
                color_1: draft.color_1,
                color_2: draft.color_2,
                color_3: draft.color_3,
                experience: 0,
                health: 100,
              },
              String(char_created.objectId),
              String(char_created.objectType)
            ),
          }
        : null
      if (predicted) {
        // instant lobby: the engine roster + selection get the predicted record NOW (avatar spawns this frame)
        const cur = context.get_state()
        context.dispatch('action/sui_data', {
          characters: [...(cur.sui?.characters ?? []).filter((c: any) => c.id !== predicted.id), predicted],
          loaded: true,
          load_error: null,
          has_claimed_free_character: true,
        })
        // ONE-BOOT create→play (07-13): select the just-minted character AND enter the JOINING hold NOW —
        // the instant the create tx landed. GameWorldHost holds ONE loading veil (no decorative→spectate→resident
        // boot storm, no spectate sky-view detour) until the auto-join resolves the world and the resident scene
        // boots ONCE. The predicted record is already in the engine roster, so that boot embodies the character
        // with no /v1 roster wait. (First-character path only — the paid/additional create never embody-reloads.)
        // SWITCH-PARITY LEG ②: selection and the join gate ALWAYS target the SAME id (adopt_predicted_character,
        // store_reducer.ts) — a prior conditional-select here could leave selection on a stale character while
        // begin_join already moved the join gate to the new one.
        adopt_predicted_character(String(predicted.id), {
          select_character: (id) => context.dispatch('action/select_character', id),
          begin_join,
        })
        set({
          busy: false,
          character: predicted as any,
          kiosk_id: kiosk_created ? String(kiosk_created.objectId) : get().kiosk_id,
          personal_kiosk_cap_id: cap_created ? String(cap_created.objectId) : get().personal_kiosk_cap_id,
        })
        game_log('d93', 'predicted spawn dispatched', Math.round(performance.now() - t0), 'ms')
        // BACKGROUND reconcile (non-blocking): one targeted walk; if the index lags and the walk misses the
        // new char, RE-ASSERT the predicted record and retry once — a lagging walk must never blank the lobby.
        void (async () => {
          try {
            await get().load_character()
            await load_roster()
            const seen = context.get_state().sui?.characters?.some((c: any) => c.id === predicted.id)
            if (!seen) {
              game_log('d93', 'reconcile walk missed the fresh character — re-asserting predicted + one retry')
              const cur2 = context.get_state()
              context.dispatch('action/sui_data', {
                characters: [...(cur2.sui?.characters ?? []).filter((c: any) => c.id !== predicted.id), predicted],
                loaded: true,
                load_error: null,
                has_claimed_free_character: true,
              })
              setTimeout(() => void load_roster().catch(() => {}), 2000)
            }
            game_log('d93', 'reconcile complete', Math.round(performance.now() - t0), 'ms')
          } catch (e) {
            game_log('d93', 'background reconcile failed (predicted record holds)', e)
          }
        })()
        return
      }
      // receipt lacked the Character (unexpected) — fall back to the old blocking read-back path, loudly
      game_log('d93', 'receipt had no created Character — falling back to blocking re-read')
      await get().load_character()
      const { kiosk_id, personal_kiosk_cap_id, character } = get()
      if (!character || !kiosk_id || !personal_kiosk_cap_id)
        throw new Error('Mint succeeded but the new character could not be read back')
      set({ busy: false })
      await load_roster().catch(() => {})
    } catch (e) {
      set({ busy: false })
      // re-throw so character_create's submit() shows the error inline + re-enables the form
      throw e instanceof Error ? e : new Error(err_message(e))
    }
  },

  // Create an ADDITIONAL (paid) character — the SELF-PAY sibling of create_character, reusing the SAME proven
  // creator + toast shape. The only deltas from the free path ("we already have everything"): (1) the SDK's
  // create_character_paid_ptb (no free-slot claim; an EXACT price split off the gas coin, the gate refunds
  // change), (2) SELF-PAY via sign_and_execute_transaction (paid = the user pays; a SPONSORED gas coin would
  // wrongly cover the price — a drain), (3) the LIVE gate price read fresh from get_creation_state, NEVER a
  // hardcoded number (a stale-low price aborts EInsufficientPayment). The S-54 tx choke dry-runs BEFORE
  // signing, so a would-fail tx refuses pre-sign with ZERO gas and an insufficient wallet is rejected at
  // submission (no execution, no gas). Re-throws on failure so the creator surfaces it inline. Success (delta
  // (4)) is the standard roster refresh — load_roster repaints the drawer with the new on-chain character; the
  // host closes back to the list. NO predicted lobby-spawn / embody-reload: an additional character must never
  // yank the player off the one they are currently playing (that path is FIRST-character only).
  create_character_paid: async (draft) => {
    const { address, wallet_name } = use_auth.getState()
    if (!address || !wallet_name) {
      use_toast.getState().add('Not signed in', 'error')
      return
    }
    set({ busy: true })
    try {
      const sdk = await get_sdk()
      // LIVE price (authoritative): read the gate fresh right before building — an exact split refunds nothing,
      // a stale-low price aborts on-chain. The client mirror (ADDITIONAL_CHARACTER_PRICE_SUI) is a DISPLAY hint
      // only; the mint price is ALWAYS the on-chain truth.
      const creation = await sdk.get_creation_state()
      if (!creation) throw new Error('Could not read the on-chain character price')
      await use_toast.getState().promise(
        (async () => {
          const tx = sdk.create_character_paid_ptb({
            name: draft.name,
            class: draft.classe,
            male: draft.male,
            color_1: draft.color_1,
            color_2: draft.color_2,
            color_3: draft.color_3,
            price_mist: creation.price,
          })
          // SELF-PAY (NOT sponsored): the wallet's own coin funds the price split; the choke dry-runs first.
          const { digest } = await sign_and_execute_transaction(wallet_name, address, tx)
          // #23 gRPC: wait + normalize to the { effects.status } shape the success-check reads (self-pay returns
          // BCS-string effects, so status is read off the WAITED receipt — mirrors world_join / dungeon_actions).
          const receipt = normalize_receipt(
            await sdk.grpc_client.core.waitForTransaction({
              digest,
              include: { effects: true, objectTypes: true },
            })
          )
          if (receipt.effects.status.status !== 'success') throw mint_error(receipt.effects.status.error)
        })(),
        {
          pending: i18n.t('world.tx_create_character_pending', { name: draft.name }),
          success: i18n.t('world.tx_create_character_success', { name: draft.name }),
        }
      )
      set({ busy: false })
      // roster refresh → the new character appears in the CharactersDrawer (and the 3D lobby roster); switchable.
      await load_roster().catch(() => {})
    } catch (e) {
      set({ busy: false })
      // re-throw so character_create's submit() shows the error inline + re-enables the form
      throw e instanceof Error ? e : new Error(err_message(e))
    }
  },

  refresh: async () => {
    const { expedition_id } = get()
    if (!expedition_id) return
    const sdk = await get_sdk()
    const expedition = await sdk.get_expedition({ expedition_id })
    set({ expedition })
  },
}))

export { STATUS_ACTIVE }
