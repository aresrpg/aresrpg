// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mock } from 'bun:test'

const unconfigured_get_sdk = async () => {
  throw new Error('expedition SDK mock was not configured')
}

let get_sdk_implementation = unconfigured_get_sdk

export const set_expedition_sdk_mock = (implementation) => {
  get_sdk_implementation = implementation
}

export const reset_expedition_sdk_mock = () => {
  get_sdk_implementation = unconfigured_get_sdk
}

mock.module('../chain/sdk', () => ({
  get_sdk: (...args) => get_sdk_implementation(...args),
}))
