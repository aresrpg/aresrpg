// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ContractArtifact } from '@aresrpg/sdk/deployment-admin'

import package_size_budget from '../move/package-size-budget.json' with { type: 'json' }

export const assert_deployment_package_size = (
  package_name: ContractArtifact['package_name'],
  modules: readonly string[]
): void => {
  if (package_name !== 'aresrpg') return
  const bytecode_bytes = modules.reduce((total, module) => total + Buffer.byteLength(module, 'base64'), 0)
  if (bytecode_bytes > package_size_budget.max_game_bytecode_bytes)
    throw new Error(
      `Game bytecode is ${String(bytecode_bytes)}B; ${String(package_size_budget.max_game_bytecode_bytes)}B max preserves Sui metadata headroom`
    )
}
