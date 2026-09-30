# Browser verification

Run `bun run test:regression` from the repository root. It builds the test entries with the
production bundler once. Two Chrome workers run independent UI cases while one worker runs
world and renderer cases sequentially. CI uses the same three-worker limit in one macOS job.
Missing graphics support fails the rendering regressions; it never silently skips them.

Keep browser tests for behavior that needs a browser: input and focus ownership, touch gestures,
confirmation boundaries, real storage, asset decoding, and renderer lifetime. Pure state, money,
protocol and combat rules belong in their native unit suites. Avoid source-text assertions,
cosmetic snapshots, exhaustive viewport/locale permutations, and development-only renderers.
Use `test.info().outputPath(...)` for screenshots. Failed tests retain screenshots and traces.

The renderer regression uses the production engine, workers, chunk manager and detail meshes in
a small fixed scene at radius two. It exercises streaming, fight transitions, all quality tiers,
and complete GPU disposal. It does not load a city to test lifecycle bookkeeping. The separate
water and canopy cases retain measured shader regressions.

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
rendering paused and attach a Chrome CPU profile of the complete run. Profiled frame timings
are diagnostic only; use the unprofiled cases for throughput comparisons. This replay excludes
app-store subscribers and network publication. Timing is reported rather than asserted against
an unspecified hardware target.

Results live under `test-results/browser/`. Unit coverage remains separate from browser and
performance measurements. Authored asset freshness runs once in CI through `bun run validate:assets`.
