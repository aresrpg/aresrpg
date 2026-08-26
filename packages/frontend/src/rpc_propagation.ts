// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Certified writes and transaction resolution can reach different RPC nodes at different times. */
export const RPC_PROPAGATION_MS = 6_000

export const wait_for_rpc_propagation = (
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<void> => wait(RPC_PROPAGATION_MS)
