// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useReducer } from 'react'
import { Button, SelectionGrid } from '@aresrpg/ui'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk'
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { AgentRecall } from '@aresrpg/sdk/agent-recall'
import type { AgentInventory } from '@aresrpg/sdk/agent-inventory'
import type { AgentAssetIntent } from '@aresrpg/sdk/agent-asset-transfer'
import type { AgentItemReturnOffer } from '@aresrpg/sdk/agent-returns'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'
import { select_inventory_item } from '../characters/inventory_selection.ts'
import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { readable_transaction_error } from '../transaction_guard.ts'

import { AgentTransferReview } from './AgentTransferReview.tsx'

type State = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'failed'
  inventory?: AgentInventory
  incoming: readonly AgentItemReturnOffer[]
  selected: readonly string[]
  received: readonly string[]
  sui: string
  kares: string
  reserve: string
  error?: string
  incoming_error?: string
  auxiliary?: Readonly<{ kind: 'unstake' | 'delist' | 'collect'; id: string }>
}>
type Input = Readonly<
  | { type: 'load' }
  | {
      type: 'loaded'
      inventory?: AgentInventory
      incoming: readonly AgentItemReturnOffer[]
      error?: string
      incoming_error?: string
    }
  | { type: 'select'; ids: readonly string[]; incoming: boolean }
  | { type: 'edit'; field: 'sui' | 'kares' | 'reserve'; value: string }
  | { type: 'auxiliary'; kind: 'unstake' | 'delist' | 'collect'; id: string }
