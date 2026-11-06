// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_asset_intent } from '@aresrpg/sdk/agent-asset-transfer'
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { pre_submission_failure } from '@aresrpg/sdk/transaction-error'
import { useReducer, useState } from 'react'
import { Button } from '@aresrpg/ui'
import type {
  AgentTransferActions,
  AgentTransferIntent,
  AgentTransferReview as Review,
} from '@aresrpg/sdk/agent-transfer-actions'

import { funding_recipient_current, recall_funding_authorization } from '../funding/recipient.ts'
import { FundingModal } from '../components/AddFundsModal.tsx'
import { external_wallet_view } from '../wallet/view.ts'
import { gas_empty_error } from '../toast.ts'
import { format_sui } from '../wallet_amount.ts'
import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { readable_transaction_error, run_direct_transaction } from '../transaction_guard.ts'

type State = Readonly<{
  phase: 'idle' | 'preparing' | 'review' | 'submitting' | 'done' | 'failed' | 'preflight_failed'
  review?: Review
  digest?: string
  error?: string
}>
type Input = Readonly<
  | { type: 'prepare' }
  | { type: 'review'; review: Review }
  | { type: 'submit' }
  | { type: 'done'; digest: string }
  | { type: 'failed' | 'preflight_failed'; error: string }
>
export const reduce_transfer_review = (state: State, input: Input): State => {
  switch (input.type) {
    case 'prepare':
      return { phase: 'preparing' }
    case 'review':
      return { phase: 'review', review: input.review }
    case 'submit':
      return { ...state, phase: 'submitting' }
    case 'done':
      return { phase: 'done', digest: input.digest }
    case 'failed':
    case 'preflight_failed':
      return { phase: input.type, error: input.error }
  }
}

export const AgentTransferOutcome = ({
  state,
  copy,
  allow_submit,
  confirm,
}: Readonly<{
  state: State
  copy: Pick<AppCopy, 'ui'>
  allow_submit: boolean
  confirm: () => void
}>) => {
  const t = copy.ui
  return (
    <>
      {state.phase === 'review' && state.review && (
        <>
          <p>
            {state.review.network} · {t.agent_transfer_gas}: {state.review.gas_mist} MIST
          </p>
          {state.review.gas_budget_mist && (
            <p>
              {t.agent_asset_fee_budget}: {state.review.gas_budget_mist} MIST
            </p>
          )}
          <p>{t.agent_transfer_step}</p>
          <Button onClick={confirm} disabled={!allow_submit}>
            {t.agent_transfer_confirm}
          </Button>
          {!allow_submit && <p>{t.agent_transfer_signer_missing}</p>}
        </>
      )}
      {['failed', 'preflight_failed'].includes(state.phase) && (
        <div role="alert">
          <p>{t.agent_transfer_failed}</p>
          <p>{state.error}</p>
        </div>
      )}
      {state.digest && (
        <p role="status">
          {t.agent_transfer_receipt}: <output>{state.digest}</output>
        </p>
      )}
    </>
  )
}

/** A single reviewed offer, claim or capability return. The caller owns the current identity.
 * Disposable pairing only mounts this with submission unavailable. */
export const AgentTransferReview = ({
  wallet,
  intent,
  copy,
  allow_submit,
  actions = wallet.agent_transfer,
  funding_pairing,
}: Readonly<{
  wallet: AuthSession
  intent: AgentTransferIntent
  copy: AppCopy
  allow_submit: boolean
  actions?: AgentTransferActions
  funding_pairing?: AgentPairingIdentity
}>) => {
  const [funding, set_funding] = useState(false)
  const [state, dispatch] = useReducer(reduce_transfer_review, { phase: 'idle' })
  const [origin_wallet] = useState(wallet)
  const [origin_intent] = useState(JSON.stringify(intent))
  const active =
    useAppStore((app) => app.session.wallet === origin_wallet) &&
    wallet === origin_wallet &&
    JSON.stringify(intent) === origin_intent
  const t = copy.ui
  const fail = (error: unknown, before_submission: boolean) => {
    if (gas_empty_error(error)) set_funding(true)
    dispatch({ type: before_submission ? 'preflight_failed' : 'failed', error: readable_transaction_error(error) })
  }
  const prepare = () => {
    if (!active || !can_check_transfer(state.phase)) return
    dispatch({ type: 'prepare' })
    void actions.prepare(intent).then(
      (review) => dispatch({ type: 'review', review }),
      (error) => fail(error, true)
    )
  }
  const confirm = () => {
    if (!active || !allow_submit || state.phase !== 'review' || !state.review) return
    const pending = run_direct_transaction(state.review.confirm)
    if (!pending) return
    dispatch({ type: 'submit' })
    void pending.then(
      (result) => dispatch({ type: 'done', digest: result.digest }),
      (error) => fail(error, pre_submission_failure(error))
    )
  }
  if (!active) return null
  return (
    <section className="space-y-2 break-all" data-agent-transfer-review="">
      <p>{t.agent_transfer_review}</p>
      <p>
        {t.agent_return_from}: {actions.sender}
      </p>
      <ReturnEquipmentList intent={intent} />
      <TransferIntentSummary intent={intent} copy={copy} />
      {intent.kind === 'offer' && (
        <p>
          {t.agent_transfer_recipient}: {intent.recipient}
        </p>
      )}
      <Button onClick={prepare} disabled={!can_check_transfer(state.phase)}>
        {t.agent_transfer_check}
      </Button>
      {funding && (
        <AgentFunding
          wallet={wallet}
          sender={actions.sender}
          pairing={funding_pairing}
          copy={copy}
          close={() => set_funding(false)}
        />
      )}
      <AgentTransferOutcome state={state} copy={copy} allow_submit={allow_submit} confirm={confirm} />
    </section>
  )
}

