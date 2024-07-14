import { Signal, createSignal } from 'solid-js'

export function makePersisted<T>(key: string, defaultValue: T) {
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
