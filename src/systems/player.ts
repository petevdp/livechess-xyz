import { createSignal } from 'solid-js'
import { createId } from '../utils/ids.ts'
import { useLocalStorage } from '../utils/persistence.ts'

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
}
