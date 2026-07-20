#!/usr/bin/env bun
// Generate the Mysten sui-gas-pool config from the environment, so the sponsor
// secret NEVER lands in a committed file. Writes gitignored config.local.yaml
// next to this script.
//
// SECURITY: this reads ONLY GAS_POOL_KEYPAIR — a fresh, dedicated, funded testnet
// sponsor key, accepted as EITHER a bech32 `suiprivkey1…` string (a wallet export —
// the format prod operators will paste, ed25519 only) or the legacy base64
// flag||secret (`sui keytool generate` .key file). It NEVER reads SUI_MASTER_KEY or
// any named production wallet (prod-key fence law); unlike the predecessor gas-pool
// script, there is no path here that can pick up the live server key. Generate a key
// with `bun generate-keypair.mjs`.
//
// ANTI-DRAIN CAPS (constitution, ledgered 2026-07-10): the station is an
// identity-blind internal primitive — its native caps are the LAST line behind the
// fronting sponsor service's per-identity gates, so they default to the same
// constitution numbers:
//   daily-gas-usage-cap  = 0.2 SUI/day global (GAS_POOL_DAILY_CAP, MIST)
//   max-sui-per-request  = 0.1 SUI/request    (GAS_POOL_MAX_PER_REQUEST, MIST —
//                          mirrors the app-wide GAS_CEILING_SUI in
//                          packages/frontend/src/game/core/gas_guard.js)
//
// Usage: bun generate-config.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- bech32 `suiprivkey1…` decode — vendored, not a dependency ------------------------------
// packages/rpc has no package.json/node_modules of its own (@mysten/sui does not resolve from
// here — confirmed empirically), so this mirrors @mysten/sui's decodeSuiPrivateKey
// (cryptography/keypair.ts) by hand: bech32 (NOT bech32m) of `flag(1 byte) || secret(32 bytes)`,
// hrp "suiprivkey". Decode only — this tool never mints a suiprivkey string, only accepts one
// pasted from a wallet export. Verified against a real `sui keytool convert` vector before
// landing (see generate-config.test.js).
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
const ED25519_FLAG = 0x00

function bech32_polymod(values) {
  let chk = 1
  for (const v of values) {
    const b = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= BECH32_GEN[i]
  }
  return chk
}

function bech32_hrp_expand(hrp) {
  const out = []
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5)
  out.push(0)
  for (const c of hrp) out.push(c.charCodeAt(0) & 31)
  return out
}

// Regroups 5-bit bech32 words into 8-bit bytes (decode direction: pad=false — any leftover bits
// past a full byte must be zero, else the encoding was corrupt/truncated).
function bech32_convert_bits(words, from_bits, to_bits) {
  let acc = 0
  let bits = 0
  const out = []
  const maxv = (1 << to_bits) - 1
  for (const value of words) {
    if (value < 0 || value >> from_bits !== 0) throw new Error('bech32: invalid word encoding')
    acc = (acc << from_bits) | value
    bits += from_bits
    while (bits >= to_bits) {
      bits -= to_bits
      out.push((acc >>> bits) & maxv)
    }
  }
  if (bits >= from_bits || ((acc << (to_bits - bits)) & maxv) !== 0) {
    throw new Error('bech32: invalid padding bits')
  }
  return out
}

/**
 * Decode a `suiprivkey1…` bech32 string to raw `flag || 32-byte secret` bytes.
 * Pure; throws loud on anything malformed — NEVER includes the input value, decoded bytes, or
 * any substring of either in an error message (format/length verdicts only).
 */
export function decode_sui_private_key(value) {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new Error('suiprivkey: mixed-case bech32 string is invalid')
  }
  const lower = value.toLowerCase()
  const sep = lower.lastIndexOf('1')
  if (sep < 1) throw new Error('suiprivkey: missing bech32 separator')
  const hrp = lower.slice(0, sep)
  const data_part = lower.slice(sep + 1)
  if (hrp !== 'suiprivkey') {
    throw new Error('suiprivkey: unexpected human-readable prefix (expected "suiprivkey")')
  }
  if (data_part.length < 6) throw new Error('suiprivkey: data part too short for a checksum')

  const words = []
  for (let i = 0; i < data_part.length; i++) {
    const idx = BECH32_CHARSET.indexOf(data_part[i])
    if (idx === -1) throw new Error(`suiprivkey: invalid bech32 character at position ${i}`)
    words.push(idx)
  }
  if (bech32_polymod(bech32_hrp_expand(hrp).concat(words)) !== 1) {
    throw new Error('suiprivkey: checksum mismatch (corrupted or mistyped key)')
  }

  const bytes = Uint8Array.from(bech32_convert_bits(words.slice(0, -6), 5, 8))
  if (bytes.length !== 33) {
    throw new Error(`suiprivkey: expected 33 decoded bytes (flag+secret), got ${bytes.length}`)
  }
  if (bytes[0] !== ED25519_FLAG) {
    throw new Error(
      `suiprivkey: unsupported signature-scheme flag 0x${bytes[0].toString(16).padStart(2, '0')} (only ed25519/0x00 accepted)`
    )
  }
  return bytes
}

