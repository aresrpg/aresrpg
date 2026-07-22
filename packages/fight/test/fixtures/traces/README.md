# Captured fight-store traces

These fixtures are real payloads exported by the live fight-store trace recorder. Keep their
wire data unchanged: tests must decode and replay the captured bytes, not a model-generated twin.

- `trace_0x3f6103fb3fb842bac763a3d275f607d33e49fcde787f004229c18e900e95c33a.json`
  was captured from fight
  `0x3f6103fb3fb842bac763a3d275f607d33e49fcde787f004229c18e900e95c33a`
  on app v1.12.50 at Unix time `1784752468344`. It is the production desync capsule attached to
  issue #512: place trap, push a mob into it, then advance while the client's fold freezes.
