import { createStore, produce } from 'solid-js/store'
import { createSignal, onCleanup, onMount } from 'solid-js'
import * as Y from 'yjs'

export type EntityCollection<T> = [string, T][]

export function getEntity<T>(
	collection: EntityCollection<T>,
	id: string
): T | undefined {
	return collection.find(([k, _]) => k === id)?.[1]
}

export function yMapToStore<T>(
	map: Y.Map<T>
): readonly [EntityCollection<T>, (key: string, v: T) => void] {
	const [store, setStore] = createStore([...map.entries()])
	const observer = (e: Y.YMapEvent<T>) => {
		for (const [key, { action }] of e.changes.keys.entries()) {
			if (action === 'add') {
				setStore(store.length, [key, map.get(key)])
			} else if (action === 'delete') {
				setStore((s) => s.filter(([k, _]) => k !== key))
			} else if (action === 'update') {
				setStore(([k, _]) => k === key, map.get(key)!)
			}
		}
	}
	onMount(() => {
		map.observe(observer)
	})
	onCleanup(() => {
		map.unobserve(observer)
	})

	const set = (key: string, value: T) => {
		map.set(key, value)
	}
	return [store, set] as const
}

export function yArrayToStore<T>(array: Y.Array<T>) {
	const [store, setStore] = createStore([...array])
	const observer = (e: Y.YArrayEvent<T>) => {
		setStore(
			produce((store) => {
				for (let d of e.changes.delta) {
					if (d.insert) {
						for (let elt of d.insert) {
							store.push(elt)
						}
					}
				}
			})
		)
	}
	onMount(() => {
		array.observe(observer)
	})
	onCleanup(() => {
		array.unobserve(observer)
	})

	return store
}

export function yMapToSignal<T>(map: Y.Map<T>, key: string, defaultValue: T) {
	const [accessor, setAccessor] = createSignal<T>(map.get(key) || defaultValue)
	const observer = (e: Y.YMapEvent<T>) => {
		if (e.keysChanged.has(key)) {
			setAccessor(() => map.get(key) || defaultValue)
		}
	}
	onMount(() => {
		map.observe(observer)
	})
	onCleanup(() => {
		try {
			map.unobserve(observer)
		} catch (e) {
			console.warn(e)
		}
	})

	// setting the value from here would probably be a bad pattern that makes it hard to track down mutations
	return [accessor] as const
}
