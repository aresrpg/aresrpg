// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The DUAL-HOME scanner — pure detection for scripts/single-home-gate.sh.
//
// One fact, one home (CLAUDE.md "One home per fact"). Six mechanical shapes of the violation,
// each derived from repo bytes only — no heuristics, no similarity scoring:
//
//   duplicate-export  — one exported name declared in two or more source files.
//   registry-fact     — a name whose canonical home docs/REGISTRY.md NAMES, declared anywhere else
//                       (exported or not — a laundered local re-declaration is the same dual home).
//   registry-anchor   — a registry row whose `path:line` no longer declares anything: the registry
//                       itself drifted, so every rule derived from that row silently stopped.
//   registry-surface  — a module that is not the home re-exports a registry fact, so the fact has a
//                       second importable name (issue #2222).
//   registry-importer — a consumer binds a registry fact from a specifier that does not resolve to
//                       its home: the fact reached it around the home (issue #2222).
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
// Both Zustand write doors: `store.setState({ field: value })` and the functional
// `store.setState((state) => ({ field: derive(state) }))` / block-arrow twin. The match ends on the
// first object/function-body brace so the shared balanced-brace reader owns the rest.
const STORE_WRITE = /\b([a-z_][\w]*)\.setState\(\s*(?:\{|(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\(?\s*\{)/g
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
// The import/re-export patterns open on the delimiter BEFORE the keyword, which is usually the
// previous line's newline — report the keyword's own line, not the one above it.
const keyword_at = (match) => match.index + Math.max(match[0].search(/\S/), 0)

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

// ── the generated fence: registry-surface / registry-importer (issue #2222) ─────────────────────
// registry-fact above catches a fact RE-DECLARED off-home. These two catch the other half of the
// same law — the fact reaching a consumer through any module BUT its home:
//
//   registry-surface   a module that is not the home re-exports the fact (`export { X } from`,
//                      `export { X as Y } from`, `export * from '<home>'`). A re-export declares
//                      nothing, so every name-based scanner in this repo was blind to it; an
//                      ALIASED one is worse still, because downstream the fact travels under a name
//                      the registry never heard of. Measured on the census tree: exactly that
//                      shape existed (`K_INVISIBILITY as INVISIBILITY_STATUS_KIND`).
//   registry-importer  a consumer binds the fact's name from a specifier that does not resolve to
//                      the home — the "second consumer bypassing the one home" this fence exists for.
//
// The fence is DERIVED, never authored: one rule per registry row whose anchor is an importable JS
// module. Rows anchored on Move sources (chain law) or on a rotten line generate nothing and are
// reported as unfenceable, so the gate never claims coverage it does not have.
const JS_FILE = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/
// A specifier reaches a file through the same candidate ladder bundlers use. Resolution is closed
// over the KNOWN source set: an unresolvable specifier is not silently trusted, it is a finding.
const CANDIDATE_SUFFIX = ['', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '/index.js', '/index.ts', '/index.jsx']
const IMPORT_FROM = /(?:^|[\s;}])import\s+([^;'"]+?)\s+from\s*['"]([^'"]+)['"]/g
// `const { X } = await import('spec')` binds the fact exactly like a static import, and this repo
// uses the form in real source (lazy auth/chain/engine seams), so a fence blind to it is a fence
// with a documented door. The declarator is optional: `({ X } = await import(...))` binds too.
const DYNAMIC_IMPORT = /\{([^{}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]/g
const REEXPORT_FROM = /(?:^|[\s;}])export\s+(\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^{}]*\})\s*from\s*['"]([^'"]+)['"]/g

// `{ a, b as c }` → the imported name and the local/exported one. A default or namespace clause
// binds no registry name, so it contributes nothing.
const named_bindings = (clause) => {
  const braces = /\{([^{}]*)\}/.exec(clause)
  if (!braces) return []
  return braces[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [outer, inner] = part.split(/\s+as\s+/).map((token) => token.trim())
      return { imported: outer.replace(/^type\s+/, ''), local: inner ?? outer.replace(/^type\s+/, '') }
    })
}

// Workspace packages are reached by NAME (`@aresrpg/sim/spell_effect`), so the map is built from
// each package's own `exports` — the same table the runtime resolves through, never a guess.
export const read_workspace_exports = (root) => {
  const packages_dir = path.join(root, 'packages')
  if (!fs.existsSync(packages_dir)) return new Map()
  const subpaths = new Map()
  for (const entry of fs.readdirSync(packages_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest_path = path.join(packages_dir, entry.name, 'package.json')
    if (!fs.existsSync(manifest_path)) continue
    const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'))
    if (!manifest.name) continue
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const file = typeof target === 'string' ? target : (target?.import ?? target?.default)
      if (typeof file !== 'string') continue
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//, '')}`
      subpaths.set(specifier, path.posix.join('packages', entry.name, file.replace(/^\.\//, '')))
    }
  }
  return subpaths
}

export const resolve_specifier = (from_file, specifier, known, workspace) => {
  if (specifier.startsWith('.')) {
    const base = path.posix.join(path.posix.dirname(from_file), specifier)
    // A `.js` specifier in a TypeScript package names the emitted twin of a `.ts` source.
    const stems = [base, base.replace(/\.js$/, '')]
    for (const stem of stems) for (const suffix of CANDIDATE_SUFFIX) if (known.has(stem + suffix)) return stem + suffix
    return null
  }
  return workspace.get(specifier) ?? null
}

export const fences_of = (rows, sources_by_path) => {
  const fenced = []
  const unfenceable = []
  for (const row of rows)
    for (const anchor of row.anchors) {
      const home = `${anchor.path}:${anchor.line}`
      if (!JS_FILE.test(anchor.path)) {
        unfenceable.push({ fact: row.fact, home, reason: 'not an importable JS module (chain source or prose fact)' })
        continue
      }
      const symbol = declared_at(sources_by_path, anchor)
      if (!symbol) {
        unfenceable.push({ fact: row.fact, home, reason: 'anchor declares nothing — see the registry-anchor lane' })
        continue
      }
      fenced.push({ fact: row.fact, home, path: anchor.path, symbol })
    }
  return { fenced, unfenceable }
}

export const fence_findings = (fenced, sources, workspace) => {
  const known = new Set(sources.map((source) => source.path))
  const homes = new Map()
  for (const fence of fenced) homes.set(fence.symbol, fence)
  const findings = []
  for (const { path: file, text } of sources) {
    for (const match of text.matchAll(REEXPORT_FROM)) {
      const [, clause, specifier] = match
      const target = resolve_specifier(file, specifier, known, workspace)
      if (clause.startsWith('*')) {
        // A star re-export republishes EVERY fact the home owns, under the barrel's specifier.
        for (const fence of fenced)
          if (fence.path === target && file !== fence.path)
            findings.push({
              lane: 'registry-surface',
              label: `${fence.symbol} (${fence.fact})`,
              path: file,
              line: line_of(text, keyword_at(match)),
              detail: `star re-export of ${fence.path} — a second importable surface; canonical home is ${fence.home}`,
            })
        continue
      }
      for (const { imported, local } of named_bindings(clause)) {
        const fence = homes.get(imported) ?? homes.get(local)
        if (!fence || file === fence.path) continue
        findings.push({
          lane: 'registry-surface',
          label: `${fence.symbol} (${fence.fact})`,
          path: file,
          line: line_of(text, keyword_at(match)),
          detail:
            imported === local
              ? `re-exported from ${specifier} — a second importable surface; canonical home is ${fence.home}`
              : `re-exported as \`${local}\` from ${specifier} — the fact travels under a name the registry never named; canonical home is ${fence.home}`,
        })
      }
    }
    const bound = [
      ...[...text.matchAll(IMPORT_FROM)].map((match) => ({ match, clause: match[1], specifier: match[2] })),
      ...[...text.matchAll(DYNAMIC_IMPORT)].map((match) => ({ match, clause: `{${match[1]}}`, specifier: match[2] })),
    ]
    for (const { match, clause, specifier } of bound) {
      for (const { imported } of named_bindings(clause)) {
        const fence = homes.get(imported)
        if (!fence || file === fence.path) continue
        const target = resolve_specifier(file, specifier, known, workspace)
        if (target === fence.path) continue
        findings.push({
          lane: 'registry-importer',
          label: `${fence.symbol} (${fence.fact})`,
          path: file,
          line: line_of(text, keyword_at(match)),
          detail: `bound from ${specifier} (${target ?? 'unresolved'}) — the one home is ${fence.home}`,
        })
      }
    }
  }
  return findings
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

const returned_object_bodies = (body) =>
  [...body.matchAll(/\breturn\s*\(?\s*\{/g)]
    .map((match) => braced_body(body, match.index + match[0].length - 1))
    .filter(Boolean)

const write_bodies = (match, body) => {
  if (!match[0].includes('=>')) return [body]
  const after_arrow = match[0].slice(match[0].indexOf('=>') + 2).trim()
  return after_arrow.startsWith('({') ? [body] : returned_object_bodies(body)
}

const depth_at = (text, offset) => {
  let depth = 0
  for (let cursor = 0; cursor < offset; cursor++) {
    if (text[cursor] === '{') depth++
    else if (text[cursor] === '}') depth--
  }
  return depth
}

const close_of = (text, open_index) => {
  let depth = 0
  for (let cursor = open_index; cursor < text.length; cursor++) {
    if (text[cursor] === '{') depth++
    else if (text[cursor] === '}' && --depth === 0) return cursor
  }
  return -1
}

// The written store fact exists at two useful granularities: every statically named top-level key,
// plus one nested key when that top-level value is itself an object literal. Deeper objects stay out:
// this lane claims one-level lifecycle ownership, not a general JavaScript parser.
const object_write_keys = (body) => {
  const rows = [...body.matchAll(OBJECT_KEY)].map((match) => {
    const [, key] = match
    const key_index = match.index + match[0].lastIndexOf(key)
    return { key, key_index, value_index: match.index + match[0].length, depth: depth_at(body, key_index) }
  })
  if (rows.length === 0) return []
  const root_depth = Math.min(...rows.map(({ depth }) => depth))
  const top = rows.filter(({ depth }) => depth === root_depth)
  return top.flatMap((parent) => {
    let open_index = parent.value_index
    while (/\s/.test(body[open_index] ?? '')) open_index++
    if (body[open_index] !== '{') return [parent.key]
    const close_index = close_of(body, open_index)
    const nested = rows
      .filter(({ key_index, depth }) => key_index > open_index && key_index < close_index && depth === root_depth + 1)
      .map(({ key }) => `${parent.key}.${key}`)
    return [parent.key, ...nested]
  })
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
      for (const write_body of write_bodies(match, body))
        for (const key of object_write_keys(write_body)) {
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
// Every guard the registry itself must pass before ANY verdict is derived from it. Fail-closed by
// construction: a registry the parser cannot fully read produces no green, it produces a throw.
export const read_registry = (root, registry_path) => {
  const registry_file = path.resolve(root, registry_path)
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
  // A row pointing at a file that no longer exists is registry staleness, not a measurable finding:
  // no symbol can be derived from it, so its fence would silently vanish. Surface it loudly (#2222).
  const missing = rows.flatMap((row) =>
    row.anchors
      .filter((anchor) => !fs.existsSync(path.join(root, anchor.path)))
      .map((anchor) => `${row.fact} → ${anchor.path}`)
  )
  if (missing.length > 0)
    throw new Error(
      `${registry_file}: ${missing.length} row anchor(s) name a file that does not exist — ${missing.join(', ')}`
    )
  return rows
}

// The fence alone, reading only the anchor files: what the gate's positive control asserts against,
// and the coverage report. Same pure `fences_of` the full scan uses, so the two cannot drift.
export const derive_fences = ({ root, registry_path }) => {
  const rows = read_registry(root, registry_path)
  const anchor_paths = [...new Set(rows.flatMap((row) => row.anchors.map((anchor) => anchor.path)))]
  const sources_by_path = new Map(anchor_paths.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]))
  return fences_of(rows, sources_by_path)
}

export const scan = ({ root, scan_dirs, registry_path }) => {
  const sources = read_sources(root, scan_dirs)
  if (sources.length === 0) throw new Error(`single-home scan read 0 files under ${root} (${scan_dirs.join(', ')})`)
  const rows = read_registry(root, registry_path)
  const index = index_of(sources)
  const { fenced, unfenceable } = fences_of(rows, new Map(sources.map((source) => [source.path, source.text])))
  return {
    files: sources.length,
    rows: rows.length,
    fenced: fenced.length,
    unfenceable: unfenceable.length,
    findings: [
      ...duplicate_exports(index),
      ...registry_findings(rows, sources, index),
      ...fence_findings(fenced, sources, read_workspace_exports(root)),
      ...store_writes(sources),
    ],
  }
}
