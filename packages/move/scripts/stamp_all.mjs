// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The publish/upgrade tail writes the only checked-in deployment-ID artifact.
// Content object ids remain in out/seed_manifest.json and are never folded here.
import { createHash as create_hash, randomUUID as random_uuid } from 'node:crypto'
import {
  existsSync as exists_sync,
  readFileSync as read_file_sync,
  renameSync as rename_sync,
  rmSync as rm_sync,
  writeFileSync as write_file_sync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const here = path.dirname(file_url_to_path(import.meta.url))
const repo = path.resolve(here, '../../..')
const default_manifest = path.join(here, 'out', 'ceremony_manifest.json')
const default_target =
  process.env.STAMP_ALL_TARGET ??
  path.join(repo, 'packages', 'sdk', 'src', 'deployment', 'release.json')
const default_treasury_source = path.join(repo, 'packages', 'move', 'aresrpg', 'Move.toml')
const package_names = [
  'foundation',
  'spells',
  'social',
  'engine',
  'aresrpg',
  'kolizeum',
  'forgemagie',
  'gifting',
  'dungeon',
]
const id_re = /^0x[0-9a-fA-F]{1,64}$/

const json_clone = (value) => JSON.parse(JSON.stringify(value ?? {}))
const require_id = (value, label) => {
  if (!id_re.test(value ?? '')) throw new Error(`release config: ${label} is not a Sui id`)
  return value
}
const optional_id = (value, label) => (value ? require_id(value, label) : '')
const treasury_from_move_toml = (toml_path = default_treasury_source) => {
  if (!exists_sync(toml_path)) return ''
  const source = read_file_sync(toml_path, 'utf8')
  const addresses = source.match(/(?:^|\n)\[addresses\]\s*\n([\s\S]*?)(?=\n\[|$)/)?.[1] ?? ''
  const treasury = addresses.match(/^treasury\s*=\s*"([^"]+)"/m)?.[1] ?? ''
  if (!treasury) throw new Error(`release config: ${path.relative(repo, toml_path)} has no treasury address`)
  return require_id(treasury, 'actors.treasury')
}
const require_version = (value, label) => {
  const version = String(value ?? '')
  if (!/^\d+$/.test(version)) throw new Error(`release config: ${label} is not a shared version`)
  return version
}
const optional_version = (value, label) => (value ? require_version(value, label) : '')
const validate_id_map = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`release config: ${label} is not an id map`)
  for (const [key, id] of Object.entries(value)) optional_id(id, `${label}.${key}`)
}
const require_coin_type = (value, label) => {
  const match = /^(0x[0-9a-fA-F]{1,64})::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.exec(
    value ?? ''
  )
  if (!match) throw new Error(`release config: ${label} is not a Sui coin type`)
  require_id(match[1], label)
}

// An upgrade repoints `latest`; the retired id must stay sponsorable while clients still mid-session
// on it drain out (see api/sponsor.mjs release_package_ids). `previous` accumulates every prior latest
// across ceremonies — origin is always allowlisted, so it never needs a slot — and only appears when
// non-empty, so un-upgraded packages stay byte-identical to the pre-roll shape.
//
// An upgrade keeps the ORIGIN fixed; a fresh publish mints a new one. So a changed origin means this is a
// different package lineage, and every id the prior row accumulated belongs to the OLD one — carrying them
// forward pins ids this package never had (they land in the sponsor's outdated-package list, and in any
// consumer that reads `previous` as this lineage's history). A lineage switch therefore RESETS the
// accumulation rather than appending to it.
export function package_row(entry, name, prior = {}) {
  if (!entry || typeof entry !== 'object') throw new Error(`ceremony manifest has no ${name} package`)
  const origin = require_id(entry.pkg, `${name}.pkg`)
  const latest = require_id(entry.latest ?? entry.pkg, `${name}.latest`)
  const same_lineage = !prior.origin || prior.origin === origin
  const inherited = same_lineage ? prior.previous : []
  const prior_latest = same_lineage ? prior.latest : null
  const retired = prior_latest && prior_latest !== latest ? [...(inherited ?? []), prior_latest] : inherited
  const previous = [...new Set(retired ?? [])].filter((id) => id !== latest && id !== origin)
  return {
    origin,
    latest,
    ...(previous.length ? { previous } : {}),
    upgrade_cap: require_id(entry.upgradeCap, `${name}.upgradeCap`),
    admin: optional_id(entry.admin, `${name}.admin`),
    caps: json_clone(entry.caps),
    publishers: json_clone(entry.publishers),
    displays: json_clone(entry.displays),
  }
}

