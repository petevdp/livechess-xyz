import { type Bot } from '../vsBot.ts'
import * as GL from './gameLogic.ts'

export class RandomBot implements Bot {
	constructor(
		public difficulty: number,
		private variant: GL.Variant = 'regular'
	) {}
	name = 'Random Bot'
	setDifficulty(difficulty: number) {
		this.difficulty = difficulty
	}
	async makeMove(state: GL.GameState): Promise<GL.SelectedMove> {
		const moves = GL.getAllLegalMoves(state, this.variant)
		const candidateMove = moves[Math.floor(Math.random() * moves.length)]
		return GL.candidateMoveToSelectedMove(candidateMove)
	}
}
