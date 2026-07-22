import { trackStore } from '@solid-primitives/deep'
import { Signal, createRenderEffect, createSignal, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'

import { runWithOwnerOrCreateRoot } from './solid'

// a value we can't parse would otherwise throw at module scope and take down every page that
// imports the calling module, with no way back short of clearing storage by hand. drop it instead.
function readPersisted<T>(key: string, defaultValue: T): T {
	const storedRaw = localStorage.getItem(key)
	if (storedRaw === null) return defaultValue
	try {
		return JSON.parse(storedRaw)
	} catch {
		console.warn(`discarding unparseable persisted value for "${key}":`, storedRaw)
		localStorage.removeItem(key)
		return defaultValue
	}
}

export function makePersistedSignal<T>(key: string, defaultValue: T) {
	const [get, set] = createSignal<T>(readPersisted(key, defaultValue))

	return [
		() => get(),
		// we advertise solid's Signal<T> setter via the cast below, so the updater form has to work
		// too -- passing a callback here used to persist JSON.stringify(fn), i.e. `undefined`.
		(value: T | ((prev: T) => T)) => {
			const prev = untrack(get)
			const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value
			if (next === prev) return
			localStorage.setItem(key, JSON.stringify(next))
			set(() => next)
		},
	] as Signal<T>
}

export function makePersistedStore<T extends object>(key: string, defaultValue: T) {
	const [state, set] = createStore<T>(readPersisted(key, defaultValue))
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
