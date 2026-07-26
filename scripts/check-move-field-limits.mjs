#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// check-move-field-limits.mjs — the Move struct field-definition cap gate (docs/CODE_LAW.md commit tier).
//
// Sui's VM rejects a package at publish time once any struct crosses the protocol's
// MAX_FIELD_DEFINITIONS_REACHED cap (32 named or positional fields). Class provenance, gold-rig ceremony 04:09:
// `CEREMONY ERROR: Transaction resolution failed: VMVerificationOrDeserializationError in command 0`.
//
// This gate re-parses every packages/move/*/sources/*.move file with a small hand-rolled Move tokenizer
// (no external Move toolchain dependency for the parse itself) and counts fields per struct. It only ever
// renders a verdict against a FRESH local `sui move build` output: the built copy of each source must be
// byte-identical to the source it parses, which is what proves the tokenized bytes are compiler-accepted.
//
// FAIL-CLOSED (#896, extending #892's empty-set policy to tooling absence): no no-verdict state is ever
// silent. Absent `sui`, absent Move sources, absent/stale build output — each is LOUD and names its remedy.
// It used to print `SKIP: sui CLI absent/unusable` and exit 0, which is exactly what every CI runner did:
// the leg's verdict was absent on every PR, including the promotion PR into master, under a green `ladder`.
// The arming lives in .github/workflows/checks.yml (ladder job: pinned sui + `sui move build` for every
// Move package) — the only place this gate can now be satisfied without a laptop.
//
// SEVERITY SPLIT (#938): loud stays, but the no-verdict state is NAMED and diff-aware. Exactly one
// combination exits 0 — a missing toolchain on a checkout whose diff PROVABLY holds no `.move` change,
// where nothing local can breach a cap the ladder has not already judged; it prints a WARN naming the
// toolchain and the merge-base it judged against. Everything else keeps the hard red: any `.move` delta,
// a CI run, an unreadable diff base, and all three of the other no-verdict paths below. Unknowns fail
// CLOSED — the WARN is a strict subset of the old red (severities only ratchet up, FROZEN.md).
//
// Wired into scripts/check-constraints.sh (the green-check). Standalone: `node scripts/check-move-field-limits.mjs`.
import { spawnSync as spawn_sync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const field_limit = 32
const script_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(script_dir, '..')
const move_root = path.join(repo_root, 'packages', 'move')

function package_name(move_toml) {
  const package_section = move_toml.match(/\[package\][^\S\r\n]*\r?\n([\s\S]*?)(?=\r?\n\[|$)/)?.[1] ?? ''
  return package_section.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1]
}

function move_inputs() {
  if (!fs.existsSync(move_root)) return { inputs: [], missing_source_packages: [] }

  const inputs = []
  const missing_source_packages = []
  const package_dirs = fs
    .readdirSync(move_root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(move_root, entry.name))
    .filter((package_dir) => fs.existsSync(path.join(package_dir, 'Move.toml')))
    .sort()

  for (const package_dir of package_dirs) {
    const move_toml_path = path.join(package_dir, 'Move.toml')
    const name = package_name(fs.readFileSync(move_toml_path, 'utf8'))
    if (!name) throw new Error(`package name missing from ${path.relative(repo_root, move_toml_path)}`)

    const source_dir = path.join(package_dir, 'sources')
    const source_files = fs.existsSync(source_dir)
      ? fs
          .readdirSync(source_dir)
          .filter((file_name) => file_name.endsWith('.move'))
          .sort()
      : []
    if (source_files.length === 0) {
      missing_source_packages.push(path.relative(repo_root, package_dir))
      continue
    }

    const build_dir = path.join(package_dir, 'build', name)
    for (const file_name of source_files) {
      const source_path = path.join(source_dir, file_name)
      const source = fs.readFileSync(source_path, 'utf8')
      let tokens
      let qualified_module
      try {
        tokens = tokenize(source)
        qualified_module = module_name(tokens)
      } catch (error) {
        throw new Error(`${path.relative(repo_root, source_path)}: ${error.message}`)
      }
      const local_module = qualified_module.split('::').at(-1)
      inputs.push({
        source_path,
        tokens,
        qualified_module,
        built_source_path: path.join(build_dir, 'sources', file_name),
        bytecode_path: path.join(build_dir, 'bytecode_modules', `${local_module}.mv`),
        build_info_path: path.join(build_dir, 'BuildInfo.yaml'),
        build_command: `sui move build --path ${path.relative(repo_root, package_dir)}`,
      })
    }
  }

  return { inputs, missing_source_packages }
}

function tokenize(source) {
  const tokens = []
  let cursor = 0
  let line = 1

  while (cursor < source.length) {
    const character = source[cursor]
    const pair = source.slice(cursor, cursor + 2)
    if (/\s/.test(character)) {
      if (character === '\n') line += 1
      cursor += 1
    } else if (pair === '//') {
      cursor += 2
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1
    } else if (pair === '/*') {
      let comment_depth = 1
      cursor += 2
      while (cursor < source.length && comment_depth > 0) {
        const comment_pair = source.slice(cursor, cursor + 2)
        if (comment_pair === '/*') {
          comment_depth += 1
          cursor += 2
        } else if (comment_pair === '*/') {
          comment_depth -= 1
          cursor += 2
        } else {
          if (source[cursor] === '\n') line += 1
          cursor += 1
        }
      }
      if (comment_depth !== 0) throw new Error('unterminated block comment')
    } else if (character === '"') {
      cursor += 1
      let escaped = false
      let closed = false
      while (cursor < source.length) {
        const string_character = source[cursor]
        if (string_character === '\n') line += 1
        cursor += 1
        if (escaped) {
          escaped = false
        } else if (string_character === '\\') {
          escaped = true
        } else if (string_character === '"') {
          closed = true
          break
        }
      }
      if (!closed) throw new Error('unterminated string')
    } else if (/[A-Za-z_]/.test(character)) {
      const start = cursor
      cursor += 1
      while (cursor < source.length && /[A-Za-z0-9_]/.test(source[cursor])) cursor += 1
      tokens.push({ value: source.slice(start, cursor), line })
    } else if (pair === '::') {
      tokens.push({ value: pair, line })
      cursor += 2
    } else {
      tokens.push({ value: character, line })
      cursor += 1
    }
  }

  return tokens
}

function matching_token(tokens, start, opening, closing) {
  if (tokens[start]?.value !== opening) throw new Error(`expected ${opening}`)
  let depth = 0
  for (let cursor = start; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].value === opening) depth += 1
    if (tokens[cursor].value === closing) depth -= 1
    if (depth === 0) return cursor
  }
  throw new Error(`unclosed ${opening}`)
}

