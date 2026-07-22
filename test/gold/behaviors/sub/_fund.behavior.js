// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Sub-behavior: ensure the bot wallet holds gas (composition proof — imported via `use`).
// On localnet `faucet_fund` mints from the gold faucet; on testnet/mainnet the canary wallet is
// pre-funded and this step asserts the balance floor instead of minting (executor is target-aware).
export default {
  name: 'fund_wallet',
  description: 'faucet-fund (localnet) / balance-assert (canary) the bot wallet',
  defaults: { sui: 2, floor: 1 },
  steps: [{ do: 'faucet_fund', with: { sui: '$sui' } }, { assert: { oracle: 'run.balance_sui', gte: '$floor' } }],
}
