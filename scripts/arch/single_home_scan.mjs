// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The DUAL-HOME scanner — pure detection for scripts/single-home-gate.sh.
//
// One fact, one home (CLAUDE.md "One home per fact"). Four mechanical shapes of the violation,
// each derived from repo bytes only — no heuristics, no similarity scoring:
//
//   duplicate-export  — one exported name declared in two or more source files.
//   registry-fact     — a name whose canonical home docs/REGISTRY.md NAMES, declared anywhere else
//                       (exported or not — a laundered local re-declaration is the same dual home).
//   registry-anchor   — a registry row whose `path:line` no longer declares anything: the registry
//                       itself drifted, so every rule derived from that row silently stopped.
//   store-writers     — one Zustand store field written by two or more modules.
//
// Reads are the only effect and they live in read_sources; everything below it is a transform over
// plain data, so the same functions run over the real tree and over the self-test fixtures.
import fs from 'node:fs'
import path from 'node:path'

const CODE_FILE = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/
// A `.d.ts` declares no value: it is either tsc emit (a derived mirror of its own source — the one
// "duplicate" that is single-homed by construction, and `bun run --cwd packages/sim lint` writes a
// fresh one mid-gate) or an ambient declaration for someone else's module. Type-level drift is a
// different lane than this gate claims; it does not judge type surfaces.
const TYPE_SURFACE = /\.d\.ts$/
const MOVE_FILE = /\.move$/
const TEST_FILE = /(?:\.|_)(?:test|spec)\.[a-z]+$/
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', 'test', 'tests', '__tests__'])

