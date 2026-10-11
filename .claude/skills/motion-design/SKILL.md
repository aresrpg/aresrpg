---
name: motion-design
description: Motion design for AresRPG's DOM/CSS interface — HUD, fight feedback, menus, modals, toasts, banners, reveals, loading. Use when adding, changing, reviewing, or debugging any animation or transition in packages/frontend, when a surface "feels slow", "feels dead", or "janks", or when choosing a duration, easing, stagger, or reduced-motion behavior. Not for engine skeletal clips, shaders, or camera work.
---

# Motion design — AresRPG interface

Motion here is restrained and atmospheric. It reports state; it never performs. The first job of
this skill is to produce zero lines of animation when the gate says so.

Scope: DOM and CSS motion in `packages/frontend`. The engine owns model clips, VFX, camera timing,
and the fight animation queue; see `ARCHITECTURE.md` and the engine rows in `DECISIONS.md`.

## The build sequence — run in order

### 1. Should it animate? Pick the tier first

| Tier | Examples | Budget |
| --- | --- | --- |
| Tactical input | spell select, cell hover, end turn, hotkeys, inventory drag, tab switch | none, or colour/opacity at `--dur-1` |
| State feedback | HP/AP/MP change, damage number, toast, tooltip, panel open, progress bar | `--dur-1` to `--dur-3` |
| Ceremony | fight result, box reveal, level up, zone/city banner, rebirth, journey stamp | 400–1200ms, skippable |
| Ambient | menu atmosphere, live-state breathing, loading | 2.4s+ loops, low amplitude |

Keyboard-initiated and many-times-per-fight actions never get movement. A tactical game punishes
every millisecond between intent and confirmation.

### 2. Name the purpose in one word

Feedback, spatial consistency, state indication, bridging a jarring change, or (ceremony tier only)
delight. No name means no animation. Data the player is reading must not move for style.

### 3. Cheapest tool that works

1. CSS transition — hover, press, colour, any class/attribute-driven state.
2. `@starting-style` — entry on mount without JS state.
3. CSS `@keyframes` — predetermined, non-interruptible sequences (banners, reveals, loops).
4. WAAPI `element.animate()` — programmatic control at CSS cost.
5. `requestAnimationFrame` — only when the value follows live input or world state.

No animation library exists in this repo. Adding one is a dependency decision, not a styling one.

### 4. Properties

- Animate `transform` and `opacity` only. `clip-path` is the sanctioned third (reveals, wipes).
  The WebGPU canvas already owns the frame budget; a layout-triggering property steals from it.
- Bars animate `transform: scaleX()` with `transform-origin: left`, not `width`.
- Never enter from `scale(0)`. Start at `scale(0.95–0.97)` plus `opacity: 0`.
- Anchored surfaces (tooltip, menu, popover) set `transform-origin` at their trigger. Centered
  modals stay centered.
- Name every transitioned property. `transition: all` is a defect.
- `will-change` only on an element about to animate, never as a jank fix.

### 5. Curve and duration

Use the existing tokens. Do not introduce a parallel scale or a new bezier.

```css
--dur-1: 120ms; /* press, hover, colour */
--dur-2: 200ms; /* tooltip, menu, bar fill */
--dur-3: 300ms; /* modal, panel — the interface ceiling */
--ease: cubic-bezier(0.16, 1, 0.3, 1); /* house ease-out */
```

They are declared in `packages/frontend/src/components/character_surfaces.css`. A surface outside
that scope reuses the same values; promote the tokens to a shared root before copying them a
second time.

| Situation | Easing |
| --- | --- |
| Entering, exiting, responding | `var(--ease)` |
| Moving or morphing while on screen | ease-in-out |
| Constant motion: spinner, timer bar, marquee | linear |
| `ease-in` | never on interface; it delays the moment the player watches |

- Exits run shorter and travel less than entrances.
- Distance scales duration: double the travel is about 1.3x the time, not 2x.
- Overshoot belongs to the ceremony tier only: one small settle, never bounce or elastic.
- Loops stay slow and shallow. A pulse exists only on a state that is true right now.

### 6. Interruption and exit

