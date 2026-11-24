# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# Release CI supplies exact source, build receipts and the selected network pins.
set -euo pipefail

mkdir -p "$RUNNER_TEMP/production-release"
jq -e --arg network "$SUI_NETWORK" '
  select(.network == $network) as $pins |
  [
    $pins.math_package_original, $pins.math_package,
    $pins.control_package_original, $pins.control_package,
    $pins.combat_package_original, $pins.combat_package,
    $pins.seed_package_original, $pins.seed_package,
    $pins.package_original, $pins.package
  ] | all(type == "string" and test("^0x[0-9a-fA-F]+$"))
' pins.json >/dev/null || { echo "::error::release requires complete five-package pins"; exit 1; }
jq --arg network "$SUI_NETWORK" 'select(.network == $network)' pins.json > "$RUNNER_TEMP/network-pins.json"
jq -n \
  --arg version "$VERSION" \
  --arg network "$SUI_NETWORK" \
  --arg source_sha "$GITHUB_SHA" \
  --arg previous_tag "$PREVIOUS_TAG" \
  --arg vercel_url "$VERCEL_URL" \
  --arg bot_version "$VERSION" \
  --arg bot_digest "$BOT_DIGEST" \
  --argjson bot_built "$BOT_BUILT" \
  --arg discord_version "$VERSION" \
  --arg discord_digest "$DISCORD_DIGEST" \
  --argjson discord_built "$DISCORD_BUILT" \
  --arg server_version "$VERSION" \
  --arg server_digest "$SERVER_DIGEST" \
  --arg indexer_version "$VERSION" \
  --arg indexer_digest "$INDEXER_DIGEST" \
  --arg game_original "$(jq -r .package_original "$RUNNER_TEMP/network-pins.json")" \
  --arg game_latest "$(jq -r .package "$RUNNER_TEMP/network-pins.json")" \
  --arg math_original "$(jq -r .math_package_original "$RUNNER_TEMP/network-pins.json")" \
  --arg math_latest "$(jq -r .math_package "$RUNNER_TEMP/network-pins.json")" \
  --arg control_original "$(jq -r .control_package_original "$RUNNER_TEMP/network-pins.json")" \
  --arg control_latest "$(jq -r .control_package "$RUNNER_TEMP/network-pins.json")" \
  --arg combat_original "$(jq -r .combat_package_original "$RUNNER_TEMP/network-pins.json")" \
  --arg combat_latest "$(jq -r .combat_package "$RUNNER_TEMP/network-pins.json")" \
  --arg seed_original "$(jq -r .seed_package_original "$RUNNER_TEMP/network-pins.json")" \
  --arg seed_latest "$(jq -r .seed_package "$RUNNER_TEMP/network-pins.json")" \
  --argjson server_built "$SERVER_BUILT" \
  --argjson frontend_built "$FRONTEND_BUILT" \
  --argjson indexer_built "$INDEXER_BUILT" \
  '{
    schema: 2,
    status: "prepared",
    version: $version,
    source_sha: $source_sha,
    previous_tag: $previous_tag,
    network: $network,
    vercel: {staged_url: $vercel_url, built: $frontend_built},
    packages: {
      math: {original: $math_original, latest: $math_latest},
      control: {original: $control_original, latest: $control_latest},
      combat: {original: $combat_original, latest: $combat_latest},
      game: {original: $game_original, latest: $game_latest},
      seed: {original: $seed_original, latest: $seed_latest}
    },
    images: {
      bot: {repository: "ghcr.io/aresrpg/bot", version: $bot_version, digest: $bot_digest, built: $bot_built},
      discord: {repository: "ghcr.io/aresrpg/discord", version: $discord_version, digest: $discord_digest, built: $discord_built},
      server: {repository: "ghcr.io/aresrpg/server", version: $server_version, digest: $server_digest, built: $server_built},
      indexer: {repository: "ghcr.io/aresrpg/indexer", version: $indexer_version, digest: $indexer_digest, built: $indexer_built}
    }
  }' > "$RUNNER_TEMP/production-release/release-manifest.json"
jq -e --arg version "$VERSION" '
  .images | [.bot, .server, .indexer, .discord] | all(
    .version == $version and (.built | type == "boolean") and
    (.digest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
  )
' "$RUNNER_TEMP/production-release/release-manifest.json" >/dev/null || {
  echo '::error::release requires four certified image identities'; exit 1;
}
cat "$RUNNER_TEMP/production-release/release-manifest.json" >> "$GITHUB_STEP_SUMMARY"
