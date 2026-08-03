// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Characters drawer's inline create host. Split out of CharactersDrawer.jsx (issue #2069);
// the component is unchanged.
import { useEffect, useRef } from 'react'

import { is_zklogin_session } from '../../../auth'
import { context } from '../../store.js'
import {
  character_create,
  read_allowed_classes,
  is_paid_create,
} from '../character-create.js'
import { get_sui_balance } from '../../core/wallet.js'
import { use_expedition } from '../../../roster/store'

// Presentation hex (#rrggbb) → on-chain u32 (character_new packs color_1/2/3 as u32), mirroring ExpeditionCreate /
// CharacterMenu so every create surface sends the identical value.
const color_to_number = (/** @type {string} */ hex) => parseInt(String(hex).replace(/^#/, ''), 16)

/**
 * The inline create flow — mounts the proven vanilla character_create() inside a React host so the
 * drawer reuses it verbatim (same paid-mint hint and on-chain mint PTB). On a
 * successful mint the suiEvent → sui_data refetch repaints the roster; we close back to the list.
 * The three picked colors (Skin/Armor/Trim = on-chain color_1/2/3) flow straight to the mint PTB.
 * `variant` decides the shared creator's FRAME — the create-character page from the characters
 * page must not be a second fullscreen sibling: the wide companion `page`
 * embeds it inline, bounded to `.chr-create-host` (the same `.cc.cc--inline` mechanism the onboarding
 * world-slot host already proves — character-create.placement.test.jsx); the narrow in-world `drawer`
 * keeps the centered overlay modal (no room there to embed the 1040px panel).
 * @param {{ character_count: number, claimed_free: boolean, price_sui: number, on_close: () => void, variant: 'drawer' | 'page' }} props
 */
export function CreateHost({ character_count, claimed_free, price_sui, on_close, variant }) {
  const host = useRef(/** @type {HTMLDivElement | null} */ (null))
  useEffect(() => {
    const mount = host.current
    if (!mount) return undefined
    // The shared PAID discriminator (single home in character-create.js) drives the balance hint and the
    // free-vs-paid PTB route below, the same rule the creator's price button renders from.
    // #443: folds in the wallet-session case (money law #73 — a connected wallet never rides the
    // sponsor), so a wallet's FIRST character here correctly routes to create_character_paid too.
    const zklogin_session = is_zklogin_session()
    const paid = is_paid_create({ character_count, claimed_free, zklogin_session })
    /** @type {ReturnType<typeof character_create> | undefined} */ let handle
    let destroyed = false
    // S-84: gate the class grid on the LIVE on-chain Creation whitelist (un-whitelisted → disabled "coming soon";
    // a read hiccup → undefined → all selectable, and the mint-time abort 103 still reads "This class is coming soon").
    void read_allowed_classes().then((allowed_classes) => {
      if (destroyed) return
      handle = character_create({
        character_count,
        claimed_free,
        zklogin_session,
        price_sui,
        allowed_classes,
        placement: variant === 'page' ? 'inline' : 'overlay',
        get_balance_sui: get_sui_balance,
        // D9 LAW — the CLICK-INSTANT prediction: ghost the new character into the engine roster the moment
        // the mint is submitted (the drawer row + downstream consumers see it immediately); the confirmed
        // mint's load_roster REPLACES the roster wholesale (ghost self-heals away), a failure rolls it back.
        on_submit_start: ({ name, class_id, colors: [c1, c2, c3] }) => {
          // M5: the ghost is a receipt_patch delta — the reducer replaces any prior ghost + appends this one
          // against the LATEST roster (no read-modify-write racing a background load_roster snapshot).
          context.dispatch('action/sui_data', {
            kind: 'receipt_patch',
            op: 'set_ghost',
            ghost: {
              id: `ghost:${name}`,
              name,
              classe: class_id,
              color_1: c1,
              color_2: c2,
              color_3: c3,
              level: 1,
              ghost: true,
            },
          })
        },
        on_submit_fail: () => {
          context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'clear_ghosts' })
        },
        on_created: async ({ name, class_id, male, color_1, color_2, color_3 }) => {
          // ROUTE BY THE SHARED PREDICATE: the second character for zklogin is still 10 sui — swap free
          // for 10 sui and write it on the button too. FIRST character (paid=false) → the
          // proven FREE zkLogin mint (create_character → create_character_free_ptb, sponsor/self-pay
          // money-routed) — the drawer previously sent even a fresh roster-0 account to the PAID builder,
          // charging 10 SUI for the character its own button promised free. ADDITIONAL character
          // (paid=true) → create_character_paid: the SDK's create_character_paid_ptb at the LIVE gate
          // price, SELF-PAY through the S-54 tx choke (dry-run refuse → zero gas on an insufficient
          // wallet), roster repainted by its load_roster. Same predicate as the creator's price button, so
          // the label and the submitted PTB can never disagree. THROWS on failure → surfaced inline by
          // character_create's submit(). On success, close back to the repainted list.
          const draft = {
            name,
            classe: class_id,
            male: male ?? true,
            color_1: color_to_number(color_1),
            color_2: color_to_number(color_2),
            color_3: color_to_number(color_3),
          }
          const { create_character, create_character_paid } = use_expedition.getState()
          await (paid ? create_character_paid(draft) : create_character(draft))
          on_close()
        },
        on_cancel: on_close,
      })
      mount.appendChild(handle.root)
    })
    return () => {
      destroyed = true
      handle?.destroy()
    }
    // deps (react-hooks/exhaustive-deps is not wired in this repo — the directive was inert): mounts the imperative character_create() widget exactly once; character_count/claimed_free/price_sui/variant/on_close are its initial config, captured at open, and the create flow doesn't react to roster changes mid-flow
  }, [])
  return <div className="chr-create-host" ref={host} />
}
