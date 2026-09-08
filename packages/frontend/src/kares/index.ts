// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Game-neutral finance presentation shared with the independently deployed launchpad. */
export {
  AmountForm,
  FinanceStatus,
  Metric,
  finance_empty_message,
  finance_button,
  finance_label,
} from './components.tsx'
export { TokenomicsTab } from './TokenomicsTab.tsx'
export { SuiLogo } from '../components/SuiLogo.tsx'
export { KaresLogo } from '../components/KaresLogo.tsx'
export { initial_finance } from './model.ts'
export { FinanceLocale } from './FinanceLocale.tsx'
export { format_amount, parse_amount, offering_phase } from './model.ts'
export type { FinanceInput, FinanceState, FinanceSnapshot, FinanceSession } from './model.ts'
export type { KaresCopy } from './copy.ts'
export { countdown_parts, useCountdown } from './countdown.ts'
export { WalletControl, open_wallet_dialog } from '../wallet/WalletControl.tsx'
export { initial_wallet_state } from '../wallet/model.ts'
export type { WalletView } from '../wallet/model.ts'
