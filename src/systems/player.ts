import { createEffect, createRoot, createSignal } from 'solid-js'
import { createId } from '../utils/ids.ts'
import { useLocalStorage } from '../utils/persistence.ts'
import * as R from './room.ts'

export type Player = {
	id: string
	name: string | null
}
export type PlayerAwareness = {
	playerId: string
}

export let [player, setPlayer] = createSignal<Player | null>(
	null as Player | null
)

export function setPlayerName(name: string) {
	if (!player()) return
	setPlayer({ ...player()!, name })
}

export async function setupPlayer() {
	useLocalStorage('player', player, setPlayer)

	if (player() === null) {
		setPlayer({ id: await createId(6), name: null })
	}

	createRoot(() => {
		createEffect(() => {
			const _room = R.room()!
			if (!_room) return
			_room.yClient.setLocalAwarenessState('playerId', player()!.id)
			;(async () => {
				const players = await _room.players
				const playerReplicated = players.find((p) => p.id === player()!.id)

				let isSpectator

				if (players.length > 2 && !playerReplicated) {
					isSpectator = true
				} else if (playerReplicated) {
					isSpectator = playerReplicated.spectator
				} else {
					isSpectator = false
				}
				const joinTs = playerReplicated?.joinTs || Date.now()

				await _room.yClient.setEntity('player', player()!.id, {
					...player()!,
					spectator: isSpectator,
					joinTs,
				})
			})()
		})
	})
}
