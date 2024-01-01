import * as R from '../room.ts'
import * as GL from './gameLogic.ts'
import * as P from '../player.ts'
import {Accessor, createEffect, createMemo, createRoot, createSignal, untrack} from 'solid-js'
import {buildTransaction} from "../../utils/sharedStore.ts";
import {BoardHistoryEntry} from "./gameLogic.ts";

const [_game, setGame] = createSignal<Game | null>(null)
export const game = _game

export type PromotionSelection =
	| {
			status: 'selecting'
			from: string
			to: string
	  }
	| {
			from: string
			to: string
			status: 'selected'
			piece: GL.PromotionPiece
	  }

createRoot(() => {
	createEffect(() => {
		const room = R.room()
		if (!room || room.state.status !== 'playing') return
		untrack(() => {
			setGame(new Game(room, P.player()!.id))
		})
	})
})

export class Game {
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	private _outcome: Accessor<GL.GameOutcome | null>
	constructor(public room: R.Room, public playerId: string) {
		const [promotion,setPromotion] = createSignal(null)
		this.setPromotion = setPromotion
		this.promotion = promotion

		this._outcome = createMemo(() => GL.getGameOutcome(this.state))

	}

	get outcome() {
		return this._outcome()
	}

	get state() {
		return this.room.state.gameState!
	}

	get rollbackState() {
		return this.room.rollbackState.gameState!
	}

	get board() {
		return this.state.boardHistory[this.state.boardHistory.length - 1].board
	}

	get lastMove() {
		return this.state.moveHistory[this.state.moveHistory.length - 1]
	}

	get players() {
		return this.room.players.map((p) => ({ ...p, color: this.playerColor(p.id) }))
	}

	get player() {
		return this.players.find((p) => p.id === this.playerId)!
	}

	get opponent() {
		return this.players.find((p) => p.id !== this.playerId)!
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


	async tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
		console.log('tryMakeMove', { from, to, promotionPiece })
		if (!this.isPlayerTurn(this.playerId) || !this.board.pieces[from]) return
		let result = GL.validateAndPlayMove(from, to, this.state, promotionPiece)
		if (!result) {
			console.error('invalid move: ', result)
			return
		}

		if (!!this.promotion() && this.promotion()?.status === 'selecting') return

		if (result.promoted && !this.promotion() && !promotionPiece) {
			this.setPromotion({ status: 'selecting', from, to })
			return
		}

		const newBoardIndex = this.state.boardHistory.length


		await buildTransaction((t) => {
			const newBoardHistory: BoardHistoryEntry = {
				board: result!.board,
				index: newBoardIndex,
				hash: GL.hashBoard(result!.board),
			}
			this.room.setState({path: ['gameState', 'boardHistory', '__push__'], value: newBoardHistory})

		})

		this.room.setState({path: ['gameState']})

		await this.room.yClient.runWithTransaction(async (t) => {
			const ops: Promise<any>[] = []
			ops.push(
				this.room.yClient.setEntity(
					'boardHistory',
					newBoardIndex.toString(),
					{
						board: result!.board,
						index: newBoardIndex,
						hash: GL.hashBoard(result!.board),
					},
					t
				)
			)
			ops.push(
				this.room.dispatchRoomAction(
					{
						move: result!.move,
						type: 'move',
					},
					t
				)
			)
			await Promise.all(ops)
		})
	}

}
