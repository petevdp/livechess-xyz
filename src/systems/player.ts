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
	vibrate: boolean
}

const defaultSettings: PlayerSettings = {
	name: null,
	muteAudio: false,
	touchOffsetDirection: 'none',
	usingTouch: false,
	dismissMultipleClientsWarning: false,
	vibrate: true,
}

// getters and setters for player settings
//@ts-expect-error
export const settings: { [key in keyof PlayerSettings]: PlayerSettings[key] } = {}

for (const [key, value] of Object.entries(defaultSettings)) {
	const [get, set] = makePersisted(createSignal(value), { name: key, storage: localStorage })
	Object.defineProperty(settings, key, { get, set })
}

const [_playerId, setPlayerId] = makePersisted(createSignal(null as string | null), {
	name: 'playerId:v2',
	storage: localStorage,
})
export const playerId = _playerId

export function setupPlayerSystem() {
	if (!playerId()) setPlayerId(createId(6))
	createEffect(() => {
		const playerName = settings.name
		if (!R.room()?.player || !playerName || playerName === R.room()!.player.name) return
		void R.room()!.setCurrentPlayerName(playerName!)
	})

	if (!settings.usingTouch) {
		// we're doing it this way so we can differentiate users that are actually using their touch screen vs those that are using a mouse but happen to have a touchscreen
		function touchListener() {
			settings.usingTouch = true
			document.removeEventListener('touchstart', touchListener)
		}

		document.addEventListener('touchstart', touchListener)
	}

	H.identify(playerId()!, {
		username: settings.name || '__no_nickname__',
	})
}

// add any settings migration logic here
const previousProperties = ['settings', 'playerId']

for (const property of previousProperties) {
	// if we need to migrate a property, add that logic here
	const previousValue = localStorage.getItem(property)
	if (previousValue) {
		localStorage.removeItem(property)
	}
}
