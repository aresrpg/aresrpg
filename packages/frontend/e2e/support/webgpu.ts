// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Page } from '@playwright/test'

export const has_webgpu_adapter = (page: Page): Promise<boolean> =>
  page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))
