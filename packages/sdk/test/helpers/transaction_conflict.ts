// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Captured mainnet Core receipt, 2026-11-12: withdrawal checkpoint 344476118 consumed
// gas object 0x0bd61737399c58ff20c3535d643f7f4be067e832a589e8e92085b5277e4b2655 v1068218220.
export const gas = {
  objectId: '0x0bd61737399c58ff20c3535d643f7f4be067e832a589e8e92085b5277e4b2655',
  version: '1068218220',
  digest: 'FPgUezf2pYBbuDxHKhMFjqiuCq1Niu5ujeT7ddYFpsyT',
}
export const conflict_digest = '5KscohNDYEHETAkwR6wwjfxckYGc5re1XQPg9gpvVk9d'
export const captured = {
  Transaction: {
    digest: conflict_digest,
    checkpoint: '344476118',
    effects: {
      transactionDigest: conflict_digest,
      status: { success: true },
      changedObjects: [
        {
          objectId: gas.objectId,
          inputState: 'Exists',
          inputVersion: gas.version,
          inputDigest: gas.digest,
          inputOwner: { AddressOwner: '0x51c1751d2fb53e802c7d89a4907d81327f24dd517a2a4ac8d345fb06a08c120a' },
          outputState: 'ObjectWrite',
          outputVersion: '1068218221',
          outputDigest: '8cuos8KqFw2NNpxnYPqwxTu7KLvprQ6qrGQySz78YTHe',
        },
      ],
    },
  },
}
