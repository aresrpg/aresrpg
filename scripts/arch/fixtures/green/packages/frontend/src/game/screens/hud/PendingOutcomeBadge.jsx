// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — fight and pending-outcome facts come from the fight-visible projection.
export const load_pending_outcome = (world_fight_view) => ({
  fights: world_fight_view.fights,
  outcome: world_fight_view.pending_outcome,
})
