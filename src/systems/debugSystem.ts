import { createMemo, createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'

import { makePersistedSignal } from '~/utils/makePersisted'
import { trackAndUnwrap } from '~/utils/solid'

export const [debugVisible, setDebugVisible] = makePersistedSignal('debug', false)
export const [values, setValue] = createStore({} as Record<string, any>)
export const debugKeys = createMemo(() => Object.keys(trackAndUnwrap(values)))
