#!/bin/sh
# LLVM source coverage for the Rust indexer. The tool version and aggregate floor are repository law.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(dirname "$script_dir")
tool_version='0.9.0'
line_floor='65'

installed=$(cargo llvm-cov --version 2>/dev/null || true)
if [ "$installed" != "cargo-llvm-cov $tool_version" ]; then
  echo "indexer coverage requires cargo-llvm-cov $tool_version" >&2
  echo "install with: cargo install cargo-llvm-cov --version $tool_version --locked" >&2
  exit 1
fi

run_coverage() {
  cargo llvm-cov \
    --manifest-path "$repo_root/packages/indexer/Cargo.toml" \
    --summary-only \
    --fail-under-lines "$line_floor"
}

if rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
  run_coverage
  exit 0
fi

if command -v brew >/dev/null 2>&1; then
  llvm_prefix=$(brew --prefix llvm 2>/dev/null || true)
  if [ -x "$llvm_prefix/bin/llvm-cov" ] && [ -x "$llvm_prefix/bin/llvm-profdata" ]; then
    LLVM_COV="$llvm_prefix/bin/llvm-cov" LLVM_PROFDATA="$llvm_prefix/bin/llvm-profdata" run_coverage
    exit 0
  fi
fi

echo 'indexer coverage requires rustup component add llvm-tools-preview or a Homebrew LLVM install' >&2
exit 1
