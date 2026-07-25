// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RELOCATE-TESTS — the one codemod for the standing "tests live in test/, src is source only" order.
// Per package: `git mv <pkg>/src/<sub>/X.test.js <pkg>/test/<sub>/X.test.js` (subpaths mirrored, never
// clobbering an existing file), then rewrite ONLY the relative specifiers of the moved files by the
// RESOLVED-PATH delta — a specifier is re-resolved from its old directory and re-relativized against its
// new one, so a specifier that already resolves identically (src/ and test/ are siblings) is left byte-alike.
//
// Include set — the specifier FORMS this rewriter covers (anything else is REPORTED, never silently kept):
//   1. static  `import … from '<s>'` / `export … from '<s>'` / bare `import '<s>'`
//   2. dynamic `import('<s>')`                        4. `require('<s>')`
//   3. mock keys `mock.module('<s>'` / `vi.mock('<s>'` / `jest.mock('<s>'`  (bun's mock.module is path-keyed)
//   5. runtime paths `new URL('<s>', import.meta.url)` — including a template head `` `<s>/${x}` ``
// Every OTHER relative-looking string literal in a moved file is printed under UNHANDLED for human
// adjudication, and any path derived without a literal (`path.dirname(fileURLToPath(import.meta.url))`)
// is invisible to a codemod by construction — audit those by hand.
//
// AFTER a run, two things are the operator's (they need judgment a codemod cannot have):
//   · `bunx eslint --fix <pkg>/test` — `./x.js` (sibling group) becomes `../src/x.js` (parent group), so a
//     blank line that separated two import groups is now INSIDE one. Mechanical, but eslint owns the fix.
//   · any path derived without a string literal — `path.dirname(fileURLToPath(import.meta.url))` and friends
//     — is invisible here by construction. Grep the moved set for `import.meta` / `__dirname` and read them.
//
// Usage: bun scripts/relocate-tests.mjs <package-dir> [--dry]
//        bun scripts/relocate-tests.mjs --self-test      (positive control for the rewriter)
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/

/** Every file under `dir` whose name marks it as a test. */
const test_files = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) return test_files(full)
          return TEST_FILE.test(entry.name) ? [full] : []
        })
        .sort()
    : []

/** `src/a/b.test.js` under `<pkg>/src` → `<pkg>/test/a/b.test.js`. */
const relocation = ({ file, package_dir }) => ({
  from: file,
  to: path.join(package_dir, 'test', path.relative(path.join(package_dir, 'src'), file)),
})

const as_relative = (from_dir, to_file) => {
  const rel = path.relative(from_dir, to_file)
  return rel.startsWith('.') ? rel : `./${rel}`
}

