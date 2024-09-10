import { captureStoreUpdates, trackStore } from '@solid-primitives/deep'
import deepEquals from 'fast-deep-equal'
import { Accessor, createEffect, createRenderEffect, createRoot, createSignal, untrack } from 'solid-js'
import { SetStoreFunction, createStore, unwrap } from 'solid-js/store'

import { deepClone } from './obj'

// reg until seems to be broken
export function myUntil(fn: () => any) {
	return new Promise((resolve) => {
		createRoot((dispose) => {
			createEffect(() => {
				const result = fn()
				if (result) {
					resolve(result)
					dispose()
				}
			})
		})
	})
}

// for when you pass a store into a function with a lot of property accesses on the store, to avoid the overhead of the store's accessors
export function trackAndUnwrap<T extends object>(store: T) {
	trackStore(store)
	return unwrap(store)
}

type Path = (string | number)[]

function pathAffectsTarget(path: Path, target: Path) {
	if (path.length < target.length) return false
	return deepEquals(target, path.slice(0, target.length))
}

/**
 * Creates a signal that updates when the store updates.
 * This is much more lightweight for read heavy operations as it returns the same plain object. However, tracking will subscribe to ALL store changes
 * @param store
 */
export function storeToSignal<T>(store: any, targetPath: Path): Accessor<T> {
	const delta = captureStoreUpdates(store)
	function getPath(obj: any) {
		let current = obj
		for (const elt of targetPath) {
			current = current[elt]
		}
		return current
	}
	let state = deepClone(unwrap(getPath(delta()[0].value)))
	const [signal, setSignal] = createSignal(state as T, { equals: false })
	let init = false
	createEffect(() => {
		const _delta = delta()
		if (!init) {
			init = true
			return
		}
		untrack(() => {
			for (const { path, value } of _delta) {
				if (!pathAffectsTarget(path, targetPath)) return
				let current = state
				const last = path[path.length - 1]
				if (path.length === 0) {
					state = deepClone(value)
					setSignal(getPath(state))
					return
				}

				for (const key of path.slice(0, -1)) {
					current = current[key]
				}
				current[last] = typeof value === 'object' ? deepClone(value) : value
				setSignal(getPath(state))
			}
		})
	})
	return signal
}

export function createSignalProperty<T>(value: T) {
	const [get, set] = createSignal(value)

	return { get, set }
}
export type SignalProperty<T> = ReturnType<typeof createSignalProperty<T>>

export function createStoreProperty<T extends object>(value: T) {
	const [state, set] = createStore(value)
	return { state, set }
}

export type StoreProperty<T extends object> = ReturnType<typeof createStoreProperty<T>>

let t: StoreProperty<{ a: number }>
t = createStoreProperty({ a: 1 })
t = createStoreProperty({ a: 2 })
