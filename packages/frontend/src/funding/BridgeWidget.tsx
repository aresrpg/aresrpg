// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LiFiWidget, WidgetEvent, widgetEvents, type Route } from '@lifi/widget'
import { EthereumProvider } from '@lifi/widget-provider-ethereum'
import { SolanaProvider } from '@lifi/widget-provider-solana'
import { SuiProvider } from '@lifi/sdk-provider-sui'
import { SuiContext, useSuiContext } from '@lifi/widget-provider'
import { useEffect, useMemo, type PropsWithChildren } from 'react'

import { useLocale } from '../i18n/LocaleScope.tsx'
import { dispatch_app, read_app_state } from '../store.ts'

import { bridge_config, FUNDING_SUI_CHAIN, FUNDING_SUI_TOKEN } from './bridge_config.ts'

// Destination reads only. There is no Sui wallet connector, client executor, or signer.
const SuiDestinationProvider = ({ children }: Readonly<PropsWithChildren>) => {
  const context = useSuiContext()
  const value = useMemo(() => ({ ...context, sdkProvider: SuiProvider() }), [context])
  return <SuiContext value={value}>{children}</SuiContext>
}

export default function BridgeWidget({ address }: Readonly<{ address: string }>) {
  const locale = useLocale()
  const providers = useMemo(
    () => [EthereumProvider({ walletConnect: true }), SolanaProvider(), SuiDestinationProvider],
    []
  )
  const config = useMemo(() => {
    const base = bridge_config(address, locale, window.location.origin)
    const style = getComputedStyle(document.documentElement)
    return {
      ...base,
      providers,
      theme: {
        ...base.theme,
        colorSchemes: {
          dark: {
            palette: {
              primary: { main: style.getPropertyValue('--color-gold').trim() },
              secondary: { main: style.getPropertyValue('--color-cyan').trim() },
              background: {
                default: style.getPropertyValue('--color-surface').trim(),
                paper: style.getPropertyValue('--color-surface-high').trim(),
              },
              text: {
                primary: style.getPropertyValue('--color-text').trim(),
                secondary: style.getPropertyValue('--color-muted').trim(),
              },
            },
          },
        },
      },
    }
  }, [address, locale, providers])
  useEffect(() => {
    const completed = (route: Readonly<Route>) => {
      if (route.toChainId !== FUNDING_SUI_CHAIN || route.toToken.address !== FUNDING_SUI_TOKEN) return
      if (route.toAddress?.toLowerCase() !== address.toLowerCase()) return
      if (read_app_state().session.wallet?.address.toLowerCase() === address.toLowerCase())
        dispatch_app({ type: 'wallet/refresh' })
    }
    widgetEvents.on(WidgetEvent.RouteExecutionCompleted, completed)
    return () => {
      widgetEvents.off(WidgetEvent.RouteExecutionCompleted, completed)
    }
  }, [address])
  return <LiFiWidget config={config} integrator={config.integrator} />
}
