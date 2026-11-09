# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# Shared immutable image reuse/alias boundary; builds and attestations stay in release CI.
set -euo pipefail

case "${1:-}" in
  inspect)
    image="${IMAGE_REPOSITORY}:${IMAGE_VERSION}"
    if docker manifest inspect "$image" >/dev/null 2>&1; then
      if [ "${IMAGE_CHANGED}" = true ]; then
        revision=$(docker buildx imagetools inspect "$image" --format '{{json .Image.Config.Labels}}' \
          | jq -r '.["org.opencontainers.image.revision"]')
        [ "$revision" = "$GITHUB_SHA" ] || {
          echo "::error::$image already belongs to source $revision, refusing semver reuse for $GITHUB_SHA"
          exit 1
        }
      else
        expected="${IMAGE_DIGEST}"
        [[ "$expected" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "::error::certified image digest is missing"; exit 1; }
        actual=$(docker buildx imagetools inspect "$image" --format '{{json .Manifest.Digest}}' | tr -d '"')
        [ "$actual" = "$expected" ] || {
          echo "::error::$image does not alias the expected unchanged image digest"
          exit 1
        }
      fi
      digest=$(docker buildx imagetools inspect "$image" --format '{{json .Manifest.Digest}}' | tr -d '"')
      [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "::error::resolved image digest is invalid"; exit 1; }
      echo "exists=true" >> "$GITHUB_OUTPUT"
      echo "digest=$digest" >> "$GITHUB_OUTPUT"
    else
      echo "exists=false" >> "$GITHUB_OUTPUT"
    fi
    ;;
  alias)
    repository="$IMAGE_REPOSITORY"
    expected="${IMAGE_DIGEST}"
    [[ "$expected" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "::error::certified image digest is missing"; exit 1; }
    source="$repository@$expected"
    docker manifest inspect "$source" >/dev/null || { echo "::error::no previous image exists"; exit 1; }
    docker buildx imagetools create --prefer-index=false --tag "$repository:${IMAGE_VERSION}" "$source"
    digest=$(docker buildx imagetools inspect "$repository:${IMAGE_VERSION}" \
      --format '{{json .Manifest.Digest}}' | tr -d '"')
    [ "$digest" = "$expected" ] || { echo "::error::image alias changed the certified manifest digest"; exit 1; }
    echo "digest=$digest" >> "$GITHUB_OUTPUT"
    ;;
  *) echo 'Expected inspect or alias' >&2; exit 1 ;;
esac
