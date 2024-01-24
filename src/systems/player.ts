import { makePersisted } from '@solid-primitives/storage'
import { H } from 'highlight.run'
import { createEffect, createSignal } from 'solid-js'

import { createId } from '~/utils/ids.ts'

import * as R from './room.ts'

export type Player = {
	id: string
	name: string
}

export type PlayerSettings = {
	name: string | null
	muteAudio: boolean
	touchOffsetDirection: 'left' | 'right' | 'none'
	usingTouch: boolean
	dismissMultipleClientsWarning: boolean
}

const [_playerId, setPlayerId] = makePersisted(createSignal(null as string | null), {
	name: 'playerId:v2',
	storage: localStorage,
})
export const playerId = _playerId

// we're not using a store and storing them in one property here because we want to independently version these settings
const [name, setName] = makePersisted(createSignal(null as string | null), { name: 'name', storage: localStorage })
const [muteAudio, setMuteAudio] = makePersisted(createSignal(false), { name: 'muteAudio', storage: localStorage })
const [touchOffsetDirection, setTouchOffsetDirection] = makePersisted(createSignal('none' as PlayerSettings['touchOffsetDirection']), {
	name: 'touchOffsetDirection',
	storage: localStorage,
})
const [usingTouch, setUsingTouch] = makePersisted(createSignal(false), { name: 'usingTouch', storage: localStorage })
const [dismissMultipleClientsWarning, setDismissMultipleClientsWarning] = makePersisted(createSignal(false), {
	name: 'dismissMultipleClientsWarning',
	storage: localStorage,
})

// gross getters and setters, sorry
export const settings: PlayerSettings = {
	get name() {
		return name()
	},
	set name(value) {
		setName(value)
	},
	get muteAudio() {
		return muteAudio()
	},
	set muteAudio(value) {
		setMuteAudio(value)
	},
	get touchOffsetDirection() {
		return touchOffsetDirection()
	},
	set touchOffsetDirection(value) {
		setTouchOffsetDirection(value)
	},
	get usingTouch() {
		return usingTouch()
	},
	set usingTouch(value) {
		setUsingTouch(value)
	},
	get dismissMultipleClientsWarning() {
		return dismissMultipleClientsWarning()
	},
	set dismissMultipleClientsWarning(value) {
		setDismissMultipleClientsWarning(value)
	},
}

export function setupPlayerSystem() {
	if (!playerId()) setPlayerId(createId(6))
	createEffect(() => {
		const playerName = settings.name
		if (!R.room()?.player || !playerName || playerName === R.room()!.player.name) return
		R.room()!.setCurrentPlayerName(playerName!)
	})

	if (!settings.usingTouch) {
		// we're doing it this way so we can differentiate users that are actually using their touch screen vs those that are using a mouse but happen to have a touchscreen
		function touchListener() {
			setUsingTouch(true)
			document.removeEventListener('touchstart', touchListener)
		}

		document.addEventListener('touchstart', touchListener)
	}

	H.identify(playerId()!, {
		username: settings.name || '__no_nickname__',
	})
}

const previousProperties = ['settings', 'playerId']

for (const property of previousProperties) {
	// if we need to migrate a property, add that logic here
	const previousValue = localStorage.getItem(property)
	if (previousValue) {
		localStorage.removeItem(property)
	}
}
