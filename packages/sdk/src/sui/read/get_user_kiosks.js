import { Transaction } from '@mysten/sui/transactions'

import { aresrpg_id } from '../../deployment/aresrpg.js'

function borrow_kiosk_cap({
  personal_kiosk_package_id,
  tx,
  personal_kiosk_cap_id,
}) {
  const [kiosk_cap, promise] = tx.moveCall({
    target: `${personal_kiosk_package_id}::personal_kiosk::borrow_val`,
    arguments: [personal_kiosk_cap_id],
  })

  return {
    kiosk_cap,
    resolve_promise() {
      tx.moveCall({
        target: `${personal_kiosk_package_id}::personal_kiosk::return_val`,
        arguments: [personal_kiosk_cap_id, kiosk_cap, promise],
      })
    },
  }
}

/**
 * Returns all users kiosks and their kiosk caps, (borrow personal ones if needed)
 * @param {import("../../../types.js").Context} context */
export function get_user_kiosks(context) {
  const { kiosk_client, network } = context
  return async ({ tx = new Transaction(), address }) => {
    const { kioskOwnerCaps } = await kiosk_client.getOwnedKiosks({
      address,
      // take 25 first kiosks, more than that is not a normal user behavior
      // and will be handled later eventually
      pagination: { limit: 25 },
    })

    const finalizations = []
    const kiosks = new Map(
      kioskOwnerCaps.map(({ isPersonal, kioskId, objectId }) => {
        const get_kiosk_cap = () => {
          if (isPersonal) {
            const personal_kiosk_package_id =
              context.ids?.aresrpg?.KIOSK_ROYALTY_RULE_PACKAGE_ID ??
              aresrpg_id(network, 'KIOSK_ROYALTY_RULE_PACKAGE_ID')
            if (!personal_kiosk_package_id)
              throw new Error(
                `[get_user_kiosks] kiosk linkage package is not stamped for "${network}"`,
              )
            const { kiosk_cap, resolve_promise } = borrow_kiosk_cap({
              personal_kiosk_package_id,
              tx,
              personal_kiosk_cap_id: tx.object(objectId),
            })
            finalizations.push(resolve_promise)
            return kiosk_cap
          }
          return tx.object(objectId)
        }

        return [kioskId, get_kiosk_cap]
      }),
    )
    const kiosk_cap_ref = new Map()

    function get_kiosk_cap_ref(kiosk_id) {
      if (!kiosk_cap_ref.has(kiosk_id)) {
        kiosk_cap_ref.set(kiosk_id, kiosks.get(kiosk_id)())
      }
      return kiosk_cap_ref.get(kiosk_id)
    }

    return {
      tx,
      get_kiosk_cap_ref,
      kiosks,
      finalize() {
        finalizations.forEach(finalize => finalize())
      },
    }
  }
}
