# The Doctrine — engineering the definition of done

Agentic development, summarized (owner, 2026-07-26): **the engineering moves into the
definition of done.** The human supplies intent; a machine-checkable definition of done makes
convergence inevitable; everything else — planning, code, review — is derivable at machine
speed. This page is the constitution of that loop.

## The loop

```
while intent remains:
  1. EXTRACT  — intent arrives in any form: a sentence, a feeling, a screenshot, a sketch
  2. COMPILE  — translate it into a Definition of Done: a RED, deterministic,
                machine-runnable check (a law-registry row, a driven test, a gate)
  3. ECHO     — the author confirms the check says what they meant — the ONLY mandatory
                human gate
  4. CONVERGE — agents change the system until the check is green, under every law
                already sealed
  5. SEAL     — the green check joins the permanent suite; the intent is now unforgettable
```

One-sentence law: **no work without a red check; no red check without the author's echo; no
green check ever leaves the suite.**

## The two kinds of intent — never confused

- **Correctness intent** ("a push moves the target 3 cells, stopping at the nearest
  obstacle") compiles to deterministic checks. Machines own it forever after the echo.
- **Taste intent** ("the trap should FEEL dangerous") compiles to a felt-session
  checkpoint — surfaced to a human at build-ready moments, never delegated to a machine.

A `park:` prefix on any intent defers it: parked label, no compilation, no derailment.

## Definition-of-done properties

A DoD is: **deterministic** (same input, same verdict) · **red-first** (proven to measure
something by failing before the fix) · **fast** (or it will not run every time) · **sealed**
(regression-permanent once green). A DoD that misses any of these is theater.

## The graduation ladder — prose never survives pressure

Rules, skills, loops, and hooks are not alternatives; they are life stages of one law:

1. **Rules** (`.claude/rules/`) carry the WHY — understanding, values, this page.
2. **Skills** (`.claude/skills/`) carry the HOW — procedures invoked at the moment of need.
3. **Hooks / CI** carry the CANNOT — judgment-free mechanical enforcement. Every law that
   matters graduates here; a law that stays prose will eventually be broken under pressure.

Enforcement that binds every contributor lives in CI (repo-native); personal-harness hooks
are individual seatbelts, never the repo's mechanism.

## Failure modes (each one measured in this repo's history)

Skipping COMPILE is vibes-driven building. Skipping ECHO ships a mistranslation.
A non-deterministic DoD is verification theater. An unsealed DoD is a scheduled regression.
A DoD kept in prose is drift with a delay timer. Layer-green without a product-truth check
is how a broken game passes CI for three weeks.

## The disposability principle

The process must survive session amnesia, model upgrades, and any change of operator: every
law lives in this repository or graduates into its gates. The measure of this page's success:
start a cold session tomorrow and the machine has lost nothing.
