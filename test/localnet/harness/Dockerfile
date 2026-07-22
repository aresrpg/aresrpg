# Sui localnet pinned to 1.75.1 (matches the host CLI framework the Move packages compile against).
# Linux binary from the official release; runs `sui start --with-faucet` (RPC :9000, faucet :9123).
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG SUI_TAG=testnet-v1.75.1
ARG SUI_ARCH=aarch64
RUN curl -fsSL -o /tmp/sui.tgz \
      https://github.com/MystenLabs/sui/releases/download/${SUI_TAG}/sui-${SUI_TAG}-ubuntu-${SUI_ARCH}.tgz \
 && tar -xzf /tmp/sui.tgz -C /usr/local/bin \
 && rm /tmp/sui.tgz && chmod +x /usr/local/bin/sui*
EXPOSE 9000 9123
# `sui start --with-faucet --force-regenesis` has a ~50% startup race where the faucet outruns genesis funding
# ("No address found with sufficient coins") and the process exits 1. The retry loop re-regenesises until one
# boot sticks, so the container never dies on that flake. RPC binds 0.0.0.0 (Docker port-mapping reachable).
CMD ["sh","-c","while true; do sui start --with-faucet=0.0.0.0:9123 --force-regenesis --fullnode-rpc-port 9000; echo 'sui start exited — regenesis retry'; sleep 1; done"]
