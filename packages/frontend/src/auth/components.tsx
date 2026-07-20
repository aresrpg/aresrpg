// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { list_wallets, subscribe_wallets, type ConnectableWallet } from './index'

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

// Wallets register asynchronously (an extension injects itself after page load), so read once then re-read
// on every register/unregister — a wallet enabled after first paint appears without a manual refresh.
function use_connectable_wallets(): ConnectableWallet[] {
  const [wallets, set_wallets] = useState<ConnectableWallet[]>(list_wallets)
  useEffect(() => {
    set_wallets(list_wallets()) // catch any that registered between first render and this effect
    return subscribe_wallets(() => set_wallets(list_wallets()))
  }, [])
  return wallets
}

// NON-PRODUCTION wallet-standard connect (#73). The login popup renders this only when the build-time gate
// allows it (preview/dev — never a production release). Each installed Sui wallet connects through the shared
// auth store's login(name) — the SAME path the Google/zkLogin wallet uses — so the connected address flows
// into the same store shape and every downstream read stays identity-agnostic. A wallet session self-pays
// every transaction: sponsorship is zkLogin-only (enforced structurally in tx/index.ts).
export function WalletConnectSection({
  on_connect,
  loading,
}: {
  on_connect: (wallet_name: string) => void
  loading?: boolean
}) {
  const { t } = useTranslation()
  const wallets = use_connectable_wallets()

  if (wallets.length === 0)
    return <div className="text-muted/70 text-[10px] tracking-[0.12em] text-center py-1">{t('auth.no_wallet_detected')}</div>

  return (
    <div className="flex flex-col items-stretch gap-2 w-full">
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          onClick={() => on_connect(wallet.name)}
          disabled={loading}
          className="flex items-center justify-center gap-2.5 w-full h-11 border border-gold/30 text-gold text-[11px] tracking-[0.16em] uppercase font-semibold cursor-pointer transition-all hover:border-gold/60 hover:bg-gold/8 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderRadius: 5 }}
        >
          {wallet.icon ? <img src={wallet.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} /> : null}
          <span>{wallet.name}</span>
        </button>
      ))}
    </div>
  )
}
