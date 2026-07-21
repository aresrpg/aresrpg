# v1.12.48 — the log is the law (2026-07-22)

- **One ingress** — fight state now folds from the chain's ordered event journal through a
  single accept door: contiguous, idempotent, byte-identical under any message ordering.
  Snapshots are demoted to bootstrap; the snapshot-diff history guesser is deleted outright.
  This is the release where fights become log-replay reliable.
- **Item characteristics arrive** — the client derives real stat ranges everywhere items
  render (the read-layer backfill completes server-side alongside this release).
- **Cooldown icons** — spells on cooldown grey out with a big turns-left counter; floating
  combat text drops mechanic labels and shows only the AP/MP numbers in their colors.
- **Universal crush** — any item crushes; zero-rune crushes say honestly that they destroy.
- **The dragon flies properly** — flat cruise at altitude 300, true travel-direction facing,
  and the animation pinned to the model's real clips.
- **Send items to anyone** — escrow-recoverable gifting from the inventory: pick items or a
  partial stack amount, preview the exact transfer, confirm, and the receiver claims for free
  (the sender can recall an unclaimed gift). Every send simulates before it signs.
- **Friend fast travel** — the friends menu travel action now works end-to-end.
- **Zones stop flickering** — zone refreshes merge instead of despawning live mob groups, and
  engaging a mob targets where it actually stands.
- **Critical hits show their color** — predicted crits paint the orange floater the moment they
  land, and the sim's crit math is pinned test-for-test to the chain's.
- **Seamless upgrades** — the transaction sponsor now keeps a history window of package
  versions, so an already-open client keeps playing through a release instead of stalling.
- **Character switching is reliable** — switches route through one lifecycle and retry
  cleanly instead of intermittently doing nothing.
- **The sync header unsticks** — connection phases advance even on flat speed samples.
- **Reach toasts tell the truth** — the "out of reach" toast fires only for your own
  dropped casts, never someone else's.
- **World structures place correctly** — two worlds had structure overrides keyed on names
  placement never looked up; they resolve now.
- **Peer names everywhere** — placement UI prefers character names over raw addresses, and
  items gain a see-on-explorer action.
