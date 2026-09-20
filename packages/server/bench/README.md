# Local server benchmarks

Opt-in workloads for production player modules, WebSockets, graph queries and Redis buses.
They use synthetic identities and uniquely named scratch graphs, deleted after each run.
Use a dedicated disposable local FalkorDB; authentication and chain ingestion are outside this harness.
The server image excludes this directory through the root `.dockerignore` allowlist.

```sh
# Disposable database. Stop it after testing.
docker run --rm --name ares-capacity-test --cpus 2 --memory 1g -p 127.0.0.1:16381:6379 falkordb/falkordb:latest

# URL, processes, accounts/process, characters/account, seconds, login spacing ms, chat mode.
bun packages/server/bench/capacity.ts redis://127.0.0.1:16381 1 200 6 30 10 spread

# Keep client load generation in separate, smaller processes.
CAPACITY_CLIENTS_PER_DRIVER=50 bun packages/server/bench/capacity.ts redis://127.0.0.1:16381 5 200 1 30 10 off

# Selected-type listing cardinality and actual query plan.
bun packages/server/bench/market.ts redis://127.0.0.1:16381 10000

docker stop ares-capacity-test
```

Chat modes: `spread`, `burst`, or `off`. Movement uses the shared protocol cadence.
Reports distinguish accounts, characters, samples, frames, bytes, graph reads, CPU and event-loop delay.
Save machine-specific results and operational notes outside the checkout, for example in a directory created with `mktemp -d`.
