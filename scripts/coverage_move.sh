#!/bin/sh
# Sui-native coverage for every authored Move package. No module is excluded from its package total.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(dirname "$script_dir")
cd "$repo_root"

assert_floor() {
  label=$1
  actual=$2
  minimum=$3
  if [ -z "$actual" ]; then
    echo "Move coverage summary has no $label result" >&2
    exit 1
  fi
  if ! awk -v actual="$actual" -v minimum="$minimum" 'BEGIN { exit !(actual + 0 >= minimum + 0) }'; then
    echo "Move coverage for $label is $actual%, below $minimum%" >&2
    exit 1
  fi
  echo "Move coverage: $label $actual% (floor $minimum%)"
}

cover_package() {
  package_path=$1
  floor=$2
  shift 2
  sui move test --path "$package_path" --coverage
  summary=$(sui move coverage summary --path "$package_path")
  printf '%s\n' "$summary"
  coverage=$(printf '%s\n' "$summary" | awk '/\| % Move Coverage:/ { print $5 }')
  assert_floor "$package_path" "$coverage" "$floor"

  for requirement in "$@"; do
    module=${requirement%%:*}
    module_floor=${requirement#*:}
    module_coverage=$(printf '%s\n' "$summary" | awk -v wanted="::$module" '$0 ~ wanted "$" { getline; print $5 }')
    assert_floor "$package_path::$module" "$module_coverage" "$module_floor"
  done
}

cover_package packages/control 98.01
cover_package packages/kares 100 kares:100 offering:100 combat_rewards:100 staking:100
cover_package packages/seed 98.01 \
  registry:98.01 board_catalog:98.01 dungeon_content:98.01 item_rows:98.01 \
  mob_rows:98.01 recipe_rows:98.01 spell_rows:98.01 world_content:98.01
cover_package packages/move-math 99.44 \
  aresrpg:100 characteristic_costs:98.01 prng:98.01 job_xp:98.01 dungeon_data:98.01 \
  item_damages:100 consumable_effect:100 experience:100 loot_table:100 \
  item_stats:100 trade_state:100 world_map:100 recipe_data:100 craft_batch:98.51 \
  mob_scaling:100 spell_effect:98.96 combat_grid:98.88 \
  content_rules:99.44 city_map:100 fight_math:100 rune_catalog:100 forge:100 \
  mob_data:100 weapon:100 zone_math:99.32
# Identical input states must consume equal VM gas for every seeded forging outcome.
forge_work=$(sui move test --path packages/move-math fixed_work_seed_ --statistics csv)
printf '%s\n' "$forge_work"
printf '%s\n' "$forge_work" | awk -F, '
  /^aresrpg_math::forge_rules_tests::fixed_work_seed_[0-9]+,/ {
    if (count > 0 && $3 != gas) { print "Forging VM work depends on the random seed"; exit 1 }
    gas = $3
    count++
  }
  END { if (count != 8) { print "Missing forging VM work probes"; exit 1 } }
'
# Check the potentially nonterminating cases under a finite budget before broad coverage.
sui move test --path packages/move-combat mob_work_bounds_tests --gas-limit 200000000
cover_package packages/move-combat 98.07 combat:98.07
cover_package packages/move 99.23 forgemagie:99.56 zone:98.01 trade:98.75 fight_rewards:100 loot_box:98.01 gathering:98.01 item:98.59 dungeon:99.47 kolizeum:99.68 \
  protected_policy:100 character:98.94 progression:100 friends:100 party:98.72 \
  equipment:98.58 pet:100 crafting:100 world:100 version:100 \
  listing_rule:100 lot_rule:100 naked_rule:100 consumable:99.13 fight:98.37 distribution:100 mastery:100 api:99.40
