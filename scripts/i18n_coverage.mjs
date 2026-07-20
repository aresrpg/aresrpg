#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n coverage gate: extract every static t('a.b.c') / i18nKey="a.b.c" from frontend/src, PLUS every
// t(cond ? 'a.b' : 'c.d') ternary (both branches are static — fully resolvable), assert each resolves in
// ALL 6 locales. Also report plural-normalized, symmetric en-vs-others leaf-key parity, and
// (non-blocking) surface every dynamic
// t(`ns.prefix_${expr}`) template-literal call site for manual audit — its suffix is a runtime value, not
// statically enumerable, so it can never be a hard gate the way the two static shapes above are.
// Wired into scripts/check-constraints.sh (the green-check) — exits 1 on any used-but-undefined key
// or en-vs-others parity diff (the locale-stomp class), so "green" is impossible while either exists.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Repo-relative (this file lives in <repo>/scripts) so the gate is portable across checkouts / CI.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/frontend/src')
const LOCDIR = join(ROOT, 'i18n/locales')
const LANGS = ['en', 'fr', 'de', 'es', 'ja', 'uk']

const locales = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(LOCDIR, `${l}.json`), 'utf8'))]))

const resolve = (obj, key) => {
  let cur = obj
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part]
    else return undefined
  }
  return cur
}

// walk source
const files = []
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (!/node_modules|dist|generated/.test(p)) walk(p)
    } else if (/\.(t|j)sx?$/.test(e)) files.push(p)
  }
}
walk(ROOT)

// extract static keys: t('a.b'), t("a.b"), i18nKey='a.b' / i18nKey="a.b"
const KEY = /(?:\bt\(\s*|\bi18nKey\s*=\s*)['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g
// Ternary-both-literal calls: t(cond ? 'a.b' : 'c.d') — the literal isn't the direct first arg (any
// condition, incl. ===/parens-free expressions), so KEY above misses it entirely. Both branches ARE
// static, so unlike a template-literal interpolation this class is FULLY resolvable — extract both keys
// and gate them exactly like a plain t('lit') call. (Found live: scribe.tsx shipped 4 raw i18n keys —
// SCRIBE.TAB_GEAR / SCRIBE.TAB_RUNES / place_gear / place_rune — invisible to the old KEY-only regex.)
const TERNARY =
  /\bt\(\s*[^,()]*?\?\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'\s*:\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g
// Template-literal calls: t(`a.b_${expr}`) — the suffix is a runtime value, so the reachable key set isn't
// statically decidable here (would need full data-flow tracing of `expr`). Cheap partial credit: capture
// the static PREFIX (up to the last literal dot before the interpolation) and surface it as a manual-audit
// line every gate run, so this class stays VISIBLE instead of silently unchecked forever.
const TEMPLATE = /\bt\(\s*`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*[._])\$\{/g

const used = new Map() // key -> Set(files)
const dynamicPrefixes = new Map() // 'namespace.prefix_' -> Set(files)
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const rel = f.replace(ROOT + '/', '')
  let m
  while ((m = KEY.exec(src))) {
    const [, k] = m
    if (!used.has(k)) used.set(k, new Set())
    used.get(k).add(rel)
  }
  while ((m = TERNARY.exec(src))) {
    for (const k of [m[1], m[2]]) {
      if (!used.has(k)) used.set(k, new Set())
      used.get(k).add(rel)
    }
  }
  while ((m = TEMPLATE.exec(src))) {
    const [, p] = m
    if (!dynamicPrefixes.has(p)) dynamicPrefixes.set(p, new Set())
    dynamicPrefixes.get(p).add(rel)
  }
}

// 1) used-in-code keys missing from a locale
const missing = [] // {key, langs:[], file}
for (const [k, fset] of used) {
  const miss = LANGS.filter((l) => typeof resolve(locales[l], k) === 'undefined')
  if (miss.length) missing.push({ k, miss, file: [...fset][0] })
}

// 2) symmetric en leaf-key parity. i18next plural variants legitimately differ by language, so compare
// base keys after stripping only a trailing CLDR plural suffix from each full leaf path.
const leaves = (obj, pre = '') => {
  const out = []
  for (const [key, v] of Object.entries(obj)) {
    const p = pre ? `${pre}.${key}` : key
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, p))
    else out.push(p)
  }
  return out
}
const normalize_plural_key = (key) => key.replace(/_(?:zero|one|two|few|many|other)$/, '')
const normalized_key_set = (locale) => new Set(leaves(locale).map(normalize_plural_key))
const en_keys = normalized_key_set(locales.en)
const parity_diffs = []
for (const l of LANGS.filter((x) => x !== 'en')) {
  const locale_keys = normalized_key_set(locales[l])
  const missing_keys = [...en_keys].filter((key) => !locale_keys.has(key)).sort()
  const extra_keys = [...locale_keys].filter((key) => !en_keys.has(key)).sort()
  for (const key of missing_keys) parity_diffs.push(`${l} missing: ${key}`)
  for (const key of extra_keys) parity_diffs.push(`${l} extra: ${key}`)
}

console.log(`FILES scanned: ${files.length} | static t()/i18nKey keys used: ${used.size}`)
console.log(`\n=== USED-IN-CODE keys missing from ≥1 locale (${missing.length}) ===`)
for (const { k, miss, file } of missing.sort((a, b) => a.k.localeCompare(b.k)))
  console.log(`  ${k}  [missing: ${miss.join(',')}]  e.g. ${file}`)
console.log(`\n=== Plural-normalized EN key-set parity diffs (${parity_diffs.length}) ===`)
for (const diff of parity_diffs.sort()) console.log(`  ${diff}`)

// NON-BLOCKING: template-literal t(`ns.prefix_${expr}`) sites — the suffix is a runtime value the static
// gate can't enumerate. Never fails the build; the point is visibility (grep this list before assuming
// "the i18n gate would've caught it" — it can't, for this shape). Audit by hand: find `expr`'s domain
// (an enum/const array/mapping near the call) and resolve each concrete key against en.json.
console.log(
  `\n=== DYNAMIC-KEY sites — template-literal t() (${dynamicPrefixes.size} prefixes, MANUAL AUDIT, non-blocking) ===`
)
for (const [p, fset] of [...dynamicPrefixes].sort(([a], [b]) => a.localeCompare(b)))
  console.log(`  ${p}<...>  e.g. ${[...fset][0]}`)

// Gate verdict: any used-but-undefined key OR any normalized en-vs-others parity diff fails the green-check.
if (missing.length || parity_diffs.length) {
  console.log(
    `\n  ✗ i18n GATE FAILED: ${missing.length} used-but-undefined key(s), ${parity_diffs.length} normalized parity diff(s).`
  )
  console.log('  Fix: add the key to ALL 6 locales (en/fr/de/es/ja/uk) — never one without the others.')
  process.exit(1)
}
console.log('\n  ✓ i18n coverage: every used key resolves; all 6 normalized locale key sets match.')
