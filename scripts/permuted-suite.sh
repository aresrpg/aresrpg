#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# Optional frontend order probe: one seeded permutation, one shared Bun process, no CI wiring.
set -euo pipefail

cd "$(dirname "$0")/.."

SEED="${1:-${PERMUTED_SEED:-1729}}"
case "$SEED" in
  ''|*[!0-9]*)
    echo "usage: scripts/permuted-suite.sh [non-negative integer seed]" >&2
    exit 2
    ;;
esac

FILES=()
while IFS= read -r file; do
  FILES+=("$file")
done < <(
  git ls-files packages/frontend/src packages/frontend/test |
    LC_ALL=C awk '/\.(test|spec)\.(js|jsx|mjs|ts|tsx)$/' |
    LC_ALL=C sort |
    awk -v seed="$SEED" '
      BEGIN { state = seed % 4294967296 }
      {
        state = (1664525 * state + 1013904223) % 4294967296
        printf "%.0f\t%s\n", state, $0
      }
    ' |
    LC_ALL=C sort -n -k1,1 -k2,2 |
    cut -f2-
)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "PERMUTED FRONTEND SUITE FAILED — no tracked test files found." >&2
  exit 1
fi

echo "PERMUTED FRONTEND SUITE — seed=$SEED files=${#FILES[@]}"
bun test "${FILES[@]}"