// The handled forms, each capturing the specifier in group `spec`. Order is irrelevant: matches are
// collected by absolute offset and applied right-to-left.
const FORMS = [
  { name: 'import/export-from', re: /(?:\bfrom|^\s*import|;\s*import)\s*(['"])(?<spec>[^'"]*)\1/gm },
  { name: 'dynamic-import', re: /\bimport\s*\(\s*(['"])(?<spec>[^'"]*)\1/g },
  { name: 'require', re: /\brequire\s*\(\s*(['"])(?<spec>[^'"]*)\1/g },
  { name: 'mock-key', re: /\b(?:mock\.module|vi\.mock|jest\.mock)\s*\(\s*(['"])(?<spec>[^'"]*)\1/g },
  { name: 'new-URL', re: /\bnew\s+URL\s*\(\s*(['"])(?<spec>[^'"]*)\1/g },
  // template head: only the static part before the first interpolation carries directory meaning
  { name: 'new-URL-template', re: /\bnew\s+URL\s*\(\s*`(?<spec>[^`$]*)/g },
]

const RELATIVE_LITERAL = /(['"`])(?<spec>\.\.?\/[^'"`\n]*)\1/g

const at_end = (hit) => hit.at + hit.length

/**
 * Rewrite a moved file's relative specifiers. Pure: text in, text + audit out.
 * `move_map` is old-absolute → new-absolute, so a specifier pointing at another moved file
 * follows it instead of dangling at its old home.
 */
export const rewrite_specifiers = ({ text, from, to, move_map = new Map() }) => {
  const from_dir = path.dirname(from)
  const to_dir = path.dirname(to)
  const handled = []
  const covered = new Set()

  for (const { name, re } of FORMS)
    for (const match of text.matchAll(re)) {
      const { spec } = match.groups
      const at = match.index + match[0].lastIndexOf(spec)
      covered.add(at)
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue
      // a template head keeps its trailing segment (the interpolated basename) out of resolution
      const is_head = name === 'new-URL-template'
      const cut = is_head ? spec.lastIndexOf('/') + 1 : spec.length
      const dir_part = spec.slice(0, cut)
      const tail = spec.slice(cut)
      if (is_head && cut === 0) continue
      const target = path.resolve(from_dir, dir_part)
      const moved = move_map.get(target) ?? target
      const rebased = as_relative(to_dir, moved)
      const next = is_head ? `${rebased.endsWith('/') ? rebased : `${rebased}/`}${tail}` : rebased
      if (next !== spec) handled.push({ name, at, length: spec.length, spec, next })
    }

  const next_text = handled
    .sort((a, b) => b.at - a.at)
    .reduce((acc, hit) => `${acc.slice(0, hit.at)}${hit.next}${acc.slice(at_end(hit))}`, text)

  const unhandled = [...text.matchAll(RELATIVE_LITERAL)]
    .map((match) => ({ spec: match.groups.spec, at: match.index + match[0].indexOf(match.groups.spec) }))
    .filter((hit) => !covered.has(hit.at))

  return { text: next_text, handled, unhandled }
}

const SELF_TEST = [
  {
    name: 'sibling hop: ./x.js → ../src/x.js',
    text: "import { a } from './store.js'\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: "import { a } from '../src/store.js'\n",
  },
  {
    name: 'already-sibling-relative specifiers are untouched (byte-alike)',
    text: "import x from '../harness/fixtures.js'\nimport y from '../../sim/src/spell_effect.js'\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: "import x from '../harness/fixtures.js'\nimport y from '../../sim/src/spell_effect.js'\n",
  },
  {
    name: 'a specifier pointing at another MOVED file follows it',
    text: "const here = new URL('./a.test.js', import.meta.url)\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    move_map: new Map([['/r/packages/p/src/a.test.js', '/r/packages/p/test/a.test.js']]),
    expect: "const here = new URL('./a.test.js', import.meta.url)\n",
  },
  {
    name: 'new URL into the destination tree collapses to ./',
    text: "const d = new URL('../test/fixtures/capsules', import.meta.url)\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: "const d = new URL('./fixtures/capsules', import.meta.url)\n",
  },
  {
    name: 'template head rebases, interpolation preserved',
    text: 'const f = new URL(`../test/fixtures/journal/${name}`, import.meta.url)\n',
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: 'const f = new URL(`./fixtures/journal/${name}`, import.meta.url)\n',
  },
  {
    name: 'mock.module keys and dynamic imports are rewritten',
    text: "mock.module('./los.js', () => ({}))\nawait import('./project.js')\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: "mock.module('../src/los.js', () => ({}))\nawait import('../src/project.js')\n",
  },
  {
    name: 'subpaths mirror: src/v2/x.test.js → test/v2/x.test.js',
    text: "import { fold } from './fold.js'\n",
    from: '/r/packages/p/src/v2/x.test.js',
    to: '/r/packages/p/test/v2/x.test.js',
    expect: "import { fold } from '../../src/v2/fold.js'\n",
  },
  {
    name: 'bare specifiers and node: builtins are never touched',
    text: "import fs from 'node:fs'\nimport { reduce } from '@aresrpg/sim/reduce'\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: "import fs from 'node:fs'\nimport { reduce } from '@aresrpg/sim/reduce'\n",
  },
  {
    name: 'a relative literal outside the include set is REPORTED, not rewritten',
    text: "const root = path.resolve(dir, '../../..')\n",
    from: '/r/packages/p/src/a.test.js',
    to: '/r/packages/p/test/a.test.js',
    expect: "const root = path.resolve(dir, '../../..')\n",
    unhandled: ['../../..'],
  },
]

const self_test = () => {
  const failures = SELF_TEST.flatMap((probe) => {
    const out = rewrite_specifiers(probe)
    const bad = []
    if (out.text !== probe.expect)
      bad.push(`${probe.name}\n  got:  ${JSON.stringify(out.text)}\n  want: ${JSON.stringify(probe.expect)}`)
    const want_unhandled = probe.unhandled ?? []
    const got_unhandled = out.unhandled.map((hit) => hit.spec)
    if (JSON.stringify(got_unhandled) !== JSON.stringify(want_unhandled))
      bad.push(`${probe.name} — unhandled got ${JSON.stringify(got_unhandled)} want ${JSON.stringify(want_unhandled)}`)
    return bad
  })
  failures.forEach((line) => console.error(`FAIL ${line}`))
  console.log(`self-test: ${SELF_TEST.length - failures.length}/${SELF_TEST.length} probes pass`)
  return failures.length === 0
}

const git_mv = ({ from, to }) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const out = spawnSync('git', ['mv', from, to], { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(`git mv ${from} → ${to}: ${out.stderr.trim()}`)
}

const main = () => {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) return process.exit(self_test() ? 0 : 1)

  const package_dir = args.find((a) => !a.startsWith('--'))
  if (!package_dir) throw new Error('usage: bun scripts/relocate-tests.mjs <package-dir> [--dry]')
  const dry = args.includes('--dry')
  if (!self_test()) throw new Error('rewriter self-test failed — refusing to touch the tree')

  const moves = test_files(path.join(package_dir, 'src')).map((file) => relocation({ file, package_dir }))
  const clobbers = moves.filter((move) => fs.existsSync(move.to))
  if (clobbers.length) throw new Error(`refusing to clobber:\n${clobbers.map((m) => m.to).join('\n')}`)

  const move_map = new Map(moves.map((move) => [path.resolve(move.from), path.resolve(move.to)]))
  const rewrites = moves.map((move) => ({
    ...move,
    ...rewrite_specifiers({
      text: fs.readFileSync(move.from, 'utf8'),
      from: path.resolve(move.from),
      to: path.resolve(move.to),
      move_map,
    }),
  }))

  for (const hit of rewrites)
    for (const spec of hit.unhandled) console.log(`UNHANDLED ${path.basename(hit.from)} → ${spec.spec}`)

  console.log(
    `\n${moves.length} test file(s) to move; ${rewrites.filter((r) => r.handled.length).length} need specifier rewrites`
  )
  if (dry) return

  for (const hit of rewrites) {
    git_mv(hit)
    fs.writeFileSync(hit.to, hit.text)
  }
  console.log(`moved ${moves.length} file(s) into ${path.join(package_dir, 'test')}`)
}

if (import.meta.main) main()
