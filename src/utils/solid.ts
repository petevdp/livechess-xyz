import { createEffect, createRoot } from 'solid-js'
import { trackStore } from '@solid-primitives/deep'
import { unwrap } from 'solid-js/store'

// reg until seems to be broken
export function myUntil(fn: () => {}) {
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