// A declaration is a name BOUND at this spot. `exported` separates the package's published
// vocabulary (duplicate-export's population) from any binding at all (registry-fact's population).
const EXPORTED_DECL =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/
const JS_DECL = /(?:^|[\s;{(])(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g
const MOVE_DECL = /(?:^|\s)(?:const|fun|struct|enum)\s+([A-Za-z_][\w]*)/g
const STORE_WRITE = /\b([a-z_][\w]*)\.setState\(\s*\{/g
// A store reaches a module under whatever name it is bound to — `const dungeon = use_dungeon`, a
// default parameter, an aliased import. Writers must be attributed to the STORE, not to the local
// spelling, or the second writer of a field hides behind a rename (#1687's exact shape).
const STORE_ALIAS = /(?:^|[\s,({=])([a-z_][\w]*)\s*=\s*(use_[a-z0-9_]+)\b/g
const STORE_IMPORT_ALIAS = /\b(use_[a-z0-9_]+)\s+as\s+([a-z_][\w]*)/g
const OBJECT_KEY = /(?:^|[{,]\s*)([a-z_][a-z0-9_]*)\s*:/gm

const is_scannable = (file) =>
  (CODE_FILE.test(file) || MOVE_FILE.test(file)) && !TEST_FILE.test(file) && !TYPE_SURFACE.test(file)

const walk = (root, relative) => {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) return []
  if (!fs.statSync(absolute).isDirectory()) return is_scannable(relative) ? [relative] : []
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !(entry.isDirectory() && SKIP_DIR.has(entry.name)))
    .flatMap((entry) => walk(root, path.join(relative, entry.name)))
}

// The one effect. Returns repo-relative paths in a stable order so every downstream key is
// deterministic — a gate whose output depends on directory order cannot be ratcheted.
export const read_sources = (root, scan_dirs) =>
  [...new Set(scan_dirs.flatMap((dir) => walk(root, dir)))]
    .sort()
    .map((file) => ({ path: file, text: fs.readFileSync(path.join(root, file), 'utf8') }))

const line_of = (text, offset) => text.slice(0, offset).split('\n').length

// Every binding in one file: name → first line. Exported bindings are tagged; a name that is both
// exported and re-bound locally keeps the exported tag (the published home wins).
export const declarations_in = ({ path: file, text }) => {
  const pattern = MOVE_FILE.test(file) ? MOVE_DECL : JS_DECL
  const found = new Map()
  for (const line_text of text.split('\n')) {
    const exported = EXPORTED_DECL.exec(line_text)
    if (exported) found.set(exported[1], { ...(found.get(exported[1]) ?? {}), exported: true })
  }
  for (const match of text.matchAll(pattern)) {
    const current = found.get(match[1]) ?? {}
    found.set(match[1], { exported: current.exported ?? false, line: current.line ?? line_of(text, match.index) })
  }
  return [...found].map(([name, entry]) => ({ name, path: file, line: entry.line ?? 1, exported: entry.exported }))
}

export const index_of = (sources) => {
  const index = new Map()
  for (const source of sources)
    for (const declaration of declarations_in(source))
      index.set(declaration.name, [...(index.get(declaration.name) ?? []), declaration])
  return index
}

// ── lane: duplicate-export ──────────────────────────────────────────────────────────────────────
// A name exported from two files is two homes for one fact by construction: an importer picking
// either one is a coin flip, and the two copies drift independently (#1536, #1603, #1706).
export const duplicate_exports = (index) =>
  [...index]
    .map(([name, declarations]) => [name, declarations.filter((declaration) => declaration.exported)])
    .filter(([, exported]) => exported.length > 1)
    .flatMap(([name, exported]) =>
      exported.map((declaration) => ({
        lane: 'duplicate-export',
        label: name,
        path: declaration.path,
        line: declaration.line,
        detail: `exported from ${exported.length} files`,
      }))
    )

// ── lane: registry-fact / registry-anchor ───────────────────────────────────────────────────────
// docs/REGISTRY.md is the canonical list of canonical homes. Each row's `path:line` names the
// declaration that OWNS a fact; the gate re-derives the protected symbol from the anchor instead of
// re-listing it here, so the registry stays the single home for what has a single home.
const ANCHOR = /`([^`]+)`/g

export const registry_rows = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes('`'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length > 2)
    .map((cells) => {
      const anchors = []
      let last_path = null
      for (const [, token] of cells[2].matchAll(ANCHOR)) {
        const [, file, line] = /^([^:]*):(\d+)$/.exec(token) ?? []
        if (!line) continue
        last_path = file || last_path
        if (last_path) anchors.push({ path: last_path, line: Number(line) })
      }
      return { fact: cells[1], anchors }
    })

const declared_at = (sources_by_path, anchor) => {
  const text = sources_by_path.get(anchor.path)
  if (text === undefined) return null
  const line_text = text.split('\n')[anchor.line - 1]
  if (line_text === undefined) return null
  const pattern = MOVE_FILE.test(anchor.path)
    ? /^\s*(?:public(?:\([a-z]+\))?\s+|entry\s+|native\s+)*(?:const|fun|struct|enum)\s+([A-Za-z_][\w]*)/
    : /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/
  return pattern.exec(line_text)?.[1] ?? null
}

export const registry_findings = (rows, sources, index) => {
  const sources_by_path = new Map(sources.map((source) => [source.path, source.text]))
  return rows.flatMap((row) =>
    row.anchors.flatMap((anchor) => {
      const symbol = declared_at(sources_by_path, anchor)
      if (!symbol)
        return [
          {
            lane: 'registry-anchor',
            label: row.fact,
            path: `${anchor.path}:${anchor.line}`,
            line: anchor.line,
            detail: 'anchor declares nothing — the registry row cannot protect its fact',
          },
        ]
      return (index.get(symbol) ?? [])
        .filter((declaration) => declaration.path !== anchor.path)
        .map((declaration) => ({
          lane: 'registry-fact',
          label: `${symbol} (${row.fact})`,
          path: declaration.path,
          line: declaration.line,
          detail: `canonical home is ${anchor.path}:${anchor.line}`,
        }))
    })
  )
}

// ── lane: store-writers ─────────────────────────────────────────────────────────────────────────
// A store field written from two modules has two writers for one fact — the shape behind #1034 and
// #1687. Only fields with two or more writing modules are findings: a new single-writer field is
// not a dual home, and a gate that reds on it would train contributors to baseline noise.
const braced_body = (text, open_index) => {
  let depth = 0
  for (let cursor = open_index; cursor < text.length; cursor++) {
    if (text[cursor] === '{') depth++
    else if (text[cursor] === '}' && --depth === 0) return text.slice(open_index, cursor + 1)
  }
  return ''
}

const store_aliases = (text) => {
  const aliases = new Map()
  for (const [, local, store] of text.matchAll(STORE_ALIAS)) aliases.set(local, store)
  for (const [, store, local] of text.matchAll(STORE_IMPORT_ALIAS)) aliases.set(local, store)
  return aliases
}

export const store_writes = (sources) => {
  const writers = new Map()
  for (const { path: file, text } of sources) {
    const aliases = store_aliases(text)
    for (const match of text.matchAll(STORE_WRITE)) {
      // An unattributable receiver (`store.setState` in a helper that takes any store) names no
      // fact, so it names no home: it is not a finding, it is unknown.
      const store = match[1].startsWith('use_') ? match[1] : aliases.get(match[1])
      if (!store) continue
      const body = braced_body(text, match.index + match[0].length - 1)
      for (const [, key] of body.matchAll(OBJECT_KEY)) {
        const field = `${store}.${key}`
        const entry = writers.get(field) ?? new Map()
        if (!entry.has(file)) entry.set(file, line_of(text, match.index))
        writers.set(field, entry)
      }
    }
  }
  return [...writers]
    .filter(([, by_file]) => by_file.size > 1)
    .flatMap(([field, by_file]) =>
      [...by_file].map(([file, line]) => ({
        lane: 'store-writers',
        label: field,
        path: file,
        line,
        detail: `written by ${by_file.size} modules`,
      }))
    )
}

// ── the scan ────────────────────────────────────────────────────────────────────────────────────
export const scan = ({ root, scan_dirs, registry_path }) => {
  const sources = read_sources(root, scan_dirs)
  if (sources.length === 0) throw new Error(`single-home scan read 0 files under ${root} (${scan_dirs.join(', ')})`)
  const registry_file = path.join(root, registry_path)
  if (!fs.existsSync(registry_file)) throw new Error(`single-home scan found no registry at ${registry_file}`)
  const rows = registry_rows(fs.readFileSync(registry_file, 'utf8'))
  if (rows.length === 0) throw new Error(`single-home scan parsed 0 rows out of ${registry_file}`)
  // A registry row the parser cannot anchor would silently drop out of the protected set — the gate
  // would keep printing a green verdict for a fact it stopped watching. Loud instead.
  const unparsed = rows.filter((row) => row.anchors.length === 0)
  if (unparsed.length > 0)
    throw new Error(
      `${registry_file}: ${unparsed.length} row(s) name no \`path:line\` home — ${unparsed
        .map((row) => row.fact)
        .join(', ')}`
    )
  const index = index_of(sources)
  return {
    files: sources.length,
    rows: rows.length,
    findings: [...duplicate_exports(index), ...registry_findings(rows, sources, index), ...store_writes(sources)],
  }
}
