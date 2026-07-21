// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectModal, useCurrentWallet } from '@mysten/dapp-kit'
import { isWalletWithRequiredFeatureSet, type WalletWithRequiredFeatures } from '@mysten/wallet-standard'

import { is_zklogin_wallet } from './zklogin_wallet'

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

export function GoogleButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center justify-center gap-3 w-full h-12 bg-white/95 text-gray-800 text-[12px] font-semibold tracking-wide hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      style={{ borderRadius: 5 }}
    >
      <GoogleIcon />
      <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
    </button>
  )
}

// The picker's candidate pool: any wallet-standard wallet capable of signing (the SAME required-feature
// set auth/index.ts's own is_sui_wallet checks — sui:signPersonalMessage + sui:signTransaction), EXCEPT
// the Enoki (Google/zkLogin) wallet — it keeps its own dedicated GoogleButton above, never doubled up
// inside the picker. Module-scope: a pure, stable predicate, not recreated every render.
const wallet_filter = (wallet: WalletWithRequiredFeatures): boolean =>
  isWalletWithRequiredFeatureSet(wallet, ['sui:signPersonalMessage', 'sui:signTransaction']) &&
  !is_zklogin_wallet(wallet)

// PURE — the dapp-kit connection -> session-bridge decision, extracted so it is unit-testable without a
// live wallet/DOM (this repo has no jsdom/RTL — renderToStaticMarkup can't await dapp-kit's async connect
// handshake; see auth/components.test.tsx). Returns the wallet name to adopt, or null while
// disconnected/connecting.
export function bridge_wallet_name(wallet_state: {
  isConnected: boolean
  currentWallet: { name: string } | null
}): string | null {
  return wallet_state.isConnected && wallet_state.currentWallet ? wallet_state.currentWallet.name : null
}

// NON-PRODUCTION wallet-standard connect (#73). The login popup renders this only when the build-time gate
// allows it (preview/dev — never a production release; auth/wallet_connect_gate.ts, asserted in its own
// test, never hidden by CSS). The picker is the REAL @mysten/dapp-kit ConnectModal (Mysten's official
// wallet picker) — maintainer ruling (public-repo review) replacing the old hand-rolled per-wallet button
// list. Our own gothic trigger opens it; the picker UI itself stays 100% the official component.
//
// SESSION BRIDGE: dapp-kit's own connection is transient UI plumbing, never a second auth home. The
// moment it lands a wallet, this feeds on_connect(name) — auth.tsx wires that to the SAME login(name) the
// Google/zkLogin button already uses, so the connected address lands in the ONE use_auth store shape and
// every downstream read stays identity-agnostic (unchanged from #73). A wallet already authorized by
// dapp-kit's own standard:connect answers login()'s follow-up connect() instantly per the wallet-standard
// spec (no second approval prompt), so this is not a double consent step for the player.
export function WalletConnectSection({
  on_connect,
  loading,
}: {
  on_connect: (wallet_name: string) => void
  loading?: boolean
}) {
  const { t } = useTranslation()
  const { currentWallet, isConnected } = useCurrentWallet()

  useEffect(() => {
    // Fires only on a genuine connection-state transition. `on_connect` is intentionally left out of the
    // dependency array: auth.tsx passes a fresh closure every render, and re-including it would re-fire
    // this (and re-call login()) on every unrelated re-render while a wallet stays connected.
    const wallet_name = bridge_wallet_name({ isConnected, currentWallet })
    if (wallet_name) on_connect(wallet_name)
  }, [isConnected, currentWallet])

  return (
    <ConnectModal
      walletFilter={wallet_filter}
      trigger={
        <button
          type="button"
          disabled={loading}
          className="flex items-center justify-center w-full h-11 border border-gold/30 text-gold text-[11px] tracking-[0.16em] uppercase font-semibold cursor-pointer transition-all hover:border-gold/60 hover:bg-gold/8 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderRadius: 5 }}
        >
          {t('auth.connect_wallet')}
        </button>
      }
    />
  )
}
