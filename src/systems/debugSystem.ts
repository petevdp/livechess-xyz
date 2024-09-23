import { Accessor, Owner, Setter, createDeferred, createEffect, createMemo, createRoot, runWithOwner } from 'solid-js'
import { SetStoreFunction, createStore } from 'solid-js/store'

import { makePersistedSignal } from '~/utils/makePersisted'
import { trackAndUnwrap } from '~/utils/solid'

export let debugVisible!: Accessor<boolean>
export let setDebugVisible!: Setter<boolean>
export let values!: Record<string, any>
export let setValue!: SetStoreFunction<Record<string, any>>
export let debugKeys!: Accessor<string[]>

export function setupDebugSystem() {
	if (import.meta.env.PROD) return
	;[debugVisible, setDebugVisible] = makePersistedSignal('debug', !import.meta.env.PROD)
	;[values, setValue] = createStore({} as Record<string, any>)
	createRoot(() => {
		debugKeys = createMemo(() => Object.keys(trackAndUnwrap(values)))
		createEffect(() => {
			console.log('debugKeys', debugKeys())
		})
	})
}

export function addHook(key: string, cb: () => any, owner: Owner) {
	if (import.meta.env.PROD) return
	runWithOwner(owner, () => {
		createDeferred(() => {
			if (!debugVisible()) return
			setValue(key, cb())
		})
	})
}
