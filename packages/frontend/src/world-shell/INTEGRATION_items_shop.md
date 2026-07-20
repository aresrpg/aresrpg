# Items mint-on-sale — post-publish re-drive (S-19a)

`aresrpg_items` has NO testnet publish yet, so the vault's `items_live` branch is DORMANT (the companion
path renders — visually identical). After the lead stamps `packages/sdk/src/deployment/items.js` (testnet ids)
AND measures + stamps `MEASURED_BUY_GAS_MIST` (`packages/sdk/src/sui/write/items_shop.js`), re-drive on `/mint`:

1. `items_deployment_ready(DEMO_NETWORK)` flips true → page reads `use_items_shop_chain` + buys via
   `buy_items_sale` (SDK `buy_ptb`/`buy_many_ptb`, &Clock+&Random). Confirm the seeded sales render as tiers.
2. Kiosk-less buyer: Buy → onboard tx (create+share personal kiosk) → terminal buy; RESUME = 2nd buy skips
   onboard; verify the minted Item locks into the personal kiosk (self-pay, no preflight, budget pinned).
3. Sad paths → humanized copy: sold-out(105)/not-started(106)/ended(107)/paused(101)/underpay(102). No
   `VITE_UNSAFE_DEV_GAS` + unmeasured constant ⇒ `errors.buy_gas_unmeasured` (never a silent guess).
4. Until a real digest lands, the buy is VERIFIED-TO-SUBMIT-SEAM only. TX-RETRY law: never re-fire an executed failure.
