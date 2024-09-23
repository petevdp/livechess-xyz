import { trackStore } from '@solid-primitives/deep'
import { Signal, createRenderEffect, createSignal, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'

import { runWithOwnerOrCreateRoot } from './solid'

export function makePersistedSignal<T>(key: string, defaultValue: T) {
	const storedRaw = localStorage.getItem(key)
	const [get, set] = createSignal(storedRaw === null ? defaultValue : JSON.parse(storedRaw))

	return [
		() => get(),
		(value: T) => {
			if (value === get()) return
			localStorage.setItem(key, JSON.stringify(value))
			set(() => value)
		},
	] as Signal<T>
}

export function makePersistedStore<T extends object>(key: string, defaultValue: T) {
	const storedRaw = localStorage.getItem(key)
	const [state, set] = createStore<T>(storedRaw === null ? defaultValue : JSON.parse(storedRaw))
	runWithOwnerOrCreateRoot(() => {
		createRenderEffect(() => {
			trackStore(state)
			untrack(() => {
				localStorage.setItem(key, JSON.stringify(state))
			})
		})
	})

	return [state, set] as const
}
