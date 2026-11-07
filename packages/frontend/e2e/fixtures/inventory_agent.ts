// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'
import type { AgentTransferActions, AgentTransferIntent } from '@aresrpg/sdk/agent-transfer-actions'
import type { AgentRecall } from '@aresrpg/sdk/agent-recall'

import type { AuthSession } from '../../src/auth.ts'

declare global {
  interface Window {
    agent_prepared: readonly Readonly<{ sender: string; intent: AgentTransferIntent }>[]
    agent_confirmed: readonly Readonly<{ sender: string; intent: AgentTransferIntent }>[]
  }
}

/** Synthetic mainnet-shaped data only. This fixture owns no SDK, RPC client, key or signer. */
export const inventory_agent_fixture = (items: readonly ItemRow[], fail_first: boolean) => {
  window.agent_prepared = []
  window.agent_confirmed = []
  const actions = (sender: string): AgentTransferActions => ({
    sender,
    prepare: async (intent) => {
      window.agent_prepared = [...window.agent_prepared, { sender, intent }]
      return {
        intent,
        sender,
        network: 'mainnet',
        gas_mist: '1000000',
        gas_budget_mist: '2000000',
        confirm: async () => {
          window.agent_confirmed = [...window.agent_confirmed, { sender, intent }]
          return { digest: 'synthetic-receipt', receipt: {} as never }
        },
      }
    },
  })
  const recall = {
    transfer: actions('0xagent'),
    read_inventory: async () => ({
      items: items
        .filter(({ item_type }) => ['wheat', 'siluri'].includes(item_type))
        .map((item) => ({
          item: { ...item, id: `agent-${item.id}`, kiosk: '0xagentkiosk', version: '1' },
          status: 'available' as const,
        })),
      sui_mist: '4000000000',
      kares_mist: null,
      positions: [],
      proceeds: [],
      owned: [],
      other_kiosk_objects: [],
    }),
    read_incoming_items: async () => [],
    read_deposit_items: async () => [
      {
        item_id: 'offered-item',
        seller_kiosk: '0xkiosk',
        purchase_cap: 'synthetic-cap',
        recipient: '0xagent',
        agent_address: '0xowner',
      },
    ],
  } as unknown as AgentRecall
  let reads = 0
  return {
    pairing: {
      address: '0xagent',
      multisig_public_key: 'synthetic-public-identity',
      signer_mode: 'host-persistent' as const,
    },
    wallet: {
      agent_deposit: () => actions('0xowner'),
      agent_transfer: actions('0xowner'),
      read_agent_recall: async () => {
        reads += 1
        if (fail_first && reads === 1) throw new Error('Synthetic inventory read failed')
        return recall
      },
    } satisfies Pick<AuthSession, 'agent_deposit' | 'agent_transfer' | 'read_agent_recall'>,
  }
}
