import { createId } from '../utils/ids.ts'
import { createEffect, createSignal } from 'solid-js'
import * as R from './room.ts'

export type Player = {
	id: string
	name: string
}

const [_playerId, setPlayerId] = createSignal<string | null>(null)
export const [playerName, setPlayerName] = createSignal<string | null>(null)

export const playerId = _playerId

export async function setupPlayer() {
	(async () => {
		let playerId = localStorage.getItem('playerId')
		let playerName = localStorage.getItem('playerName')
		if (!playerId) {
			playerId = await createId(6)
			localStorage.setItem('playerId', playerId)
		}
		setPlayerId(playerId)
		setPlayerName(playerName)
	})().then()

	createEffect(() => {
		localStorage.setItem('playerName', playerName() || '')
		if (!R.room()?.player || !playerName() || playerName()! === R.room()!.player.name) return
		R.room()!.setPlayerName(playerName()!)
	})
}
