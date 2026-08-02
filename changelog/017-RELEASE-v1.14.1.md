# v1.14.1 — the fixes reach your build (2026-08-02)

v1.14.0 was tagged but its build could not be served: the deploy step resolved its dependencies
without honouring the committed lockfile, and the browser bundle never came out of it. That is
fixed here, and this release is the one that actually reaches players — it carries everything
v1.14.0 described (see `016-RELEASE-v1.14.0.md`) plus the fixes below.

## Fixes

- **Diagonal neighbours are not adjacent.** Monsters no longer plan around tackles they cannot
  make: being adjacent for a tackle means one of the four orthogonal cells, exactly as the chain
  resolves it. The shove length shown on a target now follows the same rule instead of agreeing
  with it by coincidence.
- **Poison respects your armour.** Damage-over-time ticks were applied raw, ignoring resistance and
  any shield absorbing for you — so poison hit harder than the same number from any other source,
  and the preview disagreed with the result. Ticks now take the same path as every other damage
  line.
- **A refresh keeps the monsters' names.** Reloading mid-fight rebuilt every monster from its
  group's first member, so a rat and a Bonelet both came back as Bonelet. Each one now keeps its
  own identity across a reload.
- **Loot stops flickering when a fight ends.** A won item could appear, vanish and reappear: a
  follow-up read arriving empty was being treated as "you won nothing" instead of "nothing to
  report yet". Confirmed rewards are now held until they are actually confirmed.
- **A character that can turn invisible will now do so.** The spell filter could not see the
  invisibility effect at all, so Vanish scored as uncastable forever and never came up.
- **A monster that passes says why.** A monster could spend its whole turn beside you doing
  nothing, with no way to tell a decision from a bug. Its turn now records what it considered and
  why each option was refused.
- **The board only colours ground you can actually use.** At the start of a fight, the strips
  marking where each side may stand were coloured from declared bands instead of from the rule
  that accepts a click — so another seat's zone could render in your own colour and the board
  offered you cells you could not take. The paint now comes from the same door the click goes
  through.
- **A miss says what missed, not where.** The whiff line claimed the attack struck the ground,
  which is a statement about the world; what happened is that the resolution found nothing to
  hit. The copy now says that, in all six languages.

Also: new mechanical gates that keep three of these classes from returning — a king-move distance
metric is now an error anywhere in the fight path, line-of-sight has exactly one definition, and
fight screens carry a shrink-only ratchet on reading around their own source of truth.

Full notes → https://github.com/aresrpg/aresrpg/compare/v1.13.0...v1.14.1
