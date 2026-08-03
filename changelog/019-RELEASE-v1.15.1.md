# v1.15.1 — the honesty wave (2026-08-03)

This release is about the game telling you the truth. A read that fails now says it failed
instead of showing you an empty world; a fight hands you your turn the moment the chain says it
is yours; and the client's biggest screens were taken apart and rebuilt along their own seams.

## Fights

- **Your turn starts when the chain says it starts.** The client used to grant the turn on its
  own replay and then hold it back behind a "the mobs that just played are still resolving" wait.
  The instant the chain finishes spending the previous turn's budget is the instant the turn is
  yours — that extra wait, and the copy explaining it, are gone.
- **A cell your own kill just freed is walkable immediately.** Occupancy lagged a whole receipt
  behind your killing blow, so the board painted the freed cell while the move gate still held
  it and walking onto it silently did nothing. Dead in either view now frees the cell, matching
  the chain.
- **Recoil lands on the caster.** A spell that recoils on whoever cast it was predicted as
  ordinary area damage walking the zone; the prediction now does what the chain has always done,
  so the preview and the result agree.

## Playing together

- **A zone that could not be read is not an empty zone.** Zone discovery asked once, immediately,
  inside the window where the chain has not published its answer yet, and reported the silence as
  an empty zone — monster groups and all. It now waits that window out. A genuinely empty zone
  still says so.
- **A failed friend-list read is no longer an empty roster.** Your friends do not disappear
  because one request did not come back.

## Elsewhere

- **"It failed" and "there is nothing there" are different answers.** The read layer collapsed
  transport failures, decode failures and genuine emptiness into a single blank value everywhere
  it was used — the root of the empty-zone report above. Absence is now identified from the
  chain's own "not found"; anything else surfaces as a failure that names its cause.
- **A picker that could not load its catalogue says so** instead of presenting a game with
  nothing in it.
- **No failure is swallowed in silence.** Every place the interface used to drop an error, or
  start work in the background and never look at it again, now either handles it or states why
  it is safe to ignore.
- **A craft's outcome is read from the craft's own result**, and the tests now hold the client to
  it rather than to a waiver claiming otherwise.
- Groundwork: the characters, jobs and dungeon screens were split along their section seams,
  several surfaces that were mounted nowhere were deleted, view maths became plain transforms
  with no shared state to mutate, and the hook rule that had never actually been running is now
  enforced across the whole client.

Full notes → https://github.com/aresrpg/aresrpg/compare/v1.15.0...v1.15.1
