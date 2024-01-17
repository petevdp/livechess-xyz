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
	closeQrCodeDialogOnJoin: boolean
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
		closeQrCodeDialogOnJoin: true,
	}),
	{ name: 'settings', storage: localStorage }
)

export async function setupPlayer() {
	if (!playerId()) setPlayerId(createId(6))
	createEffect(() => {
		const playerName = settings.name
		if (!R.room()?.player || !playerName || playerName === R.room()!.player.name) return
		R.room()!.setPlayerName(playerName!)
	})
}