function shared_row(id, initial_shared_version, label) {
  return {
    id: require_id(id, `${label}.id`),
    initial_shared_version: require_version(initial_shared_version, `${label}.initial_shared_version`),
  }
}

/// THE FIGHT-REGISTRY HAND-OFF. `fight_registry::init` shares one registry PER SHARD, so the ceremony stamps a
/// LIST where it used to stamp a single id: `shared.FightRegistryShards` and `shared_versions.FightRegistryShards`
/// are index-ordered arrays of the same length, and that length must equal the Move `SHARD_COUNT` (mirrored in the
/// SDK as `FIGHT_SHARD_COUNT`). Short, long or ragged input refuses here rather than shipping a pin that would
/// abort `EWrongShard` on every create.
const FIGHT_SHARD_COUNT = 16

function shared_row_list(ids, versions, label, expected) {
  const id_list = ids ?? []
  const version_list = versions ?? []
  if (id_list.length !== expected || version_list.length !== expected)
    throw new Error(
      `[stamp_all] ${label} needs ${expected} index-ordered rows, got ${id_list.length} ids / ${version_list.length} versions — the shard list is stamped whole or not at all.`
    )
  return id_list.map((id, i) => shared_row(id, version_list[i], `${label}[${i}]`))
}

function shared_rows(manifest) {
  return {
    SPELLS_VERSION: shared_row(
      manifest.spells.version,
      manifest.spells.shared_versions?.Version,
      'SPELLS_VERSION'
    ),
    SPELL_REGISTRY: shared_row(
      manifest.spells.shared?.SpellRegistry,
      manifest.spells.shared_versions?.SpellRegistry,
      'SPELL_REGISTRY'
    ),
    SOCIAL_VERSION: shared_row(
      manifest.social.version,
      manifest.social.shared_versions?.Version,
      'SOCIAL_VERSION'
    ),
    SOCIAL_FRIEND_REGISTRY: shared_row(
      manifest.social.shared?.FriendRegistry,
      manifest.social.shared_versions?.FriendRegistry,
      'SOCIAL_FRIEND_REGISTRY'
    ),
    ENGINE_VERSION: shared_row(
      manifest.engine.version,
      manifest.engine.shared_versions?.Version,
      'ENGINE_VERSION'
    ),
    FIGHT_REGISTRY_SHARDS: shared_row_list(
      manifest.engine.shared?.FightRegistryShards,
      manifest.engine.shared_versions?.FightRegistryShards,
      'FIGHT_REGISTRY_SHARDS',
      FIGHT_SHARD_COUNT
    ),
    VERSION: shared_row(
      manifest.aresrpg.version,
      manifest.aresrpg.shared_versions?.Version,
      'VERSION'
    ),
    GAME_CONFIG: shared_row(
      manifest.aresrpg.shared?.GameConfig,
      manifest.aresrpg.shared_versions?.GameConfig,
      'GAME_CONFIG'
    ),
    CATALOG: shared_row(
      manifest.aresrpg.shared?.Catalog,
      manifest.aresrpg.shared_versions?.Catalog,
      'CATALOG'
    ),
    SCRIBE_CONFIG: shared_row(
      manifest.aresrpg.shared?.ScribeConfig,
      manifest.aresrpg.shared_versions?.ScribeConfig,
      'SCRIBE_CONFIG'
    ),
    PET_FEED_CONFIG: shared_row(
      manifest.aresrpg.shared?.PetFeedConfig,
      manifest.aresrpg.shared_versions?.PetFeedConfig,
      'PET_FEED_CONFIG'
    ),
    CREATION: shared_row(
      manifest.gifting.shared?.Creation,
      manifest.gifting.shared_versions?.Creation,
      'CREATION'
    ),
    POOL_REGISTRY: shared_row(
      manifest.gifting.shared?.PoolRegistry,
      manifest.gifting.shared_versions?.PoolRegistry,
      'POOL_REGISTRY'
    ),
    LOOT_REGISTRY: shared_row(
      manifest.gifting.shared?.LootRegistry,
      manifest.gifting.shared_versions?.LootRegistry,
      'LOOT_REGISTRY'
    ),
    CRUSH_BOARD: shared_row(
      manifest.forgemagie.shared?.CrushBoard,
      manifest.forgemagie.shared_versions?.CrushBoard,
      'CRUSH_BOARD'
    ),
  }
}