function module_name(tokens) {
  const module_starts = tokens
    .map((token, index) => (token.value === 'module' ? index : -1))
    .filter((index) => index >= 0)
  if (module_starts.length !== 1) throw new Error(`expected one module declaration, found ${module_starts.length}`)
  const [module_start] = module_starts

  const name_tokens = []
  for (let cursor = module_start + 1; cursor < tokens.length; cursor += 1) {
    const { value } = tokens[cursor]
    if (value === ';' || value === '{') break
    name_tokens.push(value)
  }
  if (name_tokens.length === 0) throw new Error('module name missing')
  return name_tokens.join('')
}

function fields_between(tokens, opening, opening_value, closing_value) {
  const closing = matching_token(tokens, opening, opening_value, closing_value)
  const fields = []
  let field_start = opening + 1
  let paren_depth = 0
  let brace_depth = 0
  let bracket_depth = 0
  let angle_depth = 0

  for (let cursor = opening + 1; cursor < closing; cursor += 1) {
    const { value } = tokens[cursor]
    const at_top = paren_depth === 0 && brace_depth === 0 && bracket_depth === 0 && angle_depth === 0
    if (value === ',' && at_top) {
      fields.push(tokens.slice(field_start, cursor))
      field_start = cursor + 1
    } else if (value === '(') paren_depth += 1
    else if (value === ')') paren_depth -= 1
    else if (value === '{') brace_depth += 1
    else if (value === '}') brace_depth -= 1
    else if (value === '[') bracket_depth += 1
    else if (value === ']') bracket_depth -= 1
    else if (value === '<') angle_depth += 1
    else if (value === '>') angle_depth -= 1
    if (paren_depth < 0 || brace_depth < 0 || bracket_depth < 0 || angle_depth < 0) {
      throw new Error('unbalanced field delimiter')
    }
  }

  if (paren_depth !== 0 || brace_depth !== 0 || bracket_depth !== 0 || angle_depth !== 0) {
    throw new Error('unbalanced field delimiter')
  }
  fields.push(tokens.slice(field_start, closing))
  if (fields.at(-1)?.length === 0) fields.pop()
  if (fields.some((field) => field.length === 0)) throw new Error('empty field definition')
  return { fields, closing }
}