- Anything the player can retrigger within a second uses transitions, not keyframes. Transitions
  retarget from the current value; keyframes restart from zero.
- Exit along the entry path.
- Ceremony is skippable and never blocks input. Skip and teardown cancel its sounds and timers.

### 7. Reduced motion and pointer gating ship in the same change

```css
@media (prefers-reduced-motion: reduce) {
  .thing { animation: none; transition: opacity var(--dur-2) linear; }
}
@media (hover: hover) and (pointer: fine) {
  .thing:hover { transform: translateY(-1px); }
}
```

Reduced motion keeps fades and colour, drops movement, and shows a ceremony's result directly.

## Choreography

- The hero element leads. Everything else is smaller in distance, duration, and contrast.
- One shared origin or direction per group. Mixed directions read as noise.
- Stagger 30–50ms per item, same curve for all, about six items then batch. Total under 500ms.
- With three or more moving elements, at most a third are in motion at once.
- Leave 100–200ms of stillness after a sequence resolves.

## Game feedback

- A hit reads in three layers: the number (primary), the bar change (secondary), a brief tint or
  flash (ambient). One layer feels cheap; four is noise.
- A damage or heal number rises and fades in 600–900ms and never covers a board cell.
- A resource bar shows the new value at once; a trailing ghost segment may drain behind it.
- Screen shake and hit-stop belong to the engine. Published guidance disagrees (hit-stop 30–80ms,
  shake 100–300ms); treat those as starting points and tune by eye.
- Notifications enter top-right, with inline actions, and never center on screen.

## House laws motion must obey

- **Motion displays a delta; it never owns truth.** Fire from an observed state change, never
  from message arrival (L-P6). Receipt, poll, and relay all deliver the same fact; an
  arrival-keyed animation plays twice.
- **State lands first.** Game state never waits on a DOM animation. Sequencing that gameplay
  depends on goes through the existing fight animation queue.
- **No timer in a store.** Animation end re-enters as an input (`animationend`,
  `Animation.finished`) at a component edge.
- **One fight runtime.** World fights, duels, kolizeum, and the simulator share one presentation
  path. No surface gets its own timing.

## Never ship

| Never | Instead |
| --- | --- |
| Movement on tactical input or a hotkey | instant, or colour at `--dur-1` |
| `transition: all` | named properties |
| `width`/`height`/`top`/`left`/`margin` animation | `transform`, `opacity`, `clip-path` |
| `scale(0)` entrance | `scale(0.95)` + `opacity: 0` |
| `ease-in`, bounce, elastic on interface | `var(--ease)` |
| Interface motion above `--dur-3` without the ceremony tier | 120–300ms |
| A new duration or bezier literal | the tokens |
| Keyframes on toasts, toggles, rapid retriggers | transitions |
| Ungated `:hover` movement | `(hover: hover) and (pointer: fine)` |
| No reduced-motion path | fade only, result shown directly |
| A pulse on a state that is not live | static mark |
| Unskippable ceremony | skip input plus teardown |

## Verify before claiming done

1. Play it at 0.1x–0.25x in the browser's Animations panel. Check origin, curve, and that
   coordinated properties stay in sync.
2. Retrigger it rapidly. It must retarget, not restart or stack.
3. Emulate reduced motion (`page.emulateMedia({ reducedMotion: 'reduce' })` in Playwright).
4. Run it over the live world on the Low quality tier, not on an empty page.
5. Record the Performance panel: no layout or paint in the animated frames.
6. Feel cannot be proven from code. Say so and hand the surface to the owner's eye.

## Report

Code first. Then at most four lines: tier and purpose, tool and properties, token and curve, and
what still needs an eyeball.

## Sources

Distilled from these MIT-licensed skills, then bound to this repository's tokens and laws:

- Emil Kowalski, `emilkowalski/skill` — `animate`, `review-animations/STANDARDS.md`: the gate
  sequence, frequency tiers, interruption, property rules.
- LottieFiles, `lottiefiles/motion-design-skill`: three motion layers, choreography, stagger
  budgets, state-feedback patterns.
- Kyle Zantos, `kylezantos/design-motion-principles`: creation gotchas, performance budget.

Load those directly when a case falls outside this file; this file wins on any conflict.