function policy_row(policy, label) {
  return {
    id: require_id(policy?.policy, `${label}.policy`),
    initial_shared_version: require_version(
      policy?.initial_shared_version,
      `${label}.initial_shared_version`
    ),
    cap: optional_id(policy?.cap, `${label}.cap`),
  }
}

/** Convert a ceremony receipt into one network row while preserving non-ceremony external metadata. */
export function release_network_from_manifest(manifest, previous = {}) {
  const packages = Object.fromEntries(
    package_names.map((name) => [name, package_row(manifest[name], name, previous.packages?.[name])])
  )
  return {
    chain_id: manifest._chain_id ?? previous.chain_id ?? '',
    source_hash: create_hash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    packages,
    shared: shared_rows(manifest),
    policies: {
      character: policy_row(manifest.policies?.character, 'policies.character'),
      item: policy_row(manifest.policies?.item, 'policies.item'),
      extract: policy_row(manifest.policies?.extract, 'policies.extract'),
      // The CHARACTER-extract (delete-door) policy ships at ITS OWN ceremony (BACKLOG 18 upgrade wave):
      // OPTIONAL until then — stamp when the manifest carries it, else preserve the previous stamp.
      ...(manifest.policies?.character_extract || previous.policies?.character_extract
        ? {
            character_extract: manifest.policies?.character_extract
              ? policy_row(manifest.policies.character_extract, 'policies.character_extract')
              : json_clone(previous.policies.character_extract),
          }
        : {}),
    },
    type_origins: {
      zone_group_root: optional_id(
        manifest._type_origins?.zone_group_root ?? previous.type_origins?.zone_group_root,
        'type_origins.zone_group_root'
      ),
    },
    rules_package: require_id(manifest._rules, '_rules'),
    external_coin_types: json_clone(previous.external_coin_types),
    actors: {
      signer: require_id(manifest._signer, '_signer'),
      station: manifest._station ? require_id(manifest._station, '_station') : '',
      owner: optional_id(manifest._owner || previous.actors?.owner, 'actors.owner'),
      treasury: optional_id(manifest._treasury || previous.actors?.treasury, 'actors.treasury'),
    },
    system: json_clone(previous.system),
    constants: json_clone(previous.constants),
  }
}

export function release_from_manifest(manifest, previous = {}, generated_at = new Date().toISOString()) {
  const network = manifest?._network
  if (!['testnet', 'mainnet'].includes(network))
    throw new Error(`ceremony manifest _network=${JSON.stringify(network)}; expected testnet|mainnet`)
  return {
    schema: 1,
    generated_at,
    networks: {
      ...Object.fromEntries(
        Object.entries(previous.networks ?? {}).map(([name, row]) => [
          name,
          {
            ...row,
            type_origins: { zone_group_root: row.type_origins?.zone_group_root ?? '' },
            actors: {
              ...row.actors,
              owner: row.actors?.owner || manifest._owner || '',
              treasury: row.actors?.treasury || manifest._treasury || '',
            },
          },
        ])
      ),
      [network]: release_network_from_manifest(manifest, previous.networks?.[network]),
    },
  }
}

