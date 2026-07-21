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
// renders a verdict against a FRESH local `sui move build` output — the offline source counter refuses to
// silently pass judgment on a stale or absent build artifact; it SKIPs loudly instead (never lies green).
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

console.log('== AresRPG Move field-definition cap gate (all structs ≤ 32 fields) ==')

const sui_version = spawn_sync('sui', ['--version'], { cwd: repo_root, encoding: 'utf8' })
if (sui_version.error?.code === 'ENOENT' || sui_version.status !== 0) {
  console.log('  SKIP: sui CLI absent/unusable; no Move field-cap verdict')
  process.exit(0)
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
  for (const package_dir of missing_source_packages) {
    console.log(`  SKIP: Move source inputs absent for ${package_dir}`)
  }
  console.log('  SKIP: no partial Move field-cap verdict')
  process.exit(0)
}
if (inputs.length === 0) {
  console.log('  SKIP: Move source inputs absent; no Move field-cap verdict')
  process.exit(0)
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
  for (const input of stale_inputs) {
    console.log(
      `  SKIP: absent/stale build output for ${path.relative(repo_root, input.source_path)}; run ${input.build_command}`
    )
  }
  console.log('  SKIP: no partial Move field-cap verdict')
  process.exit(0)
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