>
const initial: State = {
  phase: 'idle',
  incoming: [],
  selected: [],
  received: [],
  sui: '',
  kares: '',
  reserve: format_sui(GAS_BUDGET_MIST),
}
const reduce = (state: State, input: Input): State => {
  switch (input.type) {
    case 'load':
      return { ...initial, phase: 'loading' }
    case 'loaded':
      return {
        ...initial,
        phase: input.inventory ? 'ready' : 'failed',
        inventory: input.inventory,
        incoming: input.incoming,
        error: input.error,
        incoming_error: input.incoming_error,
      }
    case 'select':
      return input.incoming ? { ...state, received: input.ids } : { ...state, selected: input.ids }
    case 'edit':
      return { ...state, [input.field]: input.value }
    case 'auxiliary':
      return { ...state, auxiliary: { kind: input.kind, id: input.id } }
  }
}
export const AgentInventoryPanel = ({
  recall,
  wallet,
  copy,
  pairing,
}: Readonly<{ recall: AgentRecall; wallet: AuthSession; copy: AppCopy; pairing?: AgentPairingIdentity }>) => {
  const [state, dispatch] = useReducer(reduce, initial)
  const refresh = () => {
    if (state.phase === 'loading') return
    dispatch({ type: 'load' })
    void Promise.allSettled([recall.read_inventory(), recall.read_incoming_items()]).then(([inventory, incoming]) =>
      dispatch({
        type: 'loaded',
        inventory: inventory.status === 'fulfilled' ? inventory.value : undefined,
        error: inventory.status === 'rejected' ? readable_transaction_error(inventory.reason) : undefined,
        incoming: incoming.status === 'fulfilled' ? incoming.value : [],
        incoming_error: incoming.status === 'rejected' ? readable_transaction_error(incoming.reason) : undefined,
      })
    )
  }
  const intent = inventory_offer(state, wallet.address)
  const positions = state.inventory?.positions ?? []
  const position = positions.find((row) => row.id === state.auxiliary?.id && state.auxiliary?.kind === 'unstake')
  return (
    <section className="space-y-3 break-all" data-agent-inventory="">
      <h3>{copy.ui.agent_inventory}</h3>
      <p>{copy.ui.agent_asset_scope}</p>
      <Button onClick={refresh} disabled={state.phase === 'loading'}>
        {copy.ui.agent_asset_refresh}
      </Button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.inventory && (
        <>
          <p>
            SUI: {format_sui(BigInt(state.inventory.sui_mist), 9)} · KARES:{' '}
            {state.inventory.kares_mist === null
              ? copy.ui.agent_asset_unconfigured
              : format_sui(BigInt(state.inventory.kares_mist), 9)}
          </p>
          <SelectionGrid
            selected={state.selected}
            on_change={(ids) =>
              dispatch({
                type: 'select',
                incoming: false,
                ids: ids.filter((id) =>
                  state.inventory!.items.some((row) => row.item.id === id && row.status !== 'listed')
                ),
              })
            }
            className="grid grid-cols-4 gap-2"
          >
            {state.inventory.items.map((row) => (
              <div key={row.item.id}>
                <InventoryItemCell
                  item={row.item}
                  disabled={row.status === 'listed'}
                  aria-pressed={state.selected.includes(row.item.id)}
                  class_name={state.selected.includes(row.item.id) ? 'is-selected' : ''}
                  onClick={() =>
                    dispatch({
                      type: 'select',
                      incoming: false,
                      ids: select_inventory_item(state.selected, row.item.id, true),
                    })
                  }
                />
                <p className="text-xs">
                  {row.exclusive ? copy.ui.agent_asset_reserved : copy.ui[`agent_asset_${row.status}`]}
                </p>
                {row.status === 'listed' && !row.exclusive && (
                  <Button onClick={() => dispatch({ type: 'auxiliary', kind: 'delist', id: row.item.id })}>
                    {copy.ui.agent_asset_delist}
                  </Button>
                )}
              </div>
            ))}
          </SelectionGrid>
          <div className="grid gap-2">
            {(['sui', 'kares', 'reserve'] as const).map((field) => (
              <label key={field}>
                {copy.ui[`agent_asset_${field}`]}
                <input
                  className="block w-full bg-black text-white"
                  inputMode="decimal"
                  value={state[field]}
                  disabled={field === 'kares' && state.inventory?.kares_mist === null}
                  onChange={(event) => dispatch({ type: 'edit', field, value: event.target.value })}
                />
              </label>
            ))}
          </div>
          {intent && (
            <AgentTransferReview
              key={JSON.stringify(intent)}
              wallet={wallet}
              actions={recall.transfer}
              funding_pairing={pairing}
              intent={intent}
              copy={copy}
              allow_submit
            />
          )}
          <AuxiliaryReview pairing={pairing} state={state} wallet={wallet} recall={recall} copy={copy} />
          <h4>{copy.ui.agent_asset_proceeds}</h4>
          {state.inventory.proceeds.map((row) => (
            <Button key={row.kiosk} onClick={() => dispatch({ type: 'auxiliary', kind: 'collect', id: row.kiosk })}>
              {copy.ui.agent_asset_collect}: {format_sui(BigInt(row.sui_mist), 9)} SUI · {row.kiosk}
            </Button>
          ))}
          <h4>{copy.ui.agent_asset_positions}</h4>
          {positions.map((row) => (
            <Button key={row.id} onClick={() => dispatch({ type: 'auxiliary', kind: 'unstake', id: row.id })}>
              {copy.ui.agent_asset_unstake}: {format_sui(BigInt(row.amount), 9)} KARES · {row.id}
            </Button>
          ))}
          {position && (
            <AgentTransferReview
              key={position.id}
              wallet={wallet}
              actions={recall.transfer}
              funding_pairing={pairing}
              copy={copy}
              allow_submit
              intent={{ kind: 'asset_unstake', items: [position] }}
            />
          )}
          <details>
            <summary>{copy.ui.agent_asset_owned}</summary>
            {[...state.inventory.owned, ...state.inventory.other_kiosk_objects].map((row) => (
              <p key={row.id}>
                {row.id} · {row.type}
              </p>
            ))}
          </details>
        </>
      )}
      <IncomingItems
        state={state}
        wallet={wallet}
        copy={copy}
        select={(ids) => dispatch({ type: 'select', ids, incoming: true })}
      />
    </section>
  )
}

