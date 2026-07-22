# B5 live-drive investigation kit (2026-07-20)

Reusable Wallet-Standard prod drivers from the dead-click verdict (rig-bound, DECISIONS 12:5x):

- `b5_drive.spec.ts` — resume/drive an existing live fight as alice, human-gesture clicks.
- `b5_fresh.spec.ts` — full fresh loop: login → world → search → engage → turns.

Start the NEXT live-prod investigation from these, not from zero. They inject alice via the
prod-smoke Wallet-Standard pattern (key read in-script from .dev/keys.json, never printed) and
target https://testnet.aresrpg.world. Run via the prod-smoke config idiom.
