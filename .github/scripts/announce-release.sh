#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
set -euo pipefail

if [[ -z "${DISCORD_WEBHOOK:-}" ]]; then
  echo "no webhook secret — skipping announce"
  exit 0
fi

: "${TAG:?TAG is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

url="https://github.com/${GITHUB_REPOSITORY}/releases/tag/${TAG}"
notes_file=$(find changelog -maxdepth 1 -type f -name '*-RELEASE-*.md' | sort | tail -1)
if [[ -n "$notes_file" ]]; then
  body=$(<"$notes_file")
else
  body="AresRPG ${TAG} is live."
fi
source_length=${#body}

body=$(printf '%s\n' "$body" | awk 'NR==1 && /^# /{s=1;next} s{s=0;if($0=="")next} {print}')
inner="  ${TAG}  "
bar=$(printf '═%.0s' $(seq 1 ${#inner}))
box='```'$'\n'"╔${bar}╗"$'\n'"║${inner}║"$'\n'"╚${bar}╝"$'\n''```'
body="${box}"$'\n'"$body"

footer=$'\n\n'"Full notes → ${url}"
budget=$((2000 - ${#footer}))
if [[ ${#body} -gt $budget ]]; then
  cut=$(printf '%s' "$body" | head -c "$budget")
  paragraph="${cut%$'\n\n'*}"
  if [[ ${#paragraph} -ge $((${#cut} * 75 / 100)) ]]; then
    body="$paragraph"
  else
    body="${cut%$'\n'*}"
  fi
fi

if [[ $source_length -ge 400 && ${#body} -lt 400 ]]; then
  echo "release body collapsed (${#body} chars) — refusing to post a stub" >&2
  exit 1
fi

payload="${RUNNER_TEMP:-/tmp}/discord_payload.json"
jq -n --arg content "${body}${footer}" '{content: $content, flags: 4}' > "$payload"
curl -sf \
  -F "payload_json=<${payload};type=application/json" \
  -F "files[0]=@.github/assets/discord_banner.png;type=image/png" \
  "$DISCORD_WEBHOOK" \
  || echo "webhook POST failed (non-blocking — production is already live)"
