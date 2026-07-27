// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider, type Theme } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

import '@mysten/dapp-kit/dist/index.css'

import { SUI_NETWORK } from './index'

// Maintainer ruling (public-repo review, live-preview screenshot): the sign-in modal's wallet picker
// was a hand-rolled per-wallet button list — replace it with the REAL @mysten/dapp-kit ConnectModal
// (Mysten's official wallet picker), not another enumerated list. This module is the ONE home for the
// provider scaffolding dapp-kit's hooks/components require (README: QueryClientProvider >
// SuiClientProvider > WalletProvider) — see auth/components.tsx for the picker itself.
//
// JSON-RPC NOTE (does NOT reopen #23/D79 "no-jsonrpc" gate): SuiClientProvider is typed against
// @mysten/sui's SuiJsonRpcClient — WalletProvider throws without a SuiClientContext ancestor because it
// unconditionally calls useSuiClient() internally for its enableUnsafeBurner wiring, even with that flag
// off (verified against the installed @mysten/dapp-kit@1.1.3 source). This app never calls
// useSuiClientQuery/useSuiClient itself — the only dapp-kit hooks in use are ConnectModal +
// useCurrentWallet/useCurrentAccount, which never touch this client. It sits inert; every live read/write
// still routes through the SDK's gRPC/GraphQL clients (auth/index.ts, packages/sdk).
const query_client = new QueryClient()

// `network` is required alongside `url` by dapp-kit's NetworkConfig — the client it builds needs the
// chain identifier, not just an endpoint. One network only: this app never offers a network switcher.
const NETWORKS = { [SUI_NETWORK]: { url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK } } as const

// House Gothic Terminal theme, mapped onto dapp-kit's SUPPORTED theme contract — the sanctioned
// customization surface (never a CSS override fight against the shipped stylesheet). Colors reuse the
// ONE token home (index.css `@theme`) via CSS custom properties; radii match this exact login surface's
// existing 5px corners (GoogleButton / CenteredGlass / the Spectate button in pages/auth.tsx), not the
// harsher 0px in-app default — the modal pops up ON this page and should read as part of the same glass
// card, not a jarring foreign surface.
const gothic_dark_theme: Theme = {
  blurs: { modalOverlay: 'blur(7px)' },
  backgroundColors: {
    primaryButton: 'var(--color-gold)',
    primaryButtonHover: 'var(--color-gold-light)',
    outlineButtonHover: 'color-mix(in srgb, var(--color-gold) 8%, transparent)',
    walletItemHover: 'color-mix(in srgb, var(--color-gold) 8%, transparent)',
    walletItemSelected: 'color-mix(in srgb, var(--color-gold) 12%, transparent)',
    modalOverlay: 'rgba(10, 10, 15, 0.5)',
    modalPrimary: 'var(--color-surface)',
    modalSecondary: 'var(--color-bg)',
    iconButton: 'transparent',
    iconButtonHover: 'color-mix(in srgb, white 6%, transparent)',
    dropdownMenu: 'var(--color-surface)',
    dropdownMenuSeparator: 'var(--color-border)',
  },
  borderColors: { outlineButton: 'var(--color-border)' },
  colors: {
    primaryButton: 'var(--color-bg)',
    outlineButton: 'var(--color-gold)',
    body: 'var(--color-text)',
    bodyMuted: 'var(--color-muted)',
    bodyDanger: '#f87171',
    iconButton: 'var(--color-text)',
  },
  radii: { small: '5px', medium: '5px', large: '5px', xlarge: '5px' },
  shadows: {
    primaryButton: '0 0 20px color-mix(in srgb, var(--color-gold) 25%, transparent)',
    walletItemSelected: '0 0 12px color-mix(in srgb, var(--color-gold) 18%, transparent)',
  },
  fontWeights: { normal: '400', medium: '500', bold: '600' },
  fontSizes: { small: '11px', medium: '12px', large: '13px', xlarge: '14px' },
  typography: {
    fontFamily: 'var(--font-mono)',
    fontStyle: 'normal',
    lineHeight: '1.4',
    letterSpacing: '0.05em',
  },
}

// autoConnect + storage are OFF on purpose: auth/index.ts's own `last_wallet` localStorage key +
// reconnect_last() is the SINGLE session-restore home (#73 already established this for the hand-rolled
// buttons it replaces). Letting dapp-kit run a second silent auto-reconnect on mount would be a parallel
// auth home racing the real one — no CLIENT-INDEPENDENCE reducer would ever resolve that race cleanly.
export function DappKitProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={query_client}>
      <SuiClientProvider networks={NETWORKS} defaultNetwork={SUI_NETWORK}>
        <WalletProvider autoConnect={false} storage={null} theme={gothic_dark_theme}>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
