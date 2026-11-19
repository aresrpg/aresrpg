import type { ReactNode } from 'react'

import { IconButton, SegmentedControl } from '../components/controls.tsx'

export type WalletAmount = Readonly<{ value: string; unit: string }>
const Amount = ({ value, unit }: WalletAmount) => (
  <span className="aui-wallet-num">
    {value} <i>{unit}</i>
  </span>
)

/**
 * One wallet: who signs and its address, its main balance as the largest thing in view, a second
 * balance under it, then its actions. With several wallets a switch above shows one at a time.
 * Values arrive formatted; this component only paints them.
 */
export const WalletView = <T extends string>({
  wallets,
  signer,
  address,
  main,
  main_icon,
  second,
  second_icon,
  actions,
  children,
}: Readonly<{
  /** The switch between wallets; absent when the owner has one wallet. */
  wallets?: Readonly<{
    label: string
    value: T
    on_change: (value: T) => void
    options: readonly Readonly<{ value: T; label: string; icon?: ReactNode }>[]
  }>
  signer: string
  address: ReactNode
  main: WalletAmount
  main_icon: ReactNode
  second?: WalletAmount
  second_icon?: ReactNode
  actions: ReactNode
  children?: ReactNode
}>) => (
  <div className="aui-wallet">
    {wallets && <SegmentedControl {...wallets} />}
    <header className="aui-wallet-head">
      <div className="aui-wallet-line">
        <span className="aui-wallet-micro">{signer}</span>
        {address}
      </div>
      <div className="aui-wallet-total">
        {main_icon}
        <strong>{main.value}</strong>
        <span>{main.unit}</span>
      </div>
      {second && (
        <div className="aui-wallet-second">
          {second_icon}
          <Amount {...second} />
        </div>
      )}
    </header>
    <div className="aui-wallet-actions">{actions}</div>
    {children}
  </div>
)

export type TransferLeg = Readonly<{ name: string; icon: ReactNode; balance: WalletAmount | null }>

/**
 * A transfer between two wallets of one owner, laid out like an exchange: From over To in one
 * frame, and one button that swaps them. The amount, the coin and the action are the caller's.
 */
export const WalletTransfer = ({
  from_label,
  to_label,
  from,
  to,
  swap_label,
  swap,
  children,
}: Readonly<{
  from_label: string
  to_label: string
  from: TransferLeg
  to: TransferLeg
  swap_label: string
  /** Null while the direction cannot change. */
  swap: (() => void) | null
  children: ReactNode
}>) => (
  <div className="aui-wallet aui-wallet-transfer">
    <div className="aui-wallet-route">
      {(
        [
          [from_label, from],
          [to_label, to],
        ] as const
      ).map(([label, leg]) => (
        <div className="aui-wallet-leg" key={label}>
          <span className="aui-wallet-micro">{label}</span>
          <span className="aui-wallet-ico">{leg.icon}</span>
          <b>{leg.name}</b>
          {leg.balance && <Amount {...leg.balance} />}
        </div>
      ))}
      <IconButton
        className="aui-wallet-swap"
        label={swap_label}
        disabled={!swap}
        onClick={() => swap?.()}
        icon={
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M5 2v12M2 11l3 3 3-3M11 14V2M8 5l3-3 3 3" />
          </svg>
        }
      />
    </div>
    {children}
  </div>
)