function validate_network(row, network, required) {
  for (const name of package_names) {
    const entry = row.packages?.[name]
    const id = required ? require_id : optional_id
    id(entry?.origin, `${network}.packages.${name}.origin`)
    id(entry?.latest, `${network}.packages.${name}.latest`)
    id(entry?.upgrade_cap, `${network}.packages.${name}.upgrade_cap`)
    optional_id(entry?.admin, `${network}.packages.${name}.admin`)
    for (const field of ['caps', 'publishers', 'displays'])
      validate_id_map(entry?.[field] ?? {}, `${network}.packages.${name}.${field}`)
  }
  for (const [name, shared] of Object.entries(row.shared ?? {})) {
    const id = required ? require_id : optional_id
    const version = required ? require_version : optional_version
    // A LIST-shaped pin (the fight-registry shards) validates row by row — same rules, one index at a time.
    const rows = Array.isArray(shared)
      ? shared.map((row, i) => [row, `${network}.shared.${name}[${i}]`])
      : [[shared, `${network}.shared.${name}`]]
    for (const [pin, label] of rows) {
      id(pin?.id, `${label}.id`)
      version(pin?.initial_shared_version, `${label}.initial_shared_version`)
    }
  }
  for (const name of ['character', 'item', 'extract', 'character_extract']) {
    const policy = row.policies?.[name]
    // character_extract is OPTIONAL until its ceremony stamps it (BACKLOG 18 delete-door wave).
    if (name === 'character_extract' && !policy) continue
    const id = required ? require_id : optional_id
    const version = required ? require_version : optional_version
    id(policy?.id, `${network}.policies.${name}.id`)
    version(policy?.initial_shared_version, `${network}.policies.${name}.initial_shared_version`)
    optional_id(policy?.cap, `${network}.policies.${name}.cap`)
  }
  optional_id(row.type_origins?.zone_group_root, `${network}.type_origins.zone_group_root`)
  ;(required ? require_id : optional_id)(row.rules_package, `${network}.rules_package`)
  for (const [symbol, token] of Object.entries(row.external_coin_types ?? {})) {
    require_coin_type(token.type, `${network}.external_coin_types.${symbol}.type`)
    if (!Number.isInteger(token.decimal) || token.decimal < 0)
      throw new Error(`release config: ${network}.external_coin_types.${symbol}.decimal is invalid`)
  }
  ;(required ? require_id : optional_id)(row.actors?.signer, `${network}.actors.signer`)
  optional_id(row.actors?.station, `${network}.actors.station`)
  ;(required ? require_id : optional_id)(row.actors?.owner, `${network}.actors.owner`)
  ;(required ? require_id : optional_id)(row.actors?.treasury, `${network}.actors.treasury`)
  optional_id(row.system?.random?.id, `${network}.system.random.id`)
  optional_version(
    row.system?.random?.initial_shared_version,
    `${network}.system.random.initial_shared_version`
  )
  if (!Array.isArray(row.system?.sponsor_framework_packages ?? []))
    throw new Error(`release config: ${network}.system.sponsor_framework_packages is not an array`)
  for (const [index, id] of (row.system?.sponsor_framework_packages ?? []).entries())
    require_id(id, `${network}.system.sponsor_framework_packages.${index}`)
  optional_id(
    row.system?.personal_kiosk_rule_package,
    `${network}.system.personal_kiosk_rule_package`
  )
  const royalty = row.constants?.item_royalty_min_mist ?? ''
  if (royalty && !/^\d+$/.test(String(royalty)))
    throw new Error(`release config: ${network}.constants.item_royalty_min_mist is invalid`)
}

export function validate_release(release, network) {
  if (release?.schema !== 1 || !release?.networks?.[network])
    throw new Error(`release config: missing schema=1 networks.${network}`)
  for (const [name, row] of Object.entries(release.networks))
    validate_network(row, name, name === network)
  return release
}

/** Write beside the target, verify the complete bytes, then replace with one atomic rename. */
export function write_release_atomic(
  target_path,
  release,
  {
    write_file = write_file_sync,
    read_file = read_file_sync,
    rename_file = rename_sync,
    remove_file = rm_sync,
  } = {}
) {
  const source = `${JSON.stringify(release, null, 2)}\n`
  const temp_path = path.join(
    path.dirname(target_path),
    `.${path.basename(target_path)}.${process.pid}.${random_uuid()}.tmp`
  )
  try {
    write_file(temp_path, source, { flag: 'wx' })
    const temp_source = read_file(temp_path, 'utf8')
    if (temp_source !== source) throw new Error('release config: temporary write verification failed')
    JSON.parse(temp_source)
    rename_file(temp_path, target_path)
  } finally {
    remove_file(temp_path, { force: true })
  }
}

// Post-stamp k8s values expectations — PRINT ONLY. The ~/dev/kubernetes values layer
// (domains/aresrpg/releases/*) is a separate repo updated BY HAND at every ceremony; this
// projects the SAME release row stamp_all just wrote into the exact YAML fragments the
// operator should see there, so the ops edit is a diff-check instead of recall. Inlined
// (no sibling module): the gold harness copies stamp_all.mjs alone into its isolated build.
// Consumers are sets on both sides (indexer ARES_PACKAGES → HashSet, sponsor scope →
// normalize_set), so order is cosmetic and duplicates collapse: origins first, then
// upgrade latests, matching the values files' own documented convention.
const unique = (values) => [...new Set(values)]

