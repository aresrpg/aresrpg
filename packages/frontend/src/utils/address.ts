// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shorten a 0x address for display — the house … variant (6 leading hex + 4 trailing). One home;
// every surface (wallet bar, send modal, vault) formats addresses through here.
export function truncate_address(address: string): string {
  return !address || address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}
