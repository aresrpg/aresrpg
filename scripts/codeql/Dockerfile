# Upstream CodeQL ships no linux-arm64 binary, so this image is intentionally amd64-only.
FROM --platform=linux/amd64 debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

# TODO(rust leg): Install cargo plus the CodeQL Rust extractor to enable Rust analysis.
# Their image-size cost is intentionally left to the lead; do not add them yet.

ENV PATH="/opt/codeql:${PATH}"

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl jq nodejs; \
    bundle_url="https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.26.1/codeql-bundle-linux64.tar.gz"; \
    curl -fsSL "$bundle_url" -o /tmp/codeql-bundle-linux64.tar.gz; \
    curl -fsSL "$bundle_url.checksum.txt" -o /tmp/codeql-bundle-linux64.tar.gz.checksum.txt; \
    cd /tmp; \
    sha256sum -c codeql-bundle-linux64.tar.gz.checksum.txt; \
    tar -xzf codeql-bundle-linux64.tar.gz -C /opt; \
    test "$(codeql version --format=json | jq -r .version)" = "2.26.1"; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/* /tmp/codeql-bundle-linux64.tar.gz*

WORKDIR /workspace
