import * as GL from '../systems/game/gameLogic.ts'
import { type Bot } from '../systems/vsBot.ts'

export class RandomBot implements Bot {
	constructor(
		public difficulty: number,
		private variant: GL.Variant = 'regular'
	) {}
	name = 'Random Bot'
	setDifficulty(difficulty: number) {
		this.difficulty = difficulty
	}
	async makeMove(state: GL.GameState): Promise<GL.InProgressMove> {
		const moves = GL.getAllLegalMoves(state, this.variant)
		const candidateMove = moves[Math.floor(Math.random() * moves.length)]
		return GL.candidateMoveToSelectedMove(candidateMove)
	}
	dispose() {
		// nothing to do
	}
}
