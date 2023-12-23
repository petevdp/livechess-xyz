import { Accessor, createEffect, createRoot } from 'solid-js'

export function useLocalStorage<T>(
	key: string,
	value: Accessor<T>,
	setValue: (v: T) => void
): void {
	let stored = JSON.parse(localStorage.getItem(key) || 'null') as T
	if (stored !== null) {
		setValue(stored)
	}

	createRoot(() => {
		createEffect(() => {
			localStorage.setItem(key, JSON.stringify(value()))
		})
	})
}
