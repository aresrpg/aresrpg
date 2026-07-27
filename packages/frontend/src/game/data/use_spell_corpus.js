// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// React binding for the runtime spell-corpus cache. The array reference is the immutable snapshot.

import { useSyncExternalStore } from 'react'

import { get_spell_corpus, subscribe_spell_corpus } from './spell_corpus.js'

export const use_spell_corpus = () =>
  useSyncExternalStore(subscribe_spell_corpus, get_spell_corpus, get_spell_corpus)
