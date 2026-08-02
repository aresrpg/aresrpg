# v1.15.0 — durations mean what they say (2026-08-03)

The whole on-chain game was upgraded for this release: all nine packages are live at a new
version, and this is the build that talks to them. Alongside that, a fight's timers now count
down the same way on chain, in the client's prediction, and on your screen — and a won fight
stops eating its own loot.

## Fights

- **A duration means what it says.** Statuses age at the start of the bearer's turn, so "1 turn"
  is this turn, not one already spent.
- **A spent effect stops protecting a round late.** A used-up buff is collected at the end of its
  bearer's turn instead of lingering through the next enemy round — exactly the margin an
  attacker was losing.
- **Poison scales with who cast it.** Damage-over-time ticks read the caster's current stats, so a
  buffed caster's poison hits like one, and the preview agrees with the result.
- **A live effect badge never reads zero turns.** On its last covered turn a status now reads 1,
  the way the reference client renders it, while a freshly cast two-turn effect still reads 2.
- **Your own trap can catch you.** The chain triggers a trap when any fighter walks onto it; the
  client's prediction had quietly granted whoever placed it immunity, so the two disagreed. Trap
  visibility also has a single home now instead of two that could drift apart.
- **A won fight keeps its loot.** A busy roster could make the client republish the same roster on
  every fold until an internal guard fired mid-fight; that guard's failure landed on the path that
  hands you your rewards, so a fight you had already won ended with nothing to collect.

## Playing together

- **Fast travel goes to the right person**, resolved from the authoritative record rather than a
  nearby observation.
- **A friend row shows the character's real name**, and the friends panel reports what it has
  actually observed instead of claiming to know who is online.
- **Right-clicking a player acts on that player** — the menu resolves the target's owner from the
  character record, not from whichever surface opened it.
- **A relay path for players behind strict routers.** When two players both sit behind
  restrictive home networks the direct connection never forms; the game can now mint a
  short-lived credential for a relay so those players can still reach each other. The shared
  secret never leaves the server, and a deployment without a relay says so instead of pretending.
- **An invited player actually sees the invite.** A party invite was recorded on chain against the
  invitee but never reached them, so they only found out if the inviter said so out of band.
- **Which world a character is in has one answer**, so following a friend cannot route you through
  the wrong world join.

## Elsewhere

- **A sponsored character appears the moment it is created**, adopted from the transaction's own
  certified receipt instead of waiting for the read layer to catch up.
- **The monster portrait list is checked against the world**, so a newly added monster cannot
  silently lose its picture in the Encyclopedia.
- **A craft reports the roll, not the transaction.** Crafting is a dice roll: inputs burn and job
  experience credits either way, and the item only mints on a pass. A failed roll used to be
  announced as a success while nothing arrived in your bag. There are now three honest endings —
  a pass, a failed roll, and "the receipt carried no craft event", which says so rather than
  claiming a success nobody can see.
- **A notification never renders `[object Object]`.** Player copy is extracted at the door, so no
  caller can push a raw object onto your screen.
- **Auto-search remembers your settings** and gains a targets axis, in all six languages.
- Groundwork: the fight screen now has one place to ask what a fight looks like, sealed with
  per-step replay snapshots, and coop screens are held to reading their own source of truth.

Full notes → https://github.com/aresrpg/aresrpg/compare/v1.14.1...v1.15.0