export const inventory_offer = (
  state: Pick<State, 'inventory' | 'selected' | 'sui' | 'kares' | 'reserve'>,
  recipient: string
): AgentAssetIntent | null => {
  const sui = asset_amount(state.sui)
  const kares = asset_amount(state.kares)
  const reserve = asset_amount(state.reserve)
  if ([sui, kares, reserve].includes(null)) return null
  const items = (state.inventory?.items ?? [])
    .filter((row) => state.selected.includes(row.item.id) && row.status !== 'listed')
    .map((row) => ({
      item_id: row.item.id,
      kiosk: row.item.kiosk,
      version: row.item.version!,
      direct: row.direct,
      character_id: row.character_id,
      slot: row.slot,
    }))
  if ([!items.length, sui === 0n, kares === 0n].every(Boolean)) return null
  return {
    kind: 'asset_offer',
    recipient,
    items,
    sui_mist: String(sui),
    kares_mist: String(kares),
    reserve_mist: String(reserve),
  }
}

const IncomingItems = ({
  state,
  wallet,
  copy,
  select,
}: Readonly<{ state: State; wallet: AuthSession; copy: AppCopy; select: (ids: readonly string[]) => void }>) => {
  const chosen = state.incoming.filter((row) => state.received.includes(row.purchase_cap))
  const source = chosen[0]?.agent_address
  return (
    <div className="space-y-2">
      <h4>{copy.ui.agent_asset_incoming}</h4>
      {state.incoming_error && <p role="alert">{state.incoming_error}</p>}
      {state.incoming.map((row) => (
        <label className="block" key={row.purchase_cap}>
          <input
            type="checkbox"
            checked={state.received.includes(row.purchase_cap)}
            onChange={(event) =>
              select(
                event.target.checked
                  ? [...state.received, row.purchase_cap]
                  : state.received.filter((id) => id !== row.purchase_cap)
              )
            }
          />
          {row.item_id} · {row.seller_kiosk}
        </label>
      ))}
      {source && (
        <>
          <AgentTransferReview
            key={JSON.stringify(['claim', chosen])}
            wallet={wallet}
            copy={copy}
            allow_submit
            intent={{ kind: 'asset_claim', agent_address: source, items: chosen }}
          />
          <AgentTransferReview
            key={JSON.stringify(['cancel', chosen])}
            wallet={wallet}
            copy={copy}
            allow_submit
            intent={{ kind: 'asset_cancel', agent_address: source, items: chosen }}
          />
        </>
      )}
    </div>
  )
}

const AuxiliaryReview = ({
  state,
  wallet,
  recall,
  copy,
  pairing,
}: Readonly<{
  state: State
  wallet: AuthSession
  recall: AgentRecall
  copy: AppCopy
  pairing?: AgentPairingIdentity
}>) => {
  const choice = state.auxiliary
  if (!choice || !state.inventory) return null
  if (choice.kind === 'collect')
    return (
      <AgentTransferReview
        key={JSON.stringify(choice)}
        wallet={wallet}
        actions={recall.transfer}
        funding_pairing={pairing}
        copy={copy}
        allow_submit
        intent={{ kind: 'asset_collect', items: [{ kiosk: choice.id }] }}
      />
    )
  if (choice.kind !== 'delist') return null
  const row = state.inventory.items.find((row) => row.item.id === choice.id && row.status === 'listed')
  return row ? (
    <AgentTransferReview
      key={JSON.stringify(choice)}
      wallet={wallet}
      actions={recall.transfer}
      funding_pairing={pairing}
      copy={copy}
      allow_submit
      intent={{
        kind: 'asset_delist',
        items: [{ item_id: row.item.id, kiosk: row.item.kiosk, version: row.item.version! }],
      }}
    />
  ) : null
}

const asset_amount = (value: string): bigint | null =>
  /^(?:0(?:\.0{1,9})?)?$/.test(value.trim()) ? 0n : parse_sui_amount(value)
