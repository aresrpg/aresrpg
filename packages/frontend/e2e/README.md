# Browser verification

Run `bun run test:regression` from the repository root for the blocking browser checks: critical
authentication, confirmation, selection, and fight/session interactions plus one WebGPU renderer
smoke check. CI runs the UI and renderer projects on separate macOS runners and stops on the first
failure. The explicit critical list in `playwright.config.ts` prevents new visual tests from silently
joining the gate. Builds, lint, types, native coverage, and Move/indexer checks remain required.

Run `bun run test:browser:diagnostics` manually for the remaining browser scenarios, including pixel
comparisons, layout, camera behavior, and cinematic choreography. These checks do not block CI.

Keep browser tests for behavior that needs a browser: input and focus ownership, touch gestures,
confirmation boundaries, real storage, asset decoding, and renderer lifetime. Pure state, money,
protocol and combat rules belong in their native unit suites. Avoid source-text assertions,
cosmetic snapshots, exhaustive viewport/locale permutations, and development-only renderers.
Use `test.info().outputPath(...)` for screenshots. Failed tests retain screenshots and traces.

The required renderer smoke check uses a small flat scene at Low quality and radius one. It checks
WebGPU startup, presented terrain, errors, and complete GPU resource disposal. It does not load
characters or cities, compare pixels, switch through every quality tier, or wait through a cinematic.
The extended renderer, water, and canopy scenarios remain available in manual diagnostics.

`bun run test:performance` runs the authored city and forest with 100 characters, 48 mobs,
100 pets, and repeated traversal and quality changes. The `performance` workflow runs only on
manual dispatch. It reports machine and adapter identity, cold loading, frame timing, completed
GPU throughput, residency, retained buffers and textures, and collected JavaScript heap.
Measurements drain submitted GPU work between stages. They do not claim physical VRAM usage or
compare unrelated machines against one OS-based FPS number. Correctness and resource-growth
assertions remain enforced. Timing runs use a hardware adapter, disable tracing and remove the
headless frame cap.

The diagnostic cases compare zero, one, and six equipped running characters, then six Unbroken
and six admin auras. Ruins cases use three characters in a dense nearby forest. They use
individual models, matching controlled characters, and repeat in reverse order after warm-up. City and forest cases compare clustered foliage against voxel
crowns and water enabled against disabled. Medium and Low city cases measure the complete
quality presets, including their different resolution and residency budgets. Run these alone
with `bun run test:performance --grep diagnostic --grep-invert navigation`. Run the navigation
profiles separately with `bun run test:performance --grep navigation`. Each sample includes
median, p95, p99, worst frame time, and the percentage of frames above the 120 FPS budget (8.33 ms). Screenshots verify
the sampled scenes. These rendering workloads do not simulate live party navigation or network
traffic. Water removal changes the recipe; it measures the complete water path, not one shader.
The separate `navigation` case also replays sixty seconds of two followers against resident
terrain at the production feed’s 100 ms cadence. It reports synchronous navigation cost with
rendering paused and attaches a Chrome CPU profile of the complete run. Profiled frame timings
are diagnostic only; use the unprofiled cases for throughput comparisons. This replay excludes
app-store subscribers and network publication. Timing is reported rather than asserted against
an unspecified hardware target.

`bun run test:performance --grep 'solo Thebes'` profiles an equipped, controlled character walking
the same 260-block street twice. It records per-frame position, residency and uploads alongside
separate standing, cold-walk and warm-walk CPU profiles. Lighting stays fixed for comparisons.
The route assertion catches blocked movement; Low/Medium/High horizon captures and final resource
disposal verify the renderer. This isolated workload excludes HUD subscribers and network traffic.

Performance samples count actual canvas render frames, not all animation callbacks. Upload
instrumentation reports real `writeBuffer` calls, bytes and CPU time. One separately fenced frame
per stage records render-pass GPU timestamps when supported; this is a sample, not a GPU percentile.
Stationary empty scenes enforce a 64 KiB/frame upload ceiling to catch accidental full-buffer uploads.
Set `PERF_GPU=0` to disable upload and timestamp instrumentation for a throughput-only run.
`PERF_VIEWPORT=mobile PERF_CPU_RATE=4 bun run test:performance --grep ruins` uses an 844×390
viewport at DPR 3 with fourfold CPU throttling. It is a constrained desktop experiment, not a claim
about a physical phone's GPU, browser, thermals, or refresh rate.

Results live under `test-results/browser/`. Unit coverage remains separate from browser and
performance measurements. Authored asset freshness runs once in CI through `bun run validate:assets`.
