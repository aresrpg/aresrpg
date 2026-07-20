# Emergency Security Scripts

**Purpose**: Fast CLI tools for critical security operations when the internal admin CLI is unavailable.

**Last Updated**: 2025-11-07

---

## Available Scripts

### 1. `freeze.sh` - Emergency Contract Freeze

**When to use**:

- Security vulnerability discovered in production
- Exploit being actively used
- Need to halt all contract operations immediately
- The internal admin CLI is down/inaccessible

**What it does**:

- Calls `version::admin_freeze()` on-chain
- Disables ALL contract functions (character updates, item operations, sales)
- Reversible via `unfreeze.sh`

**Usage**:

```bash
./freeze.sh testnet   # Freeze testnet contract
./freeze.sh mainnet   # Freeze mainnet contract (requires confirmation)
```

**Confirmation**: Type `FREEZE` to confirm

**Output**: Transaction digest, freeze logged to Redis

---

### 2. `unfreeze.sh` - Resume Contract Operations

**When to use**:

- Vulnerability has been patched and verified
- Fix deployed via upgrade (testnet validated first)
- Ready to resume normal operations after a freeze

**What it does**:

- Calls `version::admin_update()` on-chain, migrating the `Version` object
  from `0` (frozen) back to `PACKAGE_VERSION`
- Re-enables ALL contract functions (character updates, item operations, sales)
- Reverses `freeze.sh`

**Usage**:

```bash
./unfreeze.sh testnet   # Unfreeze testnet contract
./unfreeze.sh mainnet   # Unfreeze mainnet contract (requires confirmation)
```

**Confirmation**: Type `UNFREEZE` to confirm

**Output**: Transaction digest, unfreeze logged to Redis

**Note**: `admin_update` asserts `current_version < PACKAGE_VERSION`, so unfreeze
only succeeds while the contract is frozen (version `0`). Increment
`PACKAGE_VERSION` in `version.move` only as part of an upgrade, not to unfreeze.

---

### 3. `status.sh` - Contract Health Check

**When to use**:

- Quick verification of contract state
- Check gas balance before operations
- Verify package deployment

**What it does**:

- Shows active Sui address
- Displays gas balance
- Shows package ID (from types.json)

**Usage**:

```bash
./status.sh testnet   # Check testnet status
./status.sh mainnet   # Check mainnet status
```

---

## Prerequisites

1. **Sui CLI installed**:

   ```bash
   sui --version
   ```

2. **Environment configured**:
   - `.env` file with `PRIVATE_KEY`
   - Correct network in `sui client active-env`

3. **Admin permissions**:
   - Address must own `AdminCap`

---

## Security Considerations

### Freeze Operation

**Impact**:

- ✅ Prevents further damage from exploits
- ✅ Buys time to investigate and patch
- ❌ Disables legitimate user operations
- ❌ Cannot be undone until unfreeze

**Best Practices**:

1. **Investigate first** - Confirm actual security incident
2. **Communicate** - Notify users via Discord/Twitter
3. **Document** - Record incident details, freeze time, reason
4. **Fix** - Patch vulnerability before unfreezing
5. **Verify** - Test fix on testnet first

### Access Control

**Who can run these scripts**:

- ✅ Project owner - Full access
- ❌ AI agents - Should not have direct access to emergency scripts

**Storage**:

- Local machine: `~/dev/aresrpg/aresrpg-move/scripts/emergency/`
- NOT deployed to any backend service (manual execution only)

---

## Workflow Examples

### Example 1: Detected Exploit on Mainnet

```bash
# 1. Verify the issue
./status.sh mainnet

# 2. Freeze contract immediately
./freeze.sh mainnet
# Type: FREEZE

# 3. Investigate issue (outside scripts)
# - Review on-chain transactions
# - Identify vulnerability
# - Develop patch

# 4. Deploy fix to testnet
cd ../..
npm run upgrade:testnet

# 5. Test fix thoroughly
npm run mint_item:testnet  # Verify operations work

# 6. Deploy to mainnet
npm run upgrade:mainnet

# 7. Unfreeze (when ready)
./unfreeze.sh mainnet
# Type: UNFREEZE
```

### Example 2: False Alarm

```bash
# 1. Suspected issue reported
./status.sh mainnet

# 2. Investigation reveals no actual vulnerability
# Do NOT freeze unnecessarily

# 3. Communicate to reporter
# Document false alarm
```

---

## Future Enhancements

**Planned scripts**:

- [ ] `rollback.sh` - Rollback to previous package version
- [ ] `promote-admin.sh` - Emergency admin promotion
- [ ] `verify-signatures.sh` - Validate contract signatures

**Integration with the internal admin CLI**:

- These scripts should remain as CLI fallbacks
- The internal admin CLI will provide a GUI for the same operations
- Both paths access same Redis logs for audit trail

---

## Troubleshooting

### Error: "sui: command not found"

**Solution**: Install Sui CLI

```bash
cargo install --locked --git https://github.com/MystenLabs/sui.git --branch testnet sui
```

### Error: "No gas coins owned"

**Solution**: Fund address from faucet

```bash
# Testnet
sui client faucet

# Mainnet
# Purchase SUI from exchange, transfer to address
```

### Error: "Admin verification failed"

**Solution**: Ensure address owns AdminCap

```bash
sui client objects  # Look for AdminCap in owned objects
```

### Error: "dotenv config not found"

**Solution**: Create `.env` file with PRIVATE_KEY

```bash
cd ../..  # Go to project root
echo "PRIVATE_KEY=suiprivkey1..." > .env
```

---

## Contact

**For emergencies**:

- Discord: contact the maintainers
- GitHub Issues: https://github.com/aresrpg/aresrpg-move/issues

**For non-emergencies**:

- Use the internal admin dashboard (when available)