function top_level_token_indexes(tokens, target) {
  const indexes = []
  let paren_depth = 0
  let brace_depth = 0
  let bracket_depth = 0
  let angle_depth = 0

  for (let cursor = 0; cursor < tokens.length; cursor += 1) {
    const { value } = tokens[cursor]
    const at_top = paren_depth === 0 && brace_depth === 0 && bracket_depth === 0 && angle_depth === 0
    if (value === target && at_top) indexes.push(cursor)
    if (value === '(') paren_depth += 1
    else if (value === ')') paren_depth -= 1
    else if (value === '{') brace_depth += 1
    else if (value === '}') brace_depth -= 1
    else if (value === '[') bracket_depth += 1
    else if (value === ']') bracket_depth -= 1
    else if (value === '<') angle_depth += 1
    else if (value === '>') angle_depth -= 1
    if (paren_depth < 0 || brace_depth < 0 || bracket_depth < 0 || angle_depth < 0) {
      throw new Error('unbalanced field delimiter')
    }
  }

  if (paren_depth !== 0 || brace_depth !== 0 || bracket_depth !== 0 || angle_depth !== 0) {
    throw new Error('unbalanced field delimiter')
  }
  return indexes
}

function named_field_count(tokens, opening) {
  const { fields, closing } = fields_between(tokens, opening, '{', '}')
  for (const field of fields) {
    const colon_indexes = top_level_token_indexes(field, ':')
    const field_name = field[colon_indexes[0] - 1]?.value
    if (colon_indexes.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field_name ?? '')) {
      throw new Error('malformed named field definition')
    }
  }
  return { count: fields.length, closing }
}

function positional_field_count(tokens, opening) {
  const { fields, closing } = fields_between(tokens, opening, '(', ')')
  return { count: fields.length, closing }
}

function struct_counts(tokens, qualified_module) {
  const structs = []
  for (let cursor = 0; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].value !== 'struct') continue
    const name_token = tokens[cursor + 1]
    if (!name_token || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name_token.value)) {
      throw new Error(`struct name missing at line ${tokens[cursor].line}`)
    }

    let body = cursor + 2
    if (tokens[body]?.value === '<') body = matching_token(tokens, body, '<', '>') + 1
    while (body < tokens.length && !['{', '(', ';'].includes(tokens[body].value)) body += 1
    if (body >= tokens.length) throw new Error(`struct body missing for ${name_token.value}`)

    let result = { count: 0, closing: body }
    if (tokens[body].value === '{') result = named_field_count(tokens, body)
    if (tokens[body].value === '(') result = positional_field_count(tokens, body)
    structs.push({
      qualified_name: `${qualified_module}::${name_token.value}`,
      fields: result.count,
      line: name_token.line,
    })
    cursor = result.closing
  }
  return structs
}

function source_structs(input) {
  return struct_counts(input.tokens, input.qualified_module).map((struct) => ({
    ...struct,
    source_path: input.source_path,
  }))
}

// A gate that cannot run never prints green: every no-verdict exit is red and carries its remedy.
function no_verdict(reasons, remedy) {
  for (const reason of reasons) console.error(`  ✗ NO VERDICT: ${reason}`)
  console.error(`MOVE FIELD-CAP GATE FAILED (nothing was judged). ${remedy}`)
  process.exit(1)
}

function git_output(args) {
  const result = spawn_sync('git', args, { cwd: repo_root, encoding: 'utf8' })
  if (result.error || result.status !== 0) return null
  return result.stdout
}

// Is a missing toolchain provably harmless in THIS checkout? Only when no `.move` file differs from the
// merge-base with origin/edge — the same base the PR will be judged on. Every branch that cannot prove it
// (a CI run, no reachable origin/edge, a diff git refuses to state) returns the red, so the answer is
// never a guess. `detail` is printed either way: the verdict always names the base it was decided on.
function toolchain_absence_severity() {
  if (process.env.CI)
    return { warn: false, detail: 'CI is set — a CI run renders the verdict or fails; it never warns.' }

  const merge_base = git_output(['merge-base', 'HEAD', 'origin/edge'])?.trim()
  if (!merge_base) {
    return { warn: false, detail: 'no merge-base with origin/edge in this checkout — the Move delta is unknown.' }
  }

  const tracked = git_output(['diff', '--name-only', merge_base])
  const untracked = git_output(['ls-files', '--others', '--exclude-standard'])
  if (tracked === null || untracked === null) {
    return { warn: false, detail: `the diff against ${merge_base} could not be read — the Move delta is unknown.` }
  }

  const move_delta = [...tracked.split('\n'), ...untracked.split('\n')]
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.move'))
    .sort()
  if (move_delta.length > 0) {
    return {
      warn: false,
      detail:
        `${move_delta.length} .move file(s) differ from merge-base ${merge_base} (origin/edge) ` +
        `and cannot be judged without the toolchain: ${move_delta.join(', ')}`,
    }
  }
  return { warn: true, detail: `no .move file differs from merge-base ${merge_base} (origin/edge).` }
}

