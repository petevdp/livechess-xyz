import { Signal, createSignal } from 'solid-js'

export function makePersisted<T>(key: string, defaultValue: T) {
	const storedRaw = localStorage.getItem(key)
	const stored = (storedRaw ? JSON.parse(storedRaw) : null) as T | null
	const [get, set] = createSignal(stored === null ? defaultValue : stored)

	return [
		() => get(),
		(value: T) => {
			if (value === get()) return
			localStorage.setItem(key, JSON.stringify(value))
			set(() => value)
		},
	] as Signal<T>
}
