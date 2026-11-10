// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import { Button } from '@aresrpg/ui'
import { pre_submission_failure } from '@aresrpg/sdk/transaction-error'

import { DigestLink, SendModalShell } from '../components/SendModalShell.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { read_app_state, useAppStore } from '../store.ts'
import { readable_transaction_error, run_direct_transaction } from '../transaction_guard.ts'

import { execute_agent_transfer } from './agent_transaction.ts'
import { character_send_current, character_send_eligible } from './character_send.ts'
import './agent_setup.css'

type SendState = Readonly<{
  phase: 'idle' | 'pending' | 'failed' | 'blocked' | 'done'
  error?: string
  digest?: string
}>

const useCharacterSend = (character_id: string) => {
  const session = useAppStore((app) => app.session)
  const [wallet] = useState(session.wallet)
  const [pairing] = useState(session.inventory_pairing ?? session.agent_pairing_candidate)
  const [state, report] = useState<SendState>({ phase: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data -- This component lifetime ref cancels stale preflight work.
    mounted.current = true
    return () => {
      // eslint-disable-next-line functional/immutable-data -- Cleanup retires the same mounted lifetime.
      mounted.current = false
    }
  }, [])
  const character = session.characters.find(({ id }) => id === character_id)
  const eligible = character_send_eligible(character)
  const pending = state.phase === 'pending'
  const ready = wallet && pairing && eligible && character_send_current(session, wallet, pairing, character)
  const send = () => {
    if (!ready || !['idle', 'failed'].includes(state.phase)) return
    const operation = run_direct_transaction(() =>
      execute_agent_transfer({
        actions: wallet.agent_transfer,
        intent: { kind: 'offer', character_id: character.id, kiosk: character.kiosk, recipient: pairing.address },
        is_current: () =>
          mounted.current && character_send_current(read_app_state().session, wallet, pairing, character),
      })
    )
    if (!operation) return
    report({ phase: 'pending' })
    void operation.then(
      ({ digest }) => report({ phase: 'done', digest }),
      (error) =>
        report({
          phase: pre_submission_failure(error) ? 'failed' : 'blocked',
          error: readable_transaction_error(error),
        })
    )
  }
  return { active: !!wallet && session.wallet === wallet, pairing, character, state, pending, ready, eligible, send }
}

/** One deliberate offer for the exact clicked character; claiming remains a separate action. */
export const AgentCharacterSend = ({
  character_id,
  copy,
  close,
}: Readonly<{
  character_id: string
  copy: AppCopy
  close: () => void
}>) => {
  const { active, pairing, character, state, pending, ready, eligible, send } = useCharacterSend(character_id)
  if (!active || !pairing) return null
  return (
    <SendModalShell title={copy.ui.agent_send} close={close} close_label={copy.wallet_close} locked={pending}>
      <section className="agent-character-send" data-agent-character-send={character_id}>
        <strong>{character?.name ?? character_id}</strong>
        <output className="agent-character-id">{character_id}</output>
        <p>{copy.ui.agent_character_offer_hint}</p>
        {!ready && <p role="status">{copy.ui.agent_verify_mismatch}</p>}
        {!eligible && <p role="alert">{copy.ui.agent_transfer_unavailable}</p>}
        <CharacterSendOutcome state={state} copy={copy} ready={!!ready} send={send} />
      </section>
    </SendModalShell>
  )
}

const CharacterSendOutcome = ({
  state,
  copy,
  ready,
  send,
}: Readonly<{
  state: SendState
  copy: AppCopy
  ready: boolean
  send: () => void
}>) => {
  const pending = state.phase === 'pending'
  return (
    <>
      {state.error && <p role="alert">{state.error}</p>}
      {state.digest ? (
        <DigestLink copy={copy} digest={state.digest} />
      ) : (
        <Button
          tone="primary"
          className="agent-connect"
          onClick={send}
          disabled={!ready || pending || state.phase === 'blocked'}
        >
          {pending ? copy.ui.agent_sending : copy.ui.agent_send}
        </Button>
      )}
    </>
  )
}
