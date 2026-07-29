# Sui localnet pinned to 1.76.0 (matches the host CLI framework the Move packages compile against).
# Linux binary from the official release; runs `sui start --with-faucet` (RPC :9000, faucet :9123).
# Pinned by digest (tag: ubuntu:24.04, resolved from Docker Official Image repo-info on 2026-07-29).
FROM ubuntu:24.04@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG SUI_TAG=testnet-v1.76.0
ARG TARGETARCH
ARG SUI_SHA256_X86_64=4a34ef21e56650772064f946919d262d9e22102034007dccec3cc3418b93505d
ARG SUI_SHA256_AARCH64=b6d2191eff4985051ae59c53f9857f84c80467acfb19bcbfafc2c4be058e9ce4
RUN case "${TARGETARCH}" in \
      amd64) SUI_ARCH=x86_64; SUI_SHA256="${SUI_SHA256_X86_64}" ;; \
      arm64) SUI_ARCH=aarch64; SUI_SHA256="${SUI_SHA256_AARCH64}" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/sui.tgz \
      https://github.com/MystenLabs/sui/releases/download/${SUI_TAG}/sui-${SUI_TAG}-ubuntu-${SUI_ARCH}.tgz \
 && echo "${SUI_SHA256}  /tmp/sui.tgz" | sha256sum -c - \
 && tar -xzf /tmp/sui.tgz -C /usr/local/bin \
 && rm /tmp/sui.tgz && chmod +x /usr/local/bin/sui*
EXPOSE 9000 9123
# `sui start --with-faucet --force-regenesis` has a ~50% startup race where the faucet outruns genesis funding
# ("No address found with sufficient coins") and the process exits 1. The retry loop re-regenesises until one
# boot sticks, so the container never dies on that flake. RPC binds 0.0.0.0 (Docker port-mapping reachable).
CMD ["sh","-c","while true; do sui start --with-faucet=0.0.0.0:9123 --force-regenesis --fullnode-rpc-port 9000; echo 'sui start exited — regenesis retry'; sleep 1; done"]
