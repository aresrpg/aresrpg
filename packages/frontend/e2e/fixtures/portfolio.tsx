// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site signed in with a fake account: the real shell, the real site store with only the market's and the address
// bar's observers on (no socket, no sign-in, no bot service, so a bar link swaps the page), and the account's packets
// as the server sends them. `?page=` picks the
// page (`portfolio` by default) and `#` its hash. The wallet records each listing it signs in `data-listed` on the
// body. `?holder` connects an external holder wallet; `?gifts=<n>` gives the account n waiting giftcards, one per
// reward; `?agent=none|unreachable` is what the owner check answers (a verified bot by default); `?slow_transfer` makes
// each transfer step take two seconds and succeed, else the bot's transfer hands answer with nothing pending.
import type { CharacterRow, ItemRow, ListingRow } from '@aresrpg/protocol'
import { createRoot } from 'react-dom/client'

import { rolled_item_types } from '../../src/content/item_templates.ts'
import { items_by_type } from '../../src/content/items.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { item_listing } from '../../src/marketplace/useMarketSell.ts'
import { SiteShell } from '../../src/site/SiteShell.tsx'
import { SITE_MODULES } from '../../src/site_modules.ts'
import { dispatch_app, observing, read_app_state, start_app } from '../../src/store.ts'

import '../../src/tailwind.css'

start_app(observing(SITE_MODULES, ['marketplace', 'location']), { seat: false })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })

const search = new URLSearchParams(location.search)
const OWNER = `0x${'a1'.repeat(32)}`
const BOT = `0x${'b2'.repeat(32)}`
const KIOSK = '0xkiosk_owner'

const row = (item_type: string, id: string, amount = 1, kiosk = KIOSK): ItemRow => {
  const { name, category, level } = items_by_type[item_type]!
  return { id, name, item_type, category, level, amount, kiosk, version: '7' }
}
// Two stackable types, each split over several stack objects, as the chain may hold them; one shroom lot is listed.
const inventory: readonly ItemRow[] = [
  row('green_mushroom_powder', '0xshroom_a', 12),
  row('green_mushroom_powder', '0xshroom_b', 10),
  row('green_mushroom_powder', '0xshroom_c', 8),
  row('green_mushroom_powder', '0xshroom_listed', 5),
  row('gnawed_branch', '0xbranch_a', 15),
  row('gnawed_branch', '0xbranch_b', 10),
  row('gnawed_branch', '0xbranch_c', 5),
  row('food_crate', '0xcrate', 2),
  row('scroll_of_oblivion', '0xscroll'),
  ...['0xsword_a', '0xsword_b'].map((id) => row('gravebrand', id)),
  row('corbac', '0xpet'),
]
const hero = (id: string, name: string, classe: string, level: number): CharacterRow => ({
  id,
  name,
  classe,
  sex: 'male',
  experience: '1200',
  level,
  color_1: 0xffffff,
  color_2: 0xd9af57,
  color_3: 0x8b6539,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  kiosk: KIOSK,
  equipment: [],
  custody: 'kiosk',
})
const own_listings: readonly ListingRow[] = [
  { ...item_listing(inventory[3]!, OWNER, 900_000_000n), version: '7' },
  { ...item_listing(row('gravebrand', '0xsword_listed'), OWNER, 12_000_000_000n), version: '7' },
  { ...item_listing(row('gravebrand', '0xsword_listed_2'), OWNER, 15_000_000_000n), version: '7' },
]

/** A transfer hand. With `?slow_transfer` each review and each signature takes two seconds, and an offer leaves its caps
 * where the claim reads them. */
type Intent = Readonly<{
  kind: string
  recipient?: string
  items?: readonly Readonly<{ item_id: string; kiosk: string }>[]
}>
const offered: { items: readonly object[] } = { items: [] }
const wait = () => new Promise((resolve) => setTimeout(resolve, 2_000))
const hand = (sender: string) => ({
  sender,
  synchronize: async () => undefined,
  ...(search.has('slow_transfer') && {
    prepare: async (intent: Intent) => {
      await wait()
      return {
        intent,
        sender,
        confirm: async () => {
          await wait()
          if (intent.kind === 'asset_offer')
            offered.items = (intent.items ?? []).map(({ item_id, kiosk }) => ({
              item_id,
              recipient: intent.recipient,
              agent_address: sender,
              seller_kiosk: kiosk,
              purchase_cap: `0xcap_${item_id}`,
            }))
          return { digest: `0x${intent.kind}`, receipt: {} }
        },
      }
    },
  }),
})

dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: {
    address: OWNER,
    identity: 'zklogin',
    wallet_name: 'Sign in with Google',
    on_transaction: () => () => undefined,
    is_transaction_idle: () => true,
    read_item: async () => {
      throw new Error('The portfolio reads its indexed rows')
    },
    marketplace: {
      list: async (
        asset: Readonly<{ id: string; price_mist: bigint; amount?: number; merge_sources?: readonly string[] }>
      ) => {
        document.body.dataset.listed = `${asset.id}:${asset.price_mist}:${asset.amount}:${(asset.merge_sources ?? []).join(',')}`
        return { digest: '0xlist', version: '8' }
      },
    },
    read_agent_recall: async () => ({
      transfer: hand(BOT),
      read_incoming_items: async () => offered.items,
      read_deposit_items: async () => [],
      read_pending_characters: async () => [],
    }),
    agent_transfer: hand(OWNER),
    read_agent_returns: async () => [],
    agent_deposit: () => ({}),
  } as never,
})
const packet = (body: object) => dispatch_app({ type: 'server/packet', packet: body as never })
packet({ type: 'packet/connection_accepted', stage: 'signed', address: OWNER })
packet({
  type: 'packet/characters',
  characters: [hero('0xhero_a', 'Nox', 'senshi', 42), hero('0xhero_b', 'Ivy', 'yajin', 7)],
})
packet({ type: 'packet/inventory', items: inventory })
packet({ type: 'packet/listings', listings: own_listings, kiosk_versions: { [KIOSK]: '7' } })
packet({
  type: 'packet/market_history',
  sales: [
    {
      id: '1:1:1',
      object: '0xsold',
      kind: 'item',
      name: 'Gnawed Branch',
      item_type: 'gnawed_branch',
      amount: 10,
      price_mist: '2000000000',
      counterparty: `0x${'c3'.repeat(32)}`,
      ts_ms: Date.now() - 3_600_000,
    },
  ],
  revenue_30d_mist: '2000000000',
  total: 1,
  profits: [{ kiosk: KIOSK, amount_mist: '1800000000' }],
})
packet({
  type: 'packet/market_types',
  items: ['green_mushroom_powder', 'gnawed_branch', 'gravebrand'].map((item_type) => {
    const { name, category, level } = items_by_type[item_type]!
    return {
      item_type,
      name,
      category,
      level,
      quote: { lots: { 1: '100000000', 10: '900000000' }, units: 40, change_bps: null },
    }
  }),
})
dispatch_app({
  type: 'wallet/refreshed',
  balance_mist: 12_500_000_000n,
  kares_balance: 4_200_000_000_000n,
  gas_spent_mist: 3_000_000n,
})

packet({
  type: 'packet/giftcards',
  giftcards: [...rolled_item_types().keys()]
    .slice(0, Number(search.get('gifts') ?? 0))
    .map((template, index) => ({ id: `0xgift_${index}`, template, amount: 1 + (index % 3) })),
})

/** What the owner check answers when it found no agent, or could not be asked. */
const answer_owner = (answer: string): void => {
  dispatch_app({ type: 'agent/connection_refresh' })
  const { wallet, agent_connection } = read_app_state().session
  const unreachable = answer === 'unreachable'
  dispatch_app({
    type: 'agent/connection_result',
    wallet: wallet!,
    generation: agent_connection.generation,
    response: unreachable
      ? null
      : { owner: OWNER, status: 'disconnected', bot: null, recovery_bots: [], expires_at: null },
    pairing: null,
    failure: unreachable ? 'unavailable' : null,
  })
}

/** The owner's verified bot, and its bag through the owner's observation. */
const pair_bot = (): void => {
  dispatch_app({ type: 'agent/connection_refresh' })
  const { wallet, agent_connection } = read_app_state().session
  const bot = {
    id: 'bot-1',
    address: BOT,
    multisig_public_key: 'AQID',
    generation: 1,
    policy_revision: 1,
    status: 'ready' as const,
  }
  dispatch_app({
    type: 'agent/connection_result',
    wallet: wallet!,
    generation: agent_connection.generation,
    response: { owner: OWNER, status: 'connected', bot, recovery_bots: [], expires_at: Date.now() + 3_600_000 },
    pairing: { address: BOT, multisig_public_key: 'AQID', signer_mode: 'host-persistent' },
    failure: null,
  })
  const pairing = read_app_state().session.inventory_pairing!
  dispatch_app({
    type: 'agent/inventory_balances',
    wallet: wallet!,
    pairing,
    sui_balance_mist: 3_100_000_000n,
    kares_balance: 0n,
  })
  const id = read_app_state().session.agent_inventory.serial
  packet({
    type: 'packet/inventory_observed',
    id,
    packet: {
      type: 'packet/inventory',
      items: [
        row('gnawed_branch', '0xbot_branch_a', 40, '0xkiosk_bot'),
        row('gnawed_branch', '0xbot_branch_b', 2, '0xkiosk_bot'),
      ],
    },
  })
}

// `?holder`: a Slush wallet is connected as the external holder wallet.
if (search.has('holder'))
  dispatch_app({
    type: 'external_wallet/connected',
    sequence: read_app_state().external_wallet.sequence,
    session: {
      address: `0x9036f4${'0'.repeat(52)}2373a7`,
      wallet_name: 'Slush',
      identity: 'wallet',
      is_transaction_idle: () => true,
    } as never,
  })
// `?no_bot`: an account whose bot the page cannot know, as on a build without the bot service.
const agent = search.get('agent')
if (agent) answer_owner(agent)
else if (!search.has('no_bot')) pair_bot()
dispatch_app({
  type: 'location/changed',
  location: { pathname: `/${search.get('page') ?? 'portfolio'}`, search: '', hash: location.hash },
})
createRoot(document.getElementById('root')!).render(<SiteShell />)
