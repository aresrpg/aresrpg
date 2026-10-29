// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState, type ReactNode } from 'react'
import { cap_mist, type SpotProof } from '@aresrpg/immutable/allocation'
import type { BlastSnapshot } from '@aresrpg/sdk/blast'

import type { AuthSession } from '../auth.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { WalletView } from '../wallet/model.ts'
import { FundingModal } from '../components/AddFundsModal.tsx'

import type { AllocationRuntime, AllocationState } from './runtime.ts'
import { card_member, card_veteran } from './assets.ts'
import { BuyDialog } from './BuyDialog.tsx'
import { SalePanel } from './SalePanel.tsx'
import { useSpotSale } from './useSpotSale.ts'
import { wallet_label, type CardView } from './view.ts'

const FACES: Readonly<Record<string, string>> = { veteran: card_veteran, member: card_member }
const is_google = (card: CardView, session: AuthSession | null): boolean =>
  !!card.wallet.game_wallet || (session?.identity === 'zklogin' && session.address === card.wallet.address)
const spot_label = (card: CardView, session: AuthSession | null, text: CopyText): string =>
  is_google(card, session) ? text('google_wallet') : wallet_label(card.wallet, session) || text('wallet')
type SpotSale = ReturnType<typeof useSpotSale>
type Award = NonNullable<CardView['award']>
type Context = Readonly<{
  sale: BlastSnapshot
  state: AllocationState
  spot_sale: SpotSale
  signer: (address: string) => AuthSession | null
  proof: (address: string) => SpotProof | null
  now: number
  text: CopyText
  locale: Locale
}>

const CardSale = ({
  card,
  award,
  context,
  open,
  connect,
}: Readonly<{ card: CardView; award: Award; context: Context; open: () => void; connect: () => void }>) => {
  const { sale, state, spot_sale, now, text, locale } = context
  const { address } = card.wallet
  const wallet = context.signer(address)
  return (
    <SalePanel
      label={spot_label(card, state.session, text)}
      address={address}
      cap={cap_mist(award.tier)}
      sale={sale}
      commitment={spot_sale.state.commitments[address]}
      balance={spot_sale.state.balances[address] ?? null}
      signed={!!wallet}
      ready={!!context.proof(address)}
      busy={!!spot_sale.state.task}
      state={spot_sale.state}
      now={now}
      text={text}
      locale={locale}
      act={{
        buy: open,
        claim: () => wallet && spot_sale.dispatch({ type: 'request', task: { kind: 'claim', wallet } }),
        connect,
      }}
    />
  )
}

const Purchase = ({
  card,
  award,
  wallet,
  proof,
  context,
  close,
  add_funds,
}: Readonly<{
  card: CardView
  award: Award
  wallet: AuthSession
  proof: SpotProof
  context: Context
  close: () => void
  add_funds: (cost: bigint) => void
}>) => {
  const { spot_sale, text } = context
  const { commitments, balances, task, error } = spot_sale.state
  return (
    <BuyDialog
      spot={{
        address: wallet.address,
        label: spot_label(card, context.state.session, text),
        tier: text(award.tier),
        face: FACES[award.tier]!,
        cap: cap_mist(award.tier),
        bought: commitments[wallet.address]?.quote ?? 0n,
        balance: balances[wallet.address] ?? null,
      }}
      sale={context.sale}
      busy={task?.wallet === wallet}
      failed={error?.address === wallet.address}
      text={text}
      locale={context.locale}
      close={close}
      buy={(amount) => spot_sale.dispatch({ type: 'request', task: { kind: 'buy', wallet, amount, proof } })}
      add_funds={add_funds}
    />
  )
}

type Funding = Readonly<{ wallet: AuthSession; cost: bigint }>
const Overlays = ({
  selected,
  funding,
  context,
  external,
  copy,
  close,
  set_funding,
}: Readonly<{
  selected: Readonly<{ card: CardView; award: Award }> | undefined
  funding: Funding | null
  context: Context
  external: WalletView
  copy: AppCopy
  close: () => void
  set_funding: (funding: Funding | null) => void
}>) => {
  const address = selected?.card.wallet.address ?? ''
  const wallet = context.signer(address)
  const proof = context.proof(address)
  const { spot_sale } = context
  return (
    <>
      {selected && wallet && proof && (
        <Purchase
          {...selected}
          wallet={wallet}
          proof={proof}
          context={context}
          close={close}
          add_funds={(cost) => set_funding({ wallet, cost })}
        />
      )}
      {funding && (
        <FundingModal
          address={funding.wallet.address}
          copy={copy}
          cost_mist={funding.cost}
          funding={{
            wallet: external,
            source: external.state.session as AuthSession | null,
            balance: spot_sale.state.balances[funding.wallet.address] ?? null,
          }}
          on_close={() => {
            set_funding(null)
            void spot_sale.refresh([], [funding.wallet])
          }}
        />
      )}
    </>
  )
}

/** Cards with an award get a sale panel; signing uses whichever connected session owns the address. */
export const useSaleSpots = ({
  sale,
  cards,
  state,
  runtime,
  external,
  copy,
  text,
  locale,
  now,
}: Readonly<{
  sale: BlastSnapshot | null
  cards: readonly CardView[]
  state: AllocationState
  runtime: AllocationRuntime
  external: WalletView
  copy: AppCopy
  text: CopyText
  locale: Locale
  now: number
}>) => {
  const signers = [state.session, external.state.session as AuthSession | null].filter(
    (session): session is AuthSession => !!session
  )
  const spots = cards.flatMap((card) => (card.award ? [{ card, award: card.award }] : []))
  const spot_sale = useSpotSale(
    spots.map(({ card }) => card.wallet.address),
    signers,
    sale?.version ?? null
  )
  const [buying, set_buying] = useState<string | null>(null)
  const [funding, set_funding] = useState<Funding | null>(null)
  const { receipt } = spot_sale.state
  useEffect(() => {
    if (receipt?.kind === 'buy') set_buying((current) => (current === receipt.address ? null : current))
  }, [receipt])
  if (!sale) return { spot: (): ReactNode => null, overlays: null }
  const context: Context = {
    sale,
    state,
    spot_sale,
    now,
    text,
    locale,
    signer: (address) => signers.find((session) => session.address === address) ?? null,
    proof: (address) => state.status?.proofs?.find((row) => row.address === address)?.proof ?? null,
  }
  // A Google wallet signs in through the page's Google login; a wallet app opens its own approval.
  const connect = (card: CardView): void =>
    is_google(card, state.session)
      ? runtime.dispatch({ type: 'request', task: { kind: 'google' } })
      : external.dispatch({ type: 'external_wallet/authorize', wallet_name: card.wallet.label })
  const spot = (card: CardView): ReactNode =>
    card.award && (
      <CardSale
        card={card}
        award={card.award}
        context={context}
        open={() => set_buying(card.wallet.address)}
        connect={() => connect(card)}
      />
    )
  const overlays = (
    <Overlays
      selected={spots.find(({ card }) => card.wallet.address === buying)}
      funding={funding}
      context={context}
      external={external}
      copy={copy}
      close={() => {
        set_buying(null)
        spot_sale.dispatch({ type: 'dismiss' })
      }}
      set_funding={set_funding}
    />
  )
  return { spot, overlays }
}
