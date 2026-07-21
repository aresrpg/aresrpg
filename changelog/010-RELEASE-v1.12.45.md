# v1.12.45 — deaths, once

- A fighter's death now plays exactly once, by construction: the animation fires only when the observed state actually crosses alive→dead — repeated reports of the same death are silence, as they should be.
- The replay-idempotence gate joins CI: every fight scenario is also run with each input delivered three times over — the presentation must come out byte-identical, forever.
- Toasts are properly contained: comfortable padding, slight rounding, and they can never summon a page scrollbar again.
- Beast Ward tells the truth: four elemental resistances, not air four times (content corrected and re-published).
