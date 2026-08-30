#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
set -euo pipefail

: "${DISCORD_WEBHOOK:?DISCORD_WEBHOOK is required}"
: "${TAG:?TAG is required}"
: "${ANNOUNCEMENT:?ANNOUNCEMENT is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

url="https://github.com/${GITHUB_REPOSITORY}/releases/tag/${TAG}"
inner="  ${TAG}  "
bar=$(printf '═%.0s' $(seq 1 ${#inner}))
box='```'$'\n'"╔${bar}╗"$'\n'"║${inner}║"$'\n'"╚${bar}╝"$'\n''```'
footer=$'\n\n'"Release → ${url}"
budget=$((2000 - ${#box} - ${#footer} - 1))
body="$ANNOUNCEMENT"
if [[ ${#body} -gt $budget ]]; then
  body=$(printf '%s' "$body" | head -c "$budget")
  body="${body%$'\n'*}"
fi

payload="${RUNNER_TEMP:-/tmp}/discord_payload.json"
jq -n --arg content "${box}"$'\n'"${body}${footer}" '{content: $content, flags: 4}' > "$payload"
curl --fail --silent --show-error \
  -F "payload_json=<${payload};type=application/json" \
  -F "files[0]=@.github/assets/discord_banner.png;type=image/png" \
  "$DISCORD_WEBHOOK"
