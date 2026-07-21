// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('Minimap flush corner layout', () => {
  test('the minimap container has no padding utility classes and is flush to the viewport corner', () => {
    const source = read_fixture('./Minimap.jsx')
    const css = read_fixture('./minimap.css')
    const mobile_css = read_fixture('./mobile-hud.css')
    const container_classes = source.match(/<div className="([^"]*\bmm\b[^"]*)"/)?.[1].split(/\s+/) ?? []
    const minimap_rule = css.match(/(?:^|\n)\.mm\s*\{([^}]*)\}/)?.[1] ?? ''
    const mobile_rule = mobile_css.match(/\.gw-hud--mobile \.mm\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(container_classes).toContain('mm')
    expect(container_classes.some((class_name) => /^p(?:[trblxy])?-/.test(class_name))).toBe(false)
    expect(minimap_rule).toMatch(/top:\s*0/)
    expect(minimap_rule).toMatch(/right:\s*0/)
    expect(minimap_rule).toMatch(/margin:\s*0/)
    expect(minimap_rule).toMatch(/padding:\s*0/)
    expect(mobile_rule).toMatch(/top:\s*0/)
    expect(mobile_rule).toMatch(/right:\s*0/)
  })
})
