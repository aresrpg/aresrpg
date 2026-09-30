# Mobile presentation

The existing frontend serves this package automatically on compact gameplay viewports.
Use the running app at `http://127.0.0.1:5173/`. Login, Play Demo, environment, assets,
service worker and deployment belong to the frontend. This package has no separate app entry.

```sh
bun run --cwd packages/mobile typecheck
bun run test:regression
```

Touch gestures, modal actions, and orientation run in the shared production-build browser suite.
There is no separate mobile browser runner or set of legacy mobile page selectors.
