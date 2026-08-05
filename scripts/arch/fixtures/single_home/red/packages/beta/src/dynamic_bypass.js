// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — the lazy door (#2222): `await import` binds the fact exactly like a static import,
// so a consumer reaching around the home through it is the same violation.
export const lazy_bypass = async (value) => {
  const { K_TEST } = await import('./copy.js')
  return value + K_TEST
}
