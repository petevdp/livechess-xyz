import { Owner, createDeferred, createEffect, createMemo, createSignal, runWithOwner } from 'solid-js'
import { createStore } from 'solid-js/store'

import { makePersistedSignal } from '~/utils/makePersisted'
import { trackAndUnwrap } from '~/utils/solid'

export const [debugVisible, setDebugVisible] = makePersistedSignal('debug', !import.meta.env.PROD)
export const [values, setValue] = createStore({} as Record<string, any>)
export const debugKeys = createMemo(() => Object.keys(trackAndUnwrap(values)))

export function addHook(key: string, cb: () => any, owner: Owner) {
	runWithOwner(owner, () => {
		createDeferred(() => {
			if (!debugVisible()) return
			setValue(key, cb())
		})
	})
}
