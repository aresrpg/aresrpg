# v1.12.37 — the fortress release

This release is about the ground the game stands on: a boot crash closed for good, gameplay
content that can now update on its own schedule, and the pipeline behind every release
hardened end to end.

## No more crash on boot

A production build could fail to start if it couldn't resolve its deployment manifest. That
path is fixed: the app now resolves its manifest correctly, and if any piece of runtime
content is temporarily unavailable, it degrades gracefully instead of taking the whole app
down. Every runtime content loader — world data, the deployment manifest, item and spell
ids — got the same treatment, and a new boot-smoke gate now runs on every change to catch
this class of crash before it ever reaches players.

## Spells become runtime content

Spell data now loads as runtime content, the same way other game data does. It's groundwork —
future spell changes and additions can ship on their own, without waiting on an app release.

## Wallet-standard connect (preview)

Preview builds can now connect using the wallet-standard interface, ahead of a wider rollout.

## Infrastructure

The pipeline behind every release got sturdier:

- Every pull request now runs the full enforcement ladder — lint, static analysis, and native
  CodeQL — before it can merge.
- Production deploys are tag-bound with instant rollback if something goes wrong.
- Release announcements were rebuilt from the ground up.
- The repository itself is hardened: promotions to production are bot-exclusive, and release
  tags are immortal — once cut, never moved.

Your characters, your items, your progress: still on-chain, still yours.
