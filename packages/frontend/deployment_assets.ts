// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import ts from 'typescript'
import type { Plugin, UserConfig } from 'vite'
import type { VitePWAOptions } from 'vite-plugin-pwa'

type PrecacheTransforms = NonNullable<NonNullable<VitePWAOptions['workbox']>['manifestTransforms']>

export const validate_deployment_id = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(value) || value.startsWith('dpl_')) throw new Error('Invalid deployment ID')
  return value
}

export const deployment_asset_url = (id: string, path: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}dpl=${encodeURIComponent(validate_deployment_id(id))}`

/** Vite owns asset URLs; the bundler's relative JS imports need the same deployment pin. */
export const pin_chunk_imports = (code: string, id: string): string => {
  const source = ts.createSourceFile('chunk.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const edits: { start: number; end: number; value: string }[] = []
  const visit = (node: ts.Node): void => {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined
    if (specifier && ts.isStringLiteralLike(specifier) && /^\.{1,2}\//.test(specifier.text)) {
      // eslint-disable-next-line fp-law/no-mutating-methods -- This traversal constructs its own local edit list.
      edits.push({
        start: specifier.getStart(source),
        end: specifier.end,
        value: JSON.stringify(deployment_asset_url(id, specifier.text)),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edits
    .toSorted((a, b) => b.start - a.start)
    .reduce((output, edit) => output.slice(0, edit.start) + edit.value + output.slice(edit.end), code)
}

export const deployment_assets_plugin = (id: string): Plugin => ({
  name: 'aresrpg-deployment-assets',
  apply: 'build',
  enforce: 'post',
  configResolved: (config) => {
    validate_deployment_id(id)
    // This build has no source maps. Fail closed if that changes instead of producing inaccurate mappings.
    if (config.build.sourcemap)
      throw new Error('Deployment import pinning requires source-map support before enabling source maps')
  },
  // Include the pin in chunk hashes before rewriting final imports, after Vite resolves CSS preloads.
  augmentChunkHash: () => id,
  generateBundle: {
    order: 'post',
    handler: (_options, bundle) => {
      for (const entry of Object.values(bundle)) {
        if (entry.type !== 'chunk') continue
        entry.code = pin_chunk_imports(entry.code, id)
      }
    },
  },
})

export const deployment_build_config = (
  source: Readonly<Record<string, string>>
): Pick<UserConfig, 'experimental'> & { plugins: Plugin[]; precache_transforms: PrecacheTransforms } => {
  const id = source.ARES_DEPLOYMENT_ID
  if (!id) {
    if (source.VERCEL) throw new Error('ARES_DEPLOYMENT_ID is required for Vercel builds')
    return { plugins: [], precache_transforms: [] }
  }
  return {
    experimental: { renderBuiltUrl: (filename) => deployment_asset_url(id, `/${filename}`) },
    plugins: [deployment_assets_plugin(id)],
    precache_transforms: [
      async (entries) => ({
        manifest: entries.map((entry) => ({ ...entry, url: deployment_asset_url(id, entry.url) })),
        warnings: [],
      }),
    ],
  }
}
