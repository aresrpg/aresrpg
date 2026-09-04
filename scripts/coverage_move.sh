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
cover_package packages/seed 30
cover_package packages/move-math 30 characteristic_costs:98.01 prng:98.01
cover_package packages/move-combat 25
cover_package packages/move 25 zone:98.01