// The ONE choke where GAS_POOL_KEYPAIR enters: accept either shape, normalize to the legacy
// base64 flag||secret the sui-gas-station signer-config expects. Raw base64 passes through
// unchanged (backward compat — the current testnet value stays valid).
function resolve_keypair_base64(raw) {
  // Case-insensitive detection (bech32 allows an all-uppercase encoding) — a case-sensitive check
  // here would silently skip decoding an uppercase/mixed-case suiprivkey1 string and embed it
  // raw/broken in the YAML instead of rejecting it loudly. decode_sui_private_key still rejects
  // genuinely mixed-case (invalid) strings once inside.
  if (!raw.toLowerCase().startsWith('suiprivkey1')) return raw
  try {
    return Buffer.from(decode_sui_private_key(raw)).toString('base64')
  } catch (err) {
    throw new Error(`GAS_POOL_KEYPAIR: ${err.message}`)
  }
}

/** PURE config render from an env-shaped record (unit-tested; the script main below does the I/O). */
export function render_config(env) {
  const keypair_raw = env.GAS_POOL_KEYPAIR
  if (!keypair_raw) throw new Error('GAS_POOL_KEYPAIR missing')
  const keypair = resolve_keypair_base64(keypair_raw)

  const redis_url = env.GAS_POOL_REDIS_URL ?? 'redis://127.0.0.1:6379'
  const fullnode = env.SUI_FULLNODE_URL ?? 'https://fullnode.testnet.sui.io:443'
  const rpc_port = Number(env.GAS_POOL_PORT ?? 9527)
  // 0.2 SUI/UTC-day global ceiling — the "can't be drained endlessly" number (same figure
  // api/sponsor.mjs enforces as SPONSOR_DAILY_CAP_MIST). Env-raise deliberately at scale.
  const daily_cap = env.GAS_POOL_DAILY_CAP ?? '200000000'
  // 0.1 SUI per reserve_gas request — the app-wide per-tx gas ceiling (GAS_CEILING_SUI).
  const max_per_request = env.GAS_POOL_MAX_PER_REQUEST ?? '100000000'
  const target_init = env.GAS_POOL_TARGET_INIT_BALANCE ?? '100000000'

  return `---
# GENERATED from env by generate-config.mjs — DO NOT COMMIT (holds the sponsor secret).
signer-config:
  local:
    keypair: "${keypair}"
rpc-host-ip: 0.0.0.0
rpc-port: ${rpc_port}
metrics-port: 9184
gas-pool-config:
  redis:
    redis_url: "${redis_url}"
fullnode-url: "${fullnode}"
coin-init-config:
  target-init-balance: ${target_init}
  refresh-interval-sec: 86400
daily-gas-usage-cap: ${daily_cap}
max-sui-per-request: ${max_per_request}
advanced-faucet-mode: false
`
}

if (import.meta.main) {
  let yaml
  try {
    yaml = render_config(process.env)
  } catch (err) {
    // err.message is always format/length-only (never key material — see decode_sui_private_key).
    console.error(err.message)
    if (!process.env.GAS_POOL_KEYPAIR) {
      console.error(
        '\nGenerate a fresh, dedicated sponsor key (never SUI_MASTER_KEY):\n' +
          '  bun generate-keypair.mjs\n' +
          'then export GAS_POOL_KEYPAIR=<suiprivkey1… or base64> and re-run.'
      )
    }
    process.exit(1)
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), 'config.local.yaml')
  writeFileSync(out, yaml, { mode: 0o600 })
  console.log(`wrote ${out}`)
}
