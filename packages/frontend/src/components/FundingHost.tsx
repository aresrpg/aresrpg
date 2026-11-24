// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { gift_funding_text } from '../airdrop/GiftClaimNotice.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { AddFundsModal } from './AddFundsModal.tsx'

/**
 * The one funding window of a signed-in surface. Any feature asks for funds with `funding/open`; the
 * surface that shows the feature mounts this host once, in the game and on every page of the site.
 */
export const FundingHost = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useSiteStore((state) => state.session)
  const funding = useSiteStore((state) => state.funding)
  const distribution = useSiteStore((state) => state.distribution)
  const { wallet } = session
  if (!wallet || !funding) return null
  return (
    <AddFundsModal
      key={wallet.address}
      address={wallet.address}
      authorization={funding.authorization}
      copy={copy}
      cost_mist={funding.cost_mist}
      on_close={() => dispatch_app({ type: 'funding/close' })}
      warning={gift_funding_text(copy, distribution, session)}
    />
  )
}
