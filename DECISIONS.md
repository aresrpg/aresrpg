# DECISIONS — the owner's mental model

This file makes any agent think like the owner. Patterns first — they decide the calls he is
not in the room for. Rulings second — settled choices, never re-derived, never undone silently.
One line each. A new entry lands the moment a choice carries a motive worth reusing.

## Patterns — how to think here

- Derive, don't register: identity comes from deterministic derivation over natural keys (a character's address = owner + name under the gate) — findable without an indexer, unique by construction; a registry table is a smell
- Take facts from the context, never as parameters: the sender lives in `ctx` — a parameter that repeats what the context knows is a redundancy that can lie
- Flatten until forced: no wrapper struct for three colours, no subfolder for one package, no explicit dependency the toolchain injects itself — hierarchy must earn its existence
- Denormalize for the reader, with exactly ONE writer: `level` sits on the character so wallets can read it; only the progression door writes it, in the same transaction as the xp it derives from
- The module boundary is the security boundary: data modules own shape and invariants behind public(package) doors; gate modules own policy (names, prices, whitelists); consumers compose doors
- Latest of everything, no duplicates: lean on toolchain defaults over manual pins; a pin is a scar, not a habit
- The pattern library is the aresrpg-legacy repository (the original testnet game — lean, proven) with packages/move-old as the second reference · before designing any mechanism, check how legacy solved it and carry the pattern, not the code

## Rulings

- 2026-08-09 · Owner owns the mental model: package boundaries and I/O contracts are his surface; deletion outranks addition · the system outgrew any single head
- 2026-08-09 · Move layer rewritten, not refactored: old corpus frozen at packages/move-old (reference, never edited); new lineage grows at packages/move · the old topology scattered core concerns (character creation lived in "gifting")
- 2026-08-09 · New lineage = ONE flat Move package, internals first: plain data modules, public(package) doors, consumers arrive later · public(package) is the trust mechanism
- 2026-08-09 · Character mint = 1 SUI fixed, exact payment, no free path, no sponsoring · simpler to reason about the whole flow
- 2026-08-09 · Deleting a character FREES its name: the NameRegistry keeps one removable name→ID record per living character · this rules out name-derived character ids (derived claims have no unclaim — a derived id would lock the name forever)
- 2026-08-09 · World layer: position and current-world live as dynamic fields ON the character (one checkpoint per visited world = automatic travel memory); the 20 worlds are hardcoded law with entry levels checked on EVERY switch; shared World objects hold only content settings · join/switch touches zero shared objects
- 2026-08-09 · Coords are unsigned; the world center (250000) IS the client's 0;0 and every first spawn · kills the corner-bug class. Speed budget = one game-wide constant (11.5 blocks/s ×1.5 with pet); movement is PROVEN lazily against the checkpoint, never tracked
- 2026-08-09 · One module for now: character.move carries its own mint door · the api-door split (legacy api.move) returns only when a second consumer exists
