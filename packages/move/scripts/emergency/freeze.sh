#!/bin/bash
#
# Emergency Contract Freeze
#
# Purpose: Disable all contract functions in case of security incident
# Usage: ./freeze.sh <network>
# Networks: testnet, mainnet
#
# IMPORTANT: This is a one-way operation until you run unfreeze.sh
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

echo -e "${RED}🚨 EMERGENCY CONTRACT FREEZE${NC}"
echo "======================================"
echo "Network: $NETWORK"
echo "Time: $(date)"
echo ""
echo -e "${YELLOW}WARNING: This will DISABLE ALL contract functions!${NC}"
echo "- Character updates will fail"
echo "- Item operations will fail"
echo "- Sales will be disabled"
echo "- Only unfreeze can reverse this"
echo ""

# Require explicit confirmation
read -p "Type 'FREEZE' to confirm: " confirm

if [ "$confirm" != "FREEZE" ]; then
  echo -e "${RED}Aborted.${NC}"
  exit 1
fi

echo ""
echo "Freezing contract on $NETWORK..."
echo ""

cd "$PROJECT_ROOT"

# Execute freeze script
NETWORK=$NETWORK node -r dotenv/config ./scripts/admin_freeze.js

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ Contract frozen successfully${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Investigate the security incident"
  echo "2. Fix the vulnerability"
  echo "3. Run unfreeze.sh when safe to resume"
  echo ""
  echo "Freeze logged to: security:freezes (Redis)"
else
  echo -e "${RED}❌ Freeze failed${NC}"
  exit 1
fi
