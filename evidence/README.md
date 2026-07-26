# fight-surface truth — driven evidence (#927 · #921 · #912)

Driven against a dev server built from `lane/fight-surface-truth`, on the real `/simulator` page: a seeded
roster + mob line-up, START pressed, the fight played, STOP pressed. Headless Chromium reports no GPUAdapter,
so the run is on the WebGL2 fallback — the engine parks its TSL/node-material highlight washes there, which is
why the start-band paint is not visible in either frame. The panel half of #927 reproduces and resolves in
full below; the paint/sprite half is the `unpaint()` handoff in `simulator/mount.js`.

| frame | what it shows |
| --- | --- |
| `927-before-fight-setup-panels-persist.png` | **the bug, at `ea9f6878`** — a live fight with the ROSTER panel (Probe + five NEW CHARACTER slots) and the MOB TEAM panel (Alley Bunny + five EMPTY slots) still rendering beside the board |
| `927-after-setup-before-start.png` | setup on the fixed build — three panes, the line-up placed |
| `927-after-fight-board-only.png` | **the fix** — the same fight, board only: no roster, no mob read-out, no expiry banner |
| `927-after-stop-setup-restored.png` | STOP — all three panes back, the placed character and mob still on the board |

Probe readouts from the same drive:

```
MID-FIGHT:   {"pane_headers":["BOARD"],"roster_seats":false,"mob_slots":false,
              "fight_layer":true,"expiry_banner":false}
AFTER STOP:  {"pane_headers":["ROSTER","BOARD","MOB TEAM"],"roster_seats":true,"mob_slots":true,
              "fight_layer":false,"expiry_banner":false}
EXPIRY-GATE: {"live_view":{"status":1,"turn_deadline_ms":1785034975982},"chain_backed":false,
              "simulator_auto_end_on_lapsed":false,"simulator_report_on_lapsed":false,
              "chain_auto_end":true,"chain_report":true}
```

`EXPIRY-GATE` is #921 ④ measured on the live store of the running sim fight: the sim DOES stamp a wall-clock
turn deadline, so the predicate alone would fire there — the composition flag is what holds it. The same two
predicates return `true` for a chain-backed session, so the world path is unchanged.
