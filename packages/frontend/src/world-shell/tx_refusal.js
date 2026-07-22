// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Async transaction refusals re-enter the game through this ONE pure input projection. Callers dispatch the
// returned value through the engine reducer; no network callback writes presentation state directly.

import { is_sponsor_outdated_package_refusal } from '../tx/sponsor_refusal'

/** @param {unknown} error @returns {{ type: 'action/sponsor_upgrade_required', payload: true } | null} */
export function tx_refusal_input(error) {
  return is_sponsor_outdated_package_refusal(error) ? { type: 'action/sponsor_upgrade_required', payload: true } : null
}
