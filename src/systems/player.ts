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
}

const [_playerId, setPlayerId] = makePersisted(createSignal(null as string | null), {
	name: 'playerId:v2',
	storage: localStorage,
})
export const [settings, setSettings] = makePersisted(
	createStore<PlayerSettings>({
		name: null,
		muteAudio: false,
	}),
	{ name: 'settings', storage: localStorage }
)

export const playerId = _playerId

export async function setupPlayer() {
	(async () => {
		if (!playerId()) {
			setPlayerId(await createId(6))
		}
	})().then()

	createEffect(() => {
		const playerName = settings.name
		if (!R.room()?.player || !playerName || playerName === R.room()!.player.name) return
		R.room()!.setPlayerName(playerName!)
	})
}
