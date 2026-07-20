#!/bin/sh
# Container entrypoint: render the config from env (keeps the sponsor secret out
# of the image), then hand off to the gas station. GAS_STATION_AUTH is read from
# the environment by the station itself.
set -e

if [ -z "$GAS_STATION_AUTH" ]; then
  echo "GAS_STATION_AUTH missing." >&2
  echo "Refusing to start an unauthenticated sponsor RPC on :9527." >&2
  echo "Set a bearer token clients must present, e.g.:" >&2
  echo "  export GAS_STATION_AUTH=\$(openssl rand -hex 32)" >&2
  echo "then re-run." >&2
  exit 1
fi

bun run generate-config.mjs
exec sui-gas-station --config-path ./config.local.yaml
