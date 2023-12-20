import { Accessor } from 'solid-js'
import { createId } from '../utils/ids.ts'
import { useLocalStorage } from '../utils/persistence.ts'

export type Player = {
	id: string
	name: string | null
}

export let player: Accessor<Player>
export let setPlayer: (p: Player) => void

export async function setupPlayer() {
	const playerId = await createId(6)
	;[player, setPlayer] = useLocalStorage<Player>('player', {
		id: playerId,
		name: null,
	})
}
