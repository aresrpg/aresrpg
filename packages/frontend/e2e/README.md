# Browser verification

Run `bun run test:regression` from the repository root. It builds the test entries with the
production bundler and runs one Chrome worker. CI runs this suite once on macOS with WebGPU.
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

Results live under `test-results/browser/`. Unit coverage remains separate from browser and
performance measurements. Authored asset freshness runs once in CI through `bun run validate:assets`.
