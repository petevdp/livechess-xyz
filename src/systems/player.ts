import { createEffect } from 'solid-js'

import { createId } from '~/utils/ids.ts'
import { makePersisted } from '~/utils/makePersisted.ts'

import * as R from './room.ts'

export type Player = {
	id: string
	name: string
	ai?: {
		type: 'random'
		difficulty: number
	}
}

export type PlayerSettings = {
	name: string | null
	muteAudio: boolean
	touchOffsetDirection: 'left' | 'right' | 'none'
	usingTouch: boolean
	dismissMultipleClientsWarning: boolean
	vibrate: boolean
	showAvailablemoves: boolean
}

const defaultSettings: PlayerSettings = {
	name: null,
	muteAudio: false,
	touchOffsetDirection: 'none',
	usingTouch: false,
	dismissMultipleClientsWarning: false,
	vibrate: true,
	showAvailablemoves: true,
}

// getters and setters for player settings
//@ts-expect-error
export const settings: { [key in keyof PlayerSettings]: PlayerSettings[key] } = {}

for (const [key, value] of Object.entries(defaultSettings)) {
	const [get, set] = makePersisted(key, value)
	Object.defineProperty(settings, key, { get, set })
}

const [_playerId, setPlayerId] = makePersisted('playerId:v2', null as string | null)
export const playerId = _playerId

let setup = false
export function ensurePlayerSystemSetup() {
	if (setup) return
	setup = true
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
}
