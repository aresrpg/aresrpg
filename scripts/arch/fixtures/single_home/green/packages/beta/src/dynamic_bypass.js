// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — the same lazy door pointed at the fact's one home, which the lane must NOT report.
export const lazy_bypass = async (value) => {
  const { K_TEST } = await import('../../alpha/src/protocol.js')
  return value + K_TEST
}
