// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { browser_auth_storage } from '../auth_storage.ts'

import { agent_identity_storage_key, saved_recovery_identities } from './pairing_storage.ts'
import { owner_connected } from './owner_state.ts'
import { AgentRecallPanel } from './AgentRecallPanel.tsx'

/** Historical identities remain recoverable, but never select the current hosted wallet. */
export const AgentRecovery = ({
  copy,
  mode,
  offline,
}: Readonly<{ copy: AppCopy; mode: 'setup' | 'inventory'; offline?: boolean }>) => {
  const wallet = useAppStore((app) => app.session.wallet)
  const connection = useAppStore((app) => app.session.agent_connection.response) ?? { bot: null, recovery_bots: [] }
  const connected = useAppStore((app) => owner_connected(app.session))
  const current = useAppStore((app) => app.session.inventory_pairing?.address)
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const stored = (event: Readonly<StorageEvent>) => {
      if (wallet && (event.key === null || event.key === agent_identity_storage_key(wallet.address))) refresh()
    }
    const focused = () => refresh()
    window.addEventListener('storage', stored)
    window.addEventListener('focus', focused)
    return () => {
      window.removeEventListener('storage', stored)
      window.removeEventListener('focus', focused)
    }
  }, [wallet])
  const owned = [...connection.recovery_bots, ...(connection.bot ? [connection.bot] : [])]
  const identities = [
    ...new Map(
      [
        ...saved_recovery_identities(wallet, browser_auth_storage()),
        ...owned.map(({ address, multisig_public_key }) => ({
          address,
          multisig_public_key,
          signer_mode: 'disposable' as const,
        })),
      ].map((row) => [row.address, row])
    ).values(),
  ].filter((row) => row.address !== current)
  if (!wallet) return null
  if ([!identities.length, offline, mode === 'inventory' && connected].some(Boolean)) return null
  return (
    <details className="agent-kiosk__characters">
      <summary>
        {copy.ui.agent_other_wallets} · {identities.length}
      </summary>
      {identities.map((pairing) => (
        <section key={pairing.address}>
          <output className="block break-all">{pairing.address}</output>
          <AgentRecallPanel wallet={wallet} pairing={pairing} copy={copy} />
        </section>
      ))}
    </details>
  )
}
