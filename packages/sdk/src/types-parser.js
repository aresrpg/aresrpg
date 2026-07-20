/**
 * @param {string} transaction_digest
 * @param {import("@mysten/sui/grpc").SuiGrpcClient} client
 * */
async function parse_created_objects(transaction_digest, client) {
  // #23 gRPC: core.getTransaction returns a { $kind, Transaction|FailedTransaction } union; created objects are
  // effects.changedObjects filtered on idOperation==='Created' (was jsonRpc getTransactionBlock → effects.created[].reference).
  const result = await client.core.getTransaction({
    digest: transaction_digest,
    include: { effects: true },
  })
  const tx = result.Transaction ?? result.FailedTransaction
  const digest = tx?.digest
  const created_ids = (tx?.effects?.changedObjects ?? [])
    .filter(o => o.idOperation === 'Created')
    .map(o => o.objectId)

  // #23 gRPC: getObjects → { objects:[Object|Error] }; json:true exposes the Publisher's `module_name`. `.type` is
  // present by default. The old jsonRpc `content.fields.module_name` becomes `object.json.module_name`.
  const { objects } = await client.core.getObjects({
    objectIds: created_ids,
    include: { json: true },
  })

  return {
    digest,
    ...Object.fromEntries(
      objects
        .map(data => {
          if (data instanceof Error || !data?.type) return [null, null]
          const { type, objectId, json: content } = data

          if (type.includes('dynamic_field')) return [null, null]

          if (type.startsWith('0x2::transfer_policy::TransferPolicy<')) {
            const [, , , submodule, subtype] = type.split('::')
            const extracted_type = `${submodule}::${subtype}`.slice(0, -1)
            return [`TransferPolicy<${extracted_type}>`, objectId]
          }

          if (type.includes('AresRPG_TransferPolicy')) {
            const [, , , submodule, subtype] = type.split('::')
            const extracted_type = `${submodule}::${subtype}`.slice(0, -1)
            return [`AresRPG TransferPolicy<${extracted_type}>`, objectId]
          }

          if (type === '0x2::package::Publisher') {
            // #23 gRPC json:true flattens the struct — `module_name` is top-level (was `content.fields.module_name`).
            const subtype = /** @type {any} */ (content)?.module_name
            return [`publisher (${subtype})`, objectId]
          }

          if (type.startsWith('0x2::display::Display<')) {
            const [, , , submodule, subtype] = type.split('::')
            const extracted_type = `${submodule}::${subtype}`.slice(0, -1)
            return [`Display<${extracted_type}>`, objectId]
          }

          if (type === 'package') return ['package', objectId]

          const [, module_name, raw_type] = type.split('::')

          return [`${module_name}::${raw_type}`, objectId]
        })
        .filter(([key]) => key !== null),
    ),
  }
}

/** @typedef {ReturnType<typeof parse_result>} SuiIds */

const parse_result = parsed => {
  const result = {
    DISPLAY_CHARACTER: parsed['Display<character::Character>'],
    ADMIN_CAP: parsed['admin::AdminCap'],
    VERSION: parsed['version::Version'],
    ARES_ROOT: parsed['ares_root::AresRoot'],
    PUBLISHER_CHARACTER: parsed['publisher (character)'],
    PUBLISHER_ITEM: parsed['publisher (item)'],
    PACKAGE_ID: parsed.package,
    UPGRADE_CAP: parsed['package::UpgradeCap'],
    DISPLAY_ITEM: parsed['Display<item::Item>'],
    CHARACTER_PROTECTED_POLICY:
      parsed['AresRPG TransferPolicy<character::Character>'],
    ITEM_PROTECTED_POLICY: parsed['AresRPG TransferPolicy<item::Item>'],
    CHARACTER_POLICY: parsed['TransferPolicy<character::Character>'],
    ITEM_POLICY: parsed['TransferPolicy<item::Item>'],
    DUNGEON_REGISTRY: parsed['dungeon_registry::DungeonRegistry'] ?? '', // shared live-instance index (frontend overrides via deployment.ts)
    LATEST_PACKAGE_ID: '',
  }

  Object.entries(result).forEach(([key, value]) => {
    if (!value) delete result[key]
  })

  return result
}

/** @return {Promise<SuiIds>} */
export async function find_types({ digest, package_id = null }, client) {
  const objects = parse_result(await parse_created_objects(digest, client))

  return {
    ...objects,
    PACKAGE_ID: package_id || objects.PACKAGE_ID,
    LATEST_PACKAGE_ID: objects.PACKAGE_ID,
  }
}
