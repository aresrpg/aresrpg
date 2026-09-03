#!/bin/sh
# Sui-native coverage for every authored Move package. No module is excluded from its package total.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(dirname "$script_dir")
cd "$repo_root"

cover_package() {
  package_path=$1
  floor=$2
  sui move test --path "$package_path" --coverage
  summary=$(sui move coverage summary --path "$package_path")
  printf '%s\n' "$summary"
  coverage=$(printf '%s\n' "$summary" | awk '/\| % Move Coverage:/ { print $5 }')
  if [ -z "$coverage" ]; then
    echo "Move coverage summary was unreadable for $package_path" >&2
    exit 1
  fi
  if ! awk -v actual="$coverage" -v minimum="$floor" 'BEGIN { exit !(actual + 0 >= minimum + 0) }'; then
    echo "Move coverage for $package_path is $coverage%, below $floor%" >&2
    exit 1
  fi
  echo "Move coverage: $package_path $coverage% (floor $floor%)"
}

cover_package packages/control 60
cover_package packages/seed 30
cover_package packages/move-math 30
cover_package packages/move-combat 25
cover_package packages/move 25