/** Pure projection: validated release network row + network name → printable block. */
export function k8s_values_expectations(row, network) {
  const packages = row.packages ?? {}
  const names = Object.keys(packages)
  const emitters = names.filter((name) => name !== 'foundation')
  const origins = (list) => list.map((name) => packages[name].origin)
  const latests = (list) =>
    list
      .filter((name) => packages[name].latest !== packages[name].origin)
      .map((name) => packages[name].latest)
  // Retired-but-sponsorable versions live ONLY in the sponsor scope (drain window), never the
  // indexer's event set — an upgraded-away package emits no new events.
  const previouses = (list) => list.flatMap((name) => packages[name].previous ?? [])
  const ares_packages = unique([...origins(emitters), ...latests(emitters)])
  const sponsor_packages = unique(
    [...origins(names), ...latests(names), ...previouses(names), row.rules_package].filter(Boolean)
  )
  return [
    '──── k8s values expectations — diff-check ~/dev/kubernetes by hand (print-only, never written) ────',
    '# domains/aresrpg/releases/rpc-indexer/values.yaml',
    `network: ${network}`,
    '# event-emitting packages (foundation emits none): origins first, then upgrade latests',
    `aresPackages: "${ares_packages.join(',')}"`,
    '# firstCheckpoint: NOT manifest-derivable — publish-tx checkpoint minus ~50 margin (deploy runbook)',
    '',
    '# domains/aresrpg/releases/sponsor/values.yaml',
    `network: ${network}`,
    '# every package origin, upgrade latests, retired drain-window versions, then the kiosk rules package',
    '# (mirrors api/sponsor.mjs release_package_ids — SPONSOR_ARESRPG_PACKAGES on deployed images)',
    'sponsor:',
    `  aresrpgPackages: "${sponsor_packages.join(',')}"`,
    '',
    '# domains/aresrpg/releases/rpc-api/values.yaml — no chain ids; protectorTemplates stays unset post-ceremony',
    '──── end k8s values expectations ────',
  ].join('\n')
}

/** stamp_release's tail step: print the block for the network the ceremony just stamped. */
export function print_k8s_values_expectations(
  release,
  network,
  log = console.log
) {
  log(k8s_values_expectations(release.networks[network], network))
}

export function stamp_release({ manifest_path = default_manifest, target_path = default_target } = {}) {
  const manifest = JSON.parse(read_file_sync(manifest_path, 'utf8'))
  const previous = exists_sync(target_path)
    ? JSON.parse(read_file_sync(target_path, 'utf8'))
    : { schema: 1, networks: {} }
  const previous_network = previous.networks?.[manifest._network]
  const configured_manifest = {
    ...manifest,
    _owner:
      process.env.ARES_OWNER_ADDRESS ||
      process.env.VITE_OWNER_ADDRESS ||
      manifest._owner ||
      previous_network?.actors?.owner ||
      '',
    _treasury:
      process.env.ARES_TREASURY_ADDRESS ||
      manifest._treasury ||
      treasury_from_move_toml() ||
      previous_network?.actors?.treasury ||
      '',
  }
  const release = release_from_manifest(configured_manifest, previous)
  validate_release(release, manifest._network)
  write_release_atomic(target_path, release)
  const disk = JSON.parse(read_file_sync(target_path, 'utf8'))
  validate_release(disk, manifest._network)
  if (JSON.stringify(disk) !== JSON.stringify(release))
    throw new Error('release config: post-rename verification mismatch')
  console.log(
    `stamp_all → ${path.relative(repo, target_path)} (${manifest._network}, ${Object.keys(
      disk.networks[manifest._network].packages
    ).length} packages, atomic rename verified)`
  )
  print_k8s_values_expectations(disk, manifest._network)
  return disk
}

function cli_value(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

if (process.argv[1] && path.resolve(process.argv[1]) === file_url_to_path(import.meta.url)) {
  try {
    stamp_release({
      manifest_path: cli_value('--manifest', default_manifest),
      target_path: cli_value('--target', default_target),
    })
  } catch (error) {
    console.error(`stamp_all: ${error.message}`)
    process.exitCode = 1
  }
}
