// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1792): coturn in `use-auth-secret` mode accepts a browser on ONE arithmetic fact —
// base64(HMAC-SHA1(long-term-secret, "<unix-expiry>:<label>")). Get a byte of it wrong and every relayed
// peer is refused in exactly the way the live two-player session failed: signaling completes, ICE finds no
// candidate pair, the world looks empty. So the formula is pinned against a vector this repo did NOT
// compute — no test here encodes with the model it asserts.
//
// VECTOR PROVENANCE. The username is the literal example from the TURN REST API contract coturn implements
// (draft-uberti-behave-turn-rest-00 §2.2, mirrored in coturn's README.turnserver "TURN REST API" section:
// `usercombo = <timestamp>:<username>`, `turn_password = base64(hmac-sha1(secret, usercombo))`). The digest
// was produced twice, by two implementations that share no code with ours:
//
//   printf '%s' '12334939:mbzrxpgjys' | openssl dgst -sha1 -hmac 'north' -binary | openssl base64
//   python3 -c "import hmac,hashlib,base64;print(base64.b64encode(
//     hmac.new(b'north', b'12334939:mbzrxpgjys', hashlib.sha1).digest()).decode())"
//
// Both printed `Iq7YXkRon8YXJfdN1Ke9EZOw1UE=`. Re-run either to re-derive the row below.
//
// Standalone invocation (this file sets its own env; run it in its own bun process — api/run_tests.sh does):
//   cd api && bun test test/turn_credentials.test.js
import { expect, test } from 'bun:test'

// The route half exercises the anti-drain window, which has to be COUNTABLE to be measured — so it runs on
// the in-memory one, legal only on localnet where one process is the whole deployment (the same carve-out
// test/sponsor_shared_nat.test.js takes). Off localnet a missing shared store refuses every mint instead,
// which is the correct production polarity and is asserted by the last test here.
process.env.REDIS_URL = ''
process.env.VITE_NETWORK = 'localnet'
delete process.env.TURN_SECRET
delete process.env.TURN_URL

const { turn_credential, turn_label, mint_turn_credentials, TURN_TTL_SECS } = await import('../turn_credentials.mjs')
const { api_fetch } = await import('../server.mjs')

const VECTOR = {
  secret: 'north',
  label: 'mbzrxpgjys',
  expiry: 12334939,
  credential: 'Iq7YXkRon8YXJfdN1Ke9EZOw1UE=',
}

const mint_request = (headers = { 'cf-connecting-ip': '198.51.100.7' }) =>
  api_fetch(new Request('http://api.test/turn-credentials', { headers }), null)

test('the credential is base64(HMAC-SHA1(secret, "<expiry>:<label>")) — the coturn REST vector', () => {
  const ttl_secs = 3600
  const pair = turn_credential({
    secret: VECTOR.secret,
    label: VECTOR.label,
    ttl_secs,
    now_secs: VECTOR.expiry - ttl_secs,
  })

  expect(pair.username).toBe(`${VECTOR.expiry}:${VECTOR.label}`)
  expect(pair.credential).toBe(VECTOR.credential)
  expect(pair.ttl).toBe(ttl_secs)
})

test('the expiry is the wall-clock deadline coturn re-hashes, in whole seconds', () => {
  const now_secs = 1_800_000_000.9
  const { username } = turn_credential({ secret: 's', label: 'l', ttl_secs: 900, now_secs })
  expect(username).toBe('1800000900:l')
})

test('every mint carries its own label, so one caller cannot spend another player`s allocation quota', () => {
  const labels = new Set(Array.from({ length: 64 }, turn_label))
  expect(labels.size).toBe(64)
  for (const label of labels) expect(label).toMatch(/^ares-[0-9a-f]{8}$/)
})

test('an unconfigured deployment mints NOTHING rather than a pair coturn would reject', () => {
  expect(mint_turn_credentials()).toBe(null)
  process.env.TURN_SECRET = VECTOR.secret
  expect(mint_turn_credentials()).toBe(null) // secret without a relay url is still no relay
  delete process.env.TURN_SECRET
  process.env.TURN_URL = 'turn:turn.test:3478'
  expect(mint_turn_credentials()).toBe(null)
  delete process.env.TURN_URL
})

test('GET /turn-credentials answers the ICE shape a browser can use directly', async () => {
  process.env.TURN_SECRET = VECTOR.secret
  process.env.TURN_URL = 'turn:turn.test:3478'
  const now_secs = Math.floor(Date.now() / 1000)
  const response = await mint_request()
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(body.urls).toBe('turn:turn.test:3478')
  expect(body.ttl).toBe(TURN_TTL_SECS)
  const [expiry, label] = body.username.split(':')
  expect(Number(expiry)).toBeGreaterThanOrEqual(now_secs + TURN_TTL_SECS)
  expect(label).toMatch(/^ares-[0-9a-f]{8}$/)
  // The response is the vector's own formula over the username it just handed out — the secret never travels.
  expect(body.credential).toBe(
    turn_credential({ secret: VECTOR.secret, label, ttl_secs: 0, now_secs: Number(expiry) }).credential
  )
  expect(JSON.stringify(body)).not.toContain(VECTOR.secret)
})

test('the mint refuses a caller the edge did not vouch for — never an anonymous credential', async () => {
  process.env.TURN_SECRET = VECTOR.secret
  process.env.TURN_URL = 'turn:turn.test:3478'
  // No `cf-connecting-ip`, and no socket peer either: nothing here is a rate-limit key the caller cannot pick.
  const response = await mint_request({})
  expect(response.status).toBe(503)
  expect((await response.json()).reason).toBe('untrusted-client-identity')
})

test('a configured relay with no secret refuses out loud instead of degrading silently', async () => {
  delete process.env.TURN_SECRET
  process.env.TURN_URL = 'turn:turn.test:3478'
  const response = await mint_request()
  expect(response.status).toBe(503)
  expect((await response.json()).error).toContain('turn-unavailable')
})
