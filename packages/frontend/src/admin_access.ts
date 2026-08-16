// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

export const is_admin_address = (address: string | null): boolean => address?.toLowerCase() === DEFAULT_ADMIN_ADDRESS
