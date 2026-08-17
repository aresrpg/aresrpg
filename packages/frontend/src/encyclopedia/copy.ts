// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'

export type EncyclopediaText = CopyText

export const encyclopedia_text = (copy: AppCopy): EncyclopediaText => copy_text(copy.encyclopedia_page)
