import { createEffect, createRoot } from 'solid-js'

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
