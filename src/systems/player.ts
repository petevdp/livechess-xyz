import { makePersisted } from '@solid-primitives/storage'
import { createEffect, createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'

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
}

const [_playerId, setPlayerId] = makePersisted(createSignal(null as string | null), {
	name: 'playerId:v2',
	storage: localStorage,
})
export const playerId = _playerId
export const [settings, setSettings] = makePersisted(
	createStore<PlayerSettings>({
		name: null,
		muteAudio: false,
		touchOffsetDirection: 'none',
		usingTouch: false,
	}),
	{ name: 'settings', storage: localStorage }
)

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
			setSettings('usingTouch', true)
			document.removeEventListener('touchstart', touchListener)
		}

		document.addEventListener('touchstart', touchListener)
	}
}
