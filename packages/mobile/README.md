# Mobile presentation

The existing frontend serves this package automatically on compact gameplay viewports.
Use the running app at `http://127.0.0.1:5173/`. Login, Play Demo, environment, assets,
service worker and deployment belong to the frontend. This package has no separate app entry.

```sh
bun run --cwd packages/mobile typecheck
bun run --cwd packages/mobile test:browser
```

Browser tests use the existing frontend development server on port 5173. Fixtures render the real
player canvas owner and shared reducers with mock transaction methods at 667×375 and 844×390.
