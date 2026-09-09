# Browser verification

- `tests/`: browser assertions against production UI and engine code.
- `fixtures/`: isolated pages and synthetic inputs; excluded from production builds.
- `support/`: browser instrumentation shared by the suites.
- `playwright.config.ts`: the CI compatibility suite.
- `playwright.hmr.config.ts`: the development-only store reload regression.

Generated results belong in root `test-results/`, never alongside these sources.

Use installed stable Chrome locally. Install the other pinned browsers with `bunx playwright install --with-deps firefox webkit`.
CI installs stable Chrome with `bunx playwright install --with-deps chrome`.
Run `bun run test:browser` from the repository root.
Set `BROWSER=firefox` or `BROWSER=webkit` to select another browser engine.
Linux CI runs Firefox headed under Xvfb with software OpenGL because headless Firefox cannot
create the WebGL2 context needed by the fallback renderer. This is a compatibility check.

The test build includes an isolated canvas entry. It imports the production world controller,
world-content projection, fight-board projection, and demo crowd loader. It contains no wallet
session or gameplay authority. The normal production build does not include this entry. A separate staking fixture renders the
production account panels with synthetic balances and captures UI inputs without a signer or RPC
reader. It verifies wallet isolation, amount presets, local reward estimates, and desktop fit.

The PR/push matrix checks all quality tiers, real graphics-control persistence after reload, and
explicit missing-API/missing-adapter fallback.
Each result records browser/OS/CPU/GPU identity, actual canvas dimensions, loading time, frame distribution, chunk residency,
retained GPU resources, and Chromium heap size after collection. These are retained object and
buffer-byte counts, not a claim to measure physical VRAM. Texture bytes are not measured.

For full city/forest, 200-character + 100-mob workloads and three 2,048-block out-and-back laps plus one flat-mode lap:

```sh
BROWSER_WORKLOAD=full REQUIRE_HARDWARE=1 bun run test:browser
```

Hardware runs use 1920×1080 at DPR 2, exercising the high tier's six-million-pixel ceiling.
They require 120 FPS on macOS high quality and 30 FPS otherwise. Free CI uses 1280×720 at DPR 1.
Steady-stage frame-submission p95 must meet the frame budget, and completed throughput must meet the FPS target.
Transitions and the accelerated camera route have stall budgets; teleport stress is not a walking-speed FPS measurement.
Each stage pauses rendering and drains its submitted GPU work once before calculating throughput, then resumes.
This prevents uncounted frames during the drain; per-frame fences would distort the workload.
Hardware timing runs disable tracing and Chrome's headless frame cap; these measurements do not certify display presentation or native-resolution gameplay.
Other budgets are 250 ms maximum steady-frame stall,
500 ms startup, first-animation, population, and transition stall, and 15 seconds for world readiness. These ceilings are exercised on Apple/Metal; they do not certify a low-spec device. Retained GPU resources must plateau
between laps. Collected JS heap growth is bounded to 32 MiB. Missing/software GPU adapters fail
hardware runs explicitly. Performance is deliberately measured outside concurrent native suites.

The required `gate` workflow runs Chrome/Firefox on Linux and Chrome/WebKit on macOS on every
pull request and edge push. These jobs check compatibility and resource bounds. Removing the Windows
GPU jobs leaves no automatic hardware FPS gate; the full hardware workload remains available through
the command above. The hosted compatibility matrix is not an FPS certificate. Fixed budgets detect
breaches, not every small slowdown. Playwright WebKit does not certify shipping Safari.

Results and live-scene screenshots live under `test-results/`. Compatibility runs also retain failure traces.
Hardware runs exclude tracing because its screencast work perturbs frame timing. Review cold population stalls
alongside p95: a smooth average can conceal first-use shader compilation. Crowd stages use the gameplay camera before entering the projected overview. Normal and flat captures are taken while the scene is alive.
These workloads move the existing spectate camera without restarting its transition and verify its actual target
at each residency waypoint and endpoint. Sample durations remain stable when the browser frame cap is disabled. They measure model
population and flat/fight transitions separately. They do not exercise character collision on that route.

CI uses standard hosted runners only. Paid GPU runners are outside the approved testing scope.

Stable Chrome is the required Chromium-engine target. On 2026-09-06, bundled Chromium 153.0.8010.12 failed Metal shader compilation
with a Tint swizzle-lowering error while stable Chrome 152.0.7977.76 rendered the same scene.
Browser console errors are fatal; loaded object counts alone cannot certify rendering.

The live-reload balance regression uses an isolated development server, since production builds
do not expose module replacement. It proves that a re-evaluated route retains the sidebar's store
and receives later balance updates. It uses synthetic balances and starts no wallet observers.

```sh
bunx playwright test --config packages/frontend/e2e/playwright.hmr.config.ts
```
