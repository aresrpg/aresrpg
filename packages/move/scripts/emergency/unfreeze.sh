#!/bin/bash
#
# Emergency Contract Unfreeze
#
# Purpose: Re-enable all contract functions after a freeze, once the
#          incident has been resolved and the fix verified.
# Usage: ./unfreeze.sh <network>
# Networks: testnet, mainnet
#
# This reverses freeze.sh by calling version::admin_update, which migrates
# the Version object from 0 (frozen) back to PACKAGE_VERSION (latest).
#
# IMPORTANT: Only unfreeze after the vulnerability is patched and verified.
#

set -e

NETWORK=${1:-testnet}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔓 EMERGENCY CONTRACT UNFREEZE${NC}"
echo "======================================"
echo "Network: $NETWORK"
echo "Time: $(date)"
echo ""
echo -e "${YELLOW}WARNING: This will RE-ENABLE ALL contract functions.${NC}"
echo "- Character updates will resume"
echo "- Item operations will resume"
echo "- Sales will be enabled"
echo ""
echo "Only proceed if the vulnerability is patched and verified."
echo ""

# Require explicit confirmation
read -p "Type 'UNFREEZE' to confirm: " confirm

if [ "$confirm" != "UNFREEZE" ]; then
  echo -e "${RED}Aborted.${NC}"
  exit 1
fi

echo ""
echo "Unfreezing contract on $NETWORK..."
echo ""

cd "$PROJECT_ROOT"

# Execute unfreeze script
NETWORK=$NETWORK node -r dotenv/config ./scripts/admin_unfreeze.js

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ Contract unfrozen successfully${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Verify operations work (./status.sh $NETWORK)"
  echo "2. Communicate resolution to users"
  echo "3. Document incident closure"
  echo ""
  echo "Unfreeze logged to: security:freezes (Redis)"
else
  echo -e "${RED}❌ Unfreeze failed${NC}"
  exit 1
fi
