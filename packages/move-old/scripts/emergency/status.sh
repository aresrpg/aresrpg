#!/bin/bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# Contract Status Check
#
# Purpose: Quick health check of deployed contract
# Usage: ./status.sh <network>
# Networks: testnet, mainnet
#

set -e

NETWORK=${1:-testnet}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_JSON="$SCRIPT_DIR/../../../sdk/src/deployment/release.json"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}📊 AresRPG Contract Status${NC}"
echo "======================================"
echo "Network: $NETWORK"
echo "Time: $(date)"
echo ""

# Switch to network
sui client switch --env $NETWORK > /dev/null 2>&1

# Get active address
ACTIVE_ADDR=$(sui client active-address 2>/dev/null)
echo "Active address: $ACTIVE_ADDR"

# Get gas balance
echo ""
echo "Gas balance:"
sui client gas 2>/dev/null | head -5

# Check if contract objects exist
echo ""
echo "Checking contract objects..."

# Read the only checked-in deployment config.
if [ -f "$RELEASE_JSON" ]; then
  PACKAGE_ID=$(jq -r --arg network "$NETWORK" '.networks[$network].packages.aresrpg.latest // empty' "$RELEASE_JSON")
  echo "Package ID: ${PACKAGE_ID:-unknown}"
else
  echo -e "${YELLOW}⚠️  release.json not found${NC}"
fi

echo ""
echo -e "${GREEN}✅ Status check complete${NC}"
