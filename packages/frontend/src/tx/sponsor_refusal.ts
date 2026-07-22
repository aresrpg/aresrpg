// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Machine-readable sponsor refusal markers shared by the sponsor door and every routing edge. This leaf stays
// free of auth/UI imports so a fallback can preserve a refusal without closing a cycle through tx/index.ts.

export const SPONSOR_REFUSAL_OUTDATED_PACKAGE = 'outdated-package'

export function is_sponsor_outdated_package_refusal(error: unknown): boolean {
  return (
    (error as { sponsor_refusal?: string } | null | undefined)?.sponsor_refusal === SPONSOR_REFUSAL_OUTDATED_PACKAGE
  )
}
