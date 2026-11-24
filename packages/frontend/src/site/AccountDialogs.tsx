// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The dialogs a signed-in account can open from any page of the site: funding and the wallet import.
import { FundingHost } from '../components/FundingHost.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { WalletImportWindow } from '../settings/WalletImport.tsx'

const AccountDialogs = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <>
    <FundingHost copy={copy} />
    <WalletImportWindow copy={copy} />
  </>
)
export default AccountDialogs
