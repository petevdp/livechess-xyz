import { createStore, produce, SetStoreFunction } from 'solid-js/store'
import { Accessor, createEffect, createRoot, createSignal, on } from 'solid-js'
import * as GL from './gameLogic.ts'
import { GameConfig, GameStateNoGetters, startPos } from './gameLogic.ts'
import * as R from '../room.ts'
import * as P from '../player.ts'
import { concatAll, Subscription } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { HasTimestampAndIndex } from '../../utils/yjs.ts'
import { until } from '@solid-primitives/promise'

type PromotionSelection =
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

export function buildNewGame(
	players: GL.GameState['players'],
	board?: GL.Board
): GL.GameStateNoGetters {
	return {
		winner: null,
		endReason: undefined,
		boardHistory: [toBoardHistoryEntry(board || startPos())],
		moveHistory: [],
		players: players,
	} satisfies GL.GameStateNoGetters
}

export const [game, setGame] = createSignal(null as Game | null)

createRoot(() => {
	let subscription = new Subscription()
	createEffect(() => {
		const _room = R.room()
		if (!_room) {
			subscription.unsubscribe()
			subscription = new Subscription()
			return
		}

		;(async () => {
			subscription.add(
				_room.yClient.observeEvent('roomAction', true).subscribe(async (a) => {
					if (a.type === 'new-game') {
						game()?.destroy()
						setGame(
							new Game(
								_room,
								a.gameConfig,
								a.playerColors,
								await until(() => P.player()?.id)
							)
						)
					}
				})
			)
		})()
	})
})

function getCurrentGameActions(
	actions: (R.RoomAction & HasTimestampAndIndex)[]
) {
	return actions.reverse().find((a) => a.type === 'new-game')
}

export type PlayerWithColor = R.RoomParticipant & { color: GL.Color }

export class Game {
	state: GL.GameState
	setState: SetStoreFunction<GL.GameState>
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	subcription: Subscription
	disposeReactiveRoot: () => void

	constructor(
		private room: R.Room,
		private gameConfig: GameConfig,
		private playerColors: GL.GameState['players'],
		private playerId: string
	) {
		this.subcription = new Subscription()
		const [_state, _setState] = createStore({
			get board() {
				return this.boardHistory[this.boardHistory.length - 1][1]
			},
			get lastMove() {
				return this.moveHistory[this.moveHistory.length - 1]
			},
			...buildNewGame(this.playerColors),
		} as GL.GameState)
		this.state = _state
		this.setState = _setState

		const [_promotion, _setPromotion] = createSignal<null | PromotionSelection>(
			null
		)
		this.promotion = _promotion
		this.setPromotion = _setPromotion

		this.disposeReactiveRoot = () => {}
		this.setupListeners()
	}

	get moveIndex() {
		return this.state.boardHistory.length - 1
	}

	async players() {
		const players = await this.room.yClient.getAllEntities('player')

		return players.map(
			(p) => ({ ...p, color: this.playerColor(p.id) }) as PlayerWithColor
		)
	}

	async getCurrentGameActions() {
		const lastNewGameAction = getCurrentGameActions(
			await this.room.yClient.getAllevents('roomAction')
		)
		const lastNewGameIndex = lastNewGameAction?.index || 0
		return this.room.yClient
			.observeEvent('roomAction', true)
			.pipe(filter((a) => a.index >= lastNewGameIndex!))
	}

	playerColor(id: string) {
		return this.state.players[id]
	}

	isPlayerTurn() {
		return this.state.board.toMove === this.playerColor(this.playerId)
	}

	isEnded() {
		return !!this.state.endReason
	}

	async tryMakeMove(
		from: string,
		to: string,
		promotionPiece?: GL.PromotionPiece
	) {
		if (!this.isPlayerTurn() || !this.state.board.pieces[from]) return
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

		await this.room.yClient.dispatchEvent('roomAction', {
			move: result.move,
			type: 'move',
			playerId: this.playerId,
		})
	}

	destroy() {
		this.subcription.unsubscribe()
		this.disposeReactiveRoot()
	}

	private async setupListeners() {
		this.subcription.add(
			//#region build board state from moves
			(await this.getCurrentGameActions())
				.pipe(
					map(async (action): Promise<Partial<GameStateNoGetters | null>> => {
						switch (action.type) {
							case 'move': {
								let board: GL.Board
								// check if we've already computed this move on a peer
								const [cachedMoveIndex, cachedBoard] =
									await this.room.yClient.getValue('cachedBoard')
								if (cachedMoveIndex === this.moveIndex) {
									board = cachedBoard[1]
								} else {
									// we should have already validated this move before submitting the action, so no need to do it again
									;[board] = GL.applyMoveToBoard(action.move, this.state.board)
									if (!board) {
										console.error('invalid move: ', action.move)
										return null
									}
									// as this value is just cached, we don't have to worry about incongruencies between board state and move state
									this.room.yClient.setValue('cachedBoard', [
										this.moveIndex,
										board,
									])
								}
								return {
									boardHistory: [
										...this.state.boardHistory,
										toBoardHistoryEntry(board),
									],
									moveHistory: [...this.state.moveHistory, action.move],
								} satisfies Partial<GameStateNoGetters>
							}
							case 'resign': {
								return {
									endReason: 'resigned',
									winner: action.playerId === this.playerId ? 'black' : 'white',
								} satisfies Partial<GameStateNoGetters>
							}
							default:
								return null
						}
					}),
					// make sure we process state mutations in order
					concatAll()
				)
				.subscribe((update) => {
					if (update) {
						this.setState(update)
					}
				})
			//#endregion
		)

		createRoot((dispose) => {
			this.disposeReactiveRoot = dispose
			//#region listen for checkmate board positions
			createEffect(
				on(
					() => this.state.board,
					() => {
						this.setState(
							produce((s) => {
								if (GL.checkmated(this.state)) {
									s.endReason = 'checkmate'
									s.winner = s.board.toMove === 'white' ? 'black' : 'white'
								} else if (GL.stalemated(this.state)) {
									s.endReason = 'stalemate'
								} else if (GL.insufficientMaterial(this.state)) {
									s.endReason = 'insufficient-material'
								} else if (GL.threefoldRepetition(this.state)) {
									s.endReason = 'threefold-repetition'
								}
							})
						)
					}
				)
			)
			//#endregion

			//#region handle promotion
			createEffect(() => {
				const _promotionSelection = this.promotion()
				if (_promotionSelection && _promotionSelection.status === 'selected') {
					this.setPromotion(null)
					this.tryMakeMove(
						_promotionSelection.from,
						_promotionSelection.to,
						_promotionSelection.piece
					)
				}
			})
			//#endregion
		})
	}
}

export function toBoardHistoryEntry(board: GL.Board) {
	return [JSON.stringify(board), board] as [string, GL.Board]
}

export const playForBothSides = false
