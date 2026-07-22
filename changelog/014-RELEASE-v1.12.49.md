# v1.12.49 — your turn, in order (2026-07-22)

- **Casts stop jumping the queue** — the turn commits exactly what you drafted, in the order
  you drafted it: move, cast, move again — the chain sees the same sequence you played.
  The old casts-first flattening is gone.
- **Mid-turn grants are spendable** — a Vanish's +MP funds your very next move, and claimed
  grants survive checkpoints instead of vanishing into the budget.
- **The courtesy channel** — party members now see each other's drafted actions in real time,
  validated by the local sim before they paint; illegal peer actions never render. The
  authoritative journal remains the only truth — peers only get a faster picture of it.
- **Level-up gets its ceremony** — the radiant ember/gold card, opaque ground, persists until
  you choose.
- **Stats explain themselves** — every characteristic shows a short description derived from
  the sim's real formulas.
- **Cross-world travel stops racing** — arriving in a new world can no longer be readied by a
  stale frame from the old one.
- **Fight vfx keep their color** — effects no longer blow out to white on the low graphics
  tier; one authored value drives every render path.
- **Inventory menu honesty** — single stacks and non-stackables hide split; merge appears only
  when a matching stack exists.
- **Release announcements get a version banner** — the Discord post opens with a boxed tag.
