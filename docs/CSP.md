<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# Content-Security-Policy

Defense-in-depth for a wallet-bearing origin. The policy ships from
`packages/frontend/vercel.json` (`headers` block) — the deploy-time seam, applied to every response.

It is **report-only today**. `vercel.json` is strict JSON (Vercel's schema sets
`additionalProperties: false`, so it can carry neither comments nor a note key) — this file is the
policy's one home for _why each source is in it_ and _what has to be true before it enforces_.

## Origin inventory — every source, and where it comes from

A source is in the policy because something in the tree resolves to it. Delete a source only after
its row's origin is gone.

| Directive               | Source                                                                    | Provenance                                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `connect-src`           | `https://rpc.aresrpg.world`                                               | `packages/frontend/src/env.ts` `RPC_URL` — the `/v1` read layer                                 |
| `connect-src`           | `https://sponsor.aresrpg.world`                                           | `VITE_SPONSOR_URL` in the **deployed** build (`env.ts` defaults to same-origin `/api/sponsor`)  |
| `connect-src`           | `https://assets.aresrpg.world`                                            | `packages/frontend/public/asset_manifest.json` `aggregator` — corpora fetched as JSON           |
| `connect-src`           | `https://api.enoki.mystenlabs.com`                                        | `@mysten/enoki` `registerEnokiWallets` (`src/auth/index.ts`) — zkLogin                          |
| `connect-src`           | `https://graphql.testnet.sui.io`                                          | `src/auth/index.ts` `SuiGraphQLClient`                                                          |
| `connect-src`           | `https://fullnode.{testnet,mainnet}.sui.io`, `sui-mainnet.mystenlabs.com` | `packages/sdk/src/sui.js` — both network branches                                               |
| `connect-src`           | `https://{testnet,mainnet}.mvr.mystenlabs.com`                            | `@mysten/sui` MVR name resolution (present in the built bundle)                                 |
| `connect-src`           | `https://o4508074408214528.ingest.de.sentry.io`                           | the `VITE_SENTRY_DSN` host, read off the **served production bundle** (`assets/env-*.js`)       |
| `connect-src`           | `wss://relay.aresrpg.world`                                               | `env.ts` `RELAY_URL` — the p2p signaling relay we run (`src/p2p/lobby-room.js`), one exact host |
| `img-src` / `media-src` | `https://assets.aresrpg.world`, `data:`, `blob:`                          | item/spell/mob art, the hack-mode radio, canvas and object-URL sources                          |
| `style-src`             | `'unsafe-inline'`, `https://fonts.googleapis.com`                         | React `style={{…}}` props are style _attributes_ (CSP3 requires it); the JetBrains Mono sheet   |
| `font-src`              | `https://fonts.gstatic.com`, `data:`                                      | `index.html` font link                                                                          |
| `script-src`            | `'wasm-unsafe-eval'`                                                      | the Draco decoder (`/draco/*.wasm`, `three` `DRACOLoader`)                                      |
| `script-src`            | two `sha256-…`                                                            | the two inline classic scripts in `index.html` (mobile manifest, D146 boot shim)                |
| `worker-src`            | `'self' blob:`                                                            | the engine worker pools (`packages/engine`) and Draco's blob worker                             |

## Deliberately loose, with the reason

- **`style-src 'unsafe-inline'`** — required by React inline styles; removing it means eliminating
  every `style={{…}}` prop, not a header change.

## Before flipping to enforcing

Rename the header to `Content-Security-Policy` only when all of these hold:

- [ ] A clean soak on `edge` — a real player session with zero violation reports.
- [ ] The **undriven** sources are exercised at least once: a Google zkLogin sign-in
      (`api.enoki.mystenlabs.com`, `accounts.google.com`, `graphql.testnet.sui.io`) and a sponsored
      transaction (`sponsor.aresrpg.world`). Local verification could not reach these: the dev wallet
      is DEV-only, so the production-shaped build has no way to sign in. Watch `form-action` on the
      sign-in specifically — an OAuth flow using `response_mode=form_post` submits a form to Google,
      which `form-action 'self'` would refuse. A redirect-mode flow is unaffected.
- [ ] A browser-extension wallet is driven (Sui Wallet / Suiet) — extension-injected page scripts are
      the one class local dev-wallet driving cannot observe.
- [ ] The two `script-src` hashes are re-derived from the **built** `dist/index.html`, and something
      mechanical keeps them honest — a stale hash after an `index.html` edit is a white screen under
      enforcement. Prefer moving both inline scripts to files under `public/` and dropping the hashes.

Re-derive the hashes with:

```sh
cd packages/frontend && bunx vite build
python3 - <<'PY'
import re, base64, hashlib
html = open('dist/index.html', encoding='utf-8').read()
for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S):
    print('sha256-' + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())
PY
```
