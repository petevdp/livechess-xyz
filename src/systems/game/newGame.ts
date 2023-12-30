import * as R from '../room.ts'
import * as GL from './gameLogic.ts'
import { createEffect, createRoot, createSignal, on } from 'solid-js'

const [_game, setGame] = createSignal<Game | null>(null)
export const game = _game

createRoot(() => {
	createEffect(() => {
		on(
			() => R.room(),
			(room) => {
				if (!room) return
				setGame(new Game(room))
			}
		)
	})
})

class Game {
	constructor(public room: R.Room) {}

	get state() {
		return this.room.state.gameState!
	}

	get rollbackState() {
		return this.room.rollbackState.gameState!
	}

	get board() {
		return this.state.boardHistory[this.state.boardHistory.length - 1].board
	}

	get players() {
		return this.room.players.map((p) => ({ ...p, color: this.playerColor(p.id) }))
	}

	playerColor(id: string) {
		return this.state.players[id]
	}

	colorPlayer(color: GL.Color) {
		return Object.entries(this.state.players).find(([_, c]) => c === color)![0]
	}

	isPlayerTurn(playerId: string) {
		return this.board.toMove === this.playerColor(playerId)
	}
}
