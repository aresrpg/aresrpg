import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import plugin from './scripts/eslint-rules/no_silent_failures.mjs'
const RULE = 'nsf/no-swallowed-failure'
// The file set is eslint.config.js's net verbatim: files + its ignores + the config's global ignores.
const eslint = new ESLint({ overrideConfigFile: true, errorOnUnmatchedPattern: false, overrideConfig: [
  { files: ['packages/*/src/**/*.{js,ts,tsx}', 'packages/rpc/**/*.{js,ts}', 'api/**/*.{js,mjs}'], ignores: ['**/*.test.*', '**/*.spec.*'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parser: tseslint.parser },
    plugins: { nsf: plugin }, rules: { [RULE]: 'warn' } },
  { ignores: ['**/dist/*','node_modules/*','**/generated/*','packages/sim/**','packages/sdk/**','packages/move/**','packages/rpc/indexer/**','**/public/draco/**'] }] })
const results = await eslint.lintFiles(['packages/*/src/**/*.{js,ts,tsx}', 'packages/rpc/**/*.{js,ts}', 'api/**/*.{js,mjs}'])
const pf = results.map((r) => ({ file: r.filePath.split('silent-failure-gate/')[1],
  n: r.messages.filter((m) => m.ruleId === RULE).length })).filter((r) => r.n > 0).sort((a,b)=>b.n-a.n)
console.log(`TOTAL ${pf.reduce((s,r)=>s+r.n,0)} hits / ${pf.length} files (${results.length} linted)`)
for (const r of pf.slice(0,10)) console.log(`  ${String(r.n).padStart(3)}  ${r.file}`)
const pkg = {}
for (const r of pf) { const k = r.file.split('/').slice(0,2).join('/'); pkg[k] = (pkg[k] ?? 0) + r.n }
console.log('PER PACKAGE:', JSON.stringify(pkg))
