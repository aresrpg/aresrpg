#!/bin/sh
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: verify-sui-artifact.sh <resolved-arch> <arch:sha256-row> [artifact]" >&2
  exit 64
fi

resolved_arch=$1
digest_row=$2
case "$digest_row" in
  *:*) ;;
  *)
    echo "[sui-artifact] malformed digest row: expected arch:sha256" >&2
    exit 64
    ;;
esac

row_arch=${digest_row%%:*}
row_sha256=${digest_row#*:}
case "$row_arch" in
  x86_64 | aarch64) ;;
  *)
    echo "[sui-artifact] unsupported digest-row architecture: $row_arch" >&2
    exit 64
    ;;
esac
case "$row_sha256" in
  *[!0-9a-f]* | '')
    echo "[sui-artifact] malformed SHA-256 for $row_arch" >&2
    exit 64
    ;;
esac
if [ "${#row_sha256}" -ne 64 ]; then
  echo "[sui-artifact] malformed SHA-256 length for $row_arch" >&2
  exit 64
fi

if [ "$resolved_arch" != "$row_arch" ]; then
  echo "[sui-artifact] architecture mismatch: resolved $resolved_arch but selected digest row $row_arch" >&2
  echo "[sui-artifact] refusing before fetch, extraction, or binary execution" >&2
  exit 65
fi

# With no artifact, this is the pre-fetch architecture/row assertion.
if [ "$#" -eq 2 ]; then
  exit 0
fi

artifact=$3
if ! printf '%s  %s\n' "$row_sha256" "$artifact" | sha256sum -c -; then
  echo "[sui-artifact] SHA-256 mismatch for $resolved_arch; refusing extraction and binary execution" >&2
  exit 66
fi
