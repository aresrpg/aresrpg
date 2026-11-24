// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { campaigns } from '../../../../seed/content/airdrop.json'

/** The airdrop campaigns a visitor may see; the staking page reads this table alone. */
export const public_airdrop_campaigns = Object.freeze(campaigns.filter(({ visibility }) => visibility === 'public'))
export type AirdropCampaign = (typeof public_airdrop_campaigns)[number]