export const can_check_transfer = (phase: State['phase']): boolean =>
  ['idle', 'review', 'preflight_failed'].includes(phase)

const AgentFunding = ({
  wallet,
  sender,
  pairing,
  copy,
  close,
}: Readonly<{
  wallet: AuthSession
  sender: string
  pairing?: AgentPairingIdentity
  copy: AppCopy
  close: () => void
}>) => {
  const external = useAppStore((app) => app.external_wallet)
  const session = useAppStore((app) => app.session)
  const [authorization] = useState(() =>
    sender !== wallet.address && pairing ? recall_funding_authorization(session, pairing) : null
  )
  const current =
    sender === wallet.address
      ? funding_recipient_current(session, sender)
      : !!authorization && funding_recipient_current(session, sender, authorization)
  if (!current) return <p role="alert">{copy.ui.agent_funding_unverified}</p>
  return (
    <FundingModal
      address={sender}
      copy={copy}
      on_close={close}
      authorization={authorization ?? undefined}
      recipient_label={authorization ? copy.ui.add_funds_agent : undefined}
      funding={{
        wallet: external_wallet_view(external),
        source: external.session,
        balance: sender === wallet.address ? session.sui_balance_mist : null,
      }}
    />
  )
}

const ReturnEquipmentList = ({ intent }: Readonly<{ intent: AgentTransferIntent }>) =>
  is_asset_intent(intent) ? null : (
    <>
      {(intent.kind === 'offer' ? intent.unequip : intent.equipment)?.map((row) => (
        <p key={row.slot}>
          {row.slot}: <output>{row.item_id}</output>
        </p>
      ))}
    </>
  )

const TransferIntentSummary = ({ intent, copy }: Readonly<{ intent: AgentTransferIntent; copy: AppCopy }>) => {
  if (!is_asset_intent(intent))
    return <output>{intent.kind === 'offer' ? intent.character_id : intent.purchase_cap}</output>
  if (intent.kind === 'asset_collect')
    return (
      <p>
        {copy.ui.agent_asset_collect}: {intent.items.map((row) => row.kiosk).join(', ')}
      </p>
    )
  if (intent.kind === 'asset_delist')
    return (
      <p>
        {copy.ui.agent_asset_delist}: {intent.items.map((row) => row.item_id).join(', ')}
      </p>
    )
  if (intent.kind === 'asset_unstake')
    return (
      <p>
        {copy.ui.agent_asset_unstake}:{' '}
        {intent.items.map((row) => `${row.id}: ${format_sui(BigInt(row.amount), 9)} KARES`).join(', ')}
      </p>
    )
  if (intent.kind !== 'asset_offer')
    return (
      <p>
        {intent.kind === 'asset_claim' ? copy.ui.agent_asset_claim : copy.ui.agent_asset_cancel}:{' '}
        {intent.items.map((row) => row.item_id).join(', ')}
      </p>
    )
  return (
    <div>
      <p>
        {copy.ui.agent_transfer_recipient}: {intent.recipient}
      </p>
      {intent.items.map((row) => (
        <p key={row.item_id}>
          {row.item_id} · {row.kiosk}
        </p>
      ))}
      <p>
        SUI: {format_sui(BigInt(intent.sui_mist), 9)} · KARES: {format_sui(BigInt(intent.kares_mist), 9)}
      </p>
      <p>
        {copy.ui.agent_asset_reserve}: {format_sui(BigInt(intent.reserve_mist), 9)} SUI
      </p>
    </div>
  )
}
