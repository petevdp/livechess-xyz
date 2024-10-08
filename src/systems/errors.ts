import { createStore } from 'solid-js/store'

export type FatalError = {
	title: string
	message: string
}

const [_fatalErrors, setFatalErrors] = createStore([] as FatalError[])

export const fatalError = () => (_fatalErrors.length > 0 ? _fatalErrors[0] : null)

export function pushFatalError(title: string, message: string, shouldThrow: boolean = false) {
	setFatalErrors(_fatalErrors.length, { title, message })
	if (shouldThrow) throw new Error(title)
}

export function shiftFatalError() {
	const error = fatalError()
	setFatalErrors(_fatalErrors.slice(1))
	return error
}
