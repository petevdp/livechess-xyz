import { createSignal } from 'solid-js'

const [handles, setHandles] = createSignal(new Set<string>(), { equals: false })
export const HANDLES = ['connect-to-room'] as const
export type Handle = (typeof HANDLES)[number]

export function setLoading(handle: Handle) {
	if (handles().has(handle)) return
	handles().add(handle)
	setHandles(handles)
}

export function unsetLoading(handle: Handle) {
	handles().delete(handle)
	setHandles(handles)
}

export function isLoading() {
	return handles().size > 0
}

export function clear() {
	setHandles(new Set<string>())
}
