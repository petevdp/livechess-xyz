import { makePersisted } from '@solid-primitives/storage'
import { Accessor, createSignal } from 'solid-js'

import { unit } from '~/utils/unit.ts'


export let usingTouch = unit as Accessor<boolean>

export function setupAgentSystem() {
	let setUsingTouch: (value: boolean) => void
	// we're doing it this way so we can differentiate users that are actually using their touch screen vs those that are using a mouse but happen to have a touchscreen
	;[usingTouch, setUsingTouch] = makePersisted(createSignal<boolean>(false), { name: 'usingTouch', storage: localStorage })
	if (usingTouch()) return

	function touchListener() {
		setUsingTouch(true)
		document.removeEventListener('touchstart', touchListener)
	}

	document.addEventListener('touchstart', touchListener)
}
