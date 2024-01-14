import { createEffect, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store'
import { describe, expect, test } from 'vitest'



import { storeToSignal } from './solid.ts';


describe.only('solid utils', () => {
	test.only('storeToSignal', () => {
		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			const [store, setStore] = createStore({ a: 1 })
			const signal = storeToSignal(store)
			expect(signal()).toMatchObject({ a: 1 })
			createEffect(() => {
				expect(signal()).toMatchObject({ a: 1, b: 2 })
			})
			setStore({ b: 2 })
		})
		dispose()
	})
})
