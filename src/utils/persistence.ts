import { createEffect, createRoot, createSignal } from 'solid-js'

export function useLocalStorage<T>(key: string, defaultValue: T) {
	const getItem = () =>
		localStorage.getItem(key)
			? (JSON.parse(localStorage.getItem(key) as string) as T)
			: defaultValue
	const [value, setValue] = createSignal<T>(getItem())
	createRoot(() => {
		createEffect(() => {
			localStorage.setItem(key, JSON.stringify(value()))
		})
	})
	return [value, setValue] as const
}
