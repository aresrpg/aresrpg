// BRAND LAW GATE (2026-07-04, after two comment slips reached cto's gate): no trademarked game
// references anywhere in shippable engine text — source, comments, bench, demo. Cross-team contract
// docs contain flavor prose; workers must PARAPHRASE intent, never quote it into source. This test
// rides `bun test src/` so every wave gate enforces it mechanically — prose never survives pressure.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from 'bun:test'

const BANNED = /dofus|waven|ankama|zaap|kamas/i
const ROOTS = ['src', 'demo', 'bench']
const EXT = /\.(js|ts|html|css|wgsl|md)$/

/** @param {string} dir @param {string[]} out @returns {string[]} */
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

test('brand law: no trademarked tokens in any shippable engine text (incl. comments)', () => {
  const root = join(import.meta.dir, '..')
  /** @type {string[]} */
  const hits = []
  for (const r of ROOTS) {
    for (const file of walk(join(root, r))) {
      // this gate file itself carries the banned spellings in its regex — exempt it alone
      if (file.endsWith('brand_law.test.js')) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`)
      })
    }
  }
  expect(hits).toEqual([])
})