console.log('== AresRPG Move field-definition cap gate (all structs ≤ 32 fields) ==')

const sui_version = spawn_sync('sui', ['--version'], { cwd: repo_root, encoding: 'utf8' })
if (sui_version.error?.code === 'ENOENT' || sui_version.status !== 0) {
  const toolchain_reason = 'sui CLI absent/unusable — the field-cap verdict needs a fresh `sui move build` witness.'
  const severity = toolchain_absence_severity()
  if (severity.warn) {
    console.error(`  ! NO VERDICT (WARN): ${toolchain_reason}`)
    console.error(`  ! ${severity.detail} Nothing here can breach a cap the CI ladder has not already judged.`)
    console.error(
      'MOVE FIELD-CAP GATE NOT RUN (WARN, exit 0). Install the Sui toolchain (`suiup install sui`) to render ' +
        'the verdict locally; the ladder job renders it on every PR. Any `.move` edit turns this WARN back to red.'
    )
    process.exit(0)
  }
  no_verdict(
    [toolchain_reason, severity.detail],
    'Install the Sui toolchain (`suiup install sui`), then build the Move packages.'
  )
}

let input_state
try {
  input_state = move_inputs()
} catch (error) {
  console.error(`  FAIL: ${error.message}`)
  process.exit(1)
}
const { inputs, missing_source_packages } = input_state
if (missing_source_packages.length > 0) {
  no_verdict(
    missing_source_packages.map((package_dir) => `Move source inputs absent for ${package_dir}`),
    'A package with a Move.toml and no sources/*.move renders no verdict — restore the sources or drop the package.'
  )
}
if (inputs.length === 0) {
  no_verdict(
    ['Move source inputs absent (no packages/move/*/sources/*.move in this checkout).'],
    'This gate needs the Move sources it judges — run it from a full checkout.'
  )
}

const stale_inputs = inputs.filter((input) => {
  if (
    !fs.existsSync(input.build_info_path) ||
    !fs.existsSync(input.bytecode_path) ||
    !fs.existsSync(input.built_source_path)
  )
    return true
  return !fs.readFileSync(input.source_path).equals(fs.readFileSync(input.built_source_path))
})
if (stale_inputs.length > 0) {
  no_verdict(
    stale_inputs.map(
      (input) =>
        `absent/stale build output for ${path.relative(repo_root, input.source_path)}; run ${input.build_command}`
    ),
    'The verdict is only rendered against fresh build output — rebuild the packages above and re-run.'
  )
}

try {
  const structs = inputs.flatMap(source_structs)
  const qualified_names = new Set()
  for (const struct of structs) {
    if (qualified_names.has(struct.qualified_name)) throw new Error(`duplicate struct ${struct.qualified_name}`)
    qualified_names.add(struct.qualified_name)
  }
  const violations = structs.filter((struct) => struct.fields > field_limit)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `  ✗ MAX_FIELD_DEFINITIONS_REACHED: ${violation.qualified_name} has ${violation.fields} field definitions ` +
          `(${violation.fields} > ${field_limit}) at ${path.relative(repo_root, violation.source_path)}:${violation.line}`
      )
    }
    console.error('MOVE FIELD-CAP GATE FAILED. Derive redundant facts or split the struct before publish.')
    process.exitCode = 1
  } else {
    const maximum = structs.reduce((highest, struct) => (struct.fields > highest.fields ? struct : highest))
    console.log(
      `  ✓ ${structs.length} structs checked; maximum ${maximum.fields} fields ` +
        `(${maximum.qualified_name}, protocol cap ${field_limit})`
    )
  }
} catch (error) {
  console.error(`  FAIL: ${error.message}`)
  process.exitCode = 1
}
