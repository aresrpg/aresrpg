# v1.12.46 — the fights fight back

Eight lanes, one landing:

- **Spell VFX are visible again** — the overlay's soft-particle fade floored so
  ground-anchored casts stop melting into the board (the invisible-vfx root cause), with a
  live diagnostic lever for this class.
- **Deaths present exactly once** — mid-action receipt events no longer orphan kill hits
  into a phantom re-pacing turn.
- **Teleport math is honest** — movement drafts and costs anchor on the post-teleport cell
  (the chain always charged correctly; the painter lied).
- **Chat works between players** — a scope filter compared personal run ids that never
  matched; deleted.
- **The fast-travel dragon flies** — animation actually driven, higher cruise, bigger rig,
  and the model preloads when the travel map opens (the 20s stall).
- **Result card truths** — real fight duration + the trace-export keybind survives fight end.
- **Read-layer hardening** — rate limiting keys on the real client IP; browser object reads
  leave the public fullnode behind a standing gate.
