import { Accessor, createEffect, createRoot, createSignal, from } from 'solid-js'
import * as GL from './gameLogic.ts'
import { BoardHistoryEntry, GameConfig, startPos } from './gameLogic.ts'
import * as R from '../room.ts'
import * as P from '../player.ts'
import { scan, startWith, Subscription, withLatestFrom } from 'rxjs'
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
						await game()?.destroy()
						setGame(new Game(_room, a.gameConfig, a.playerColors, await until(() => P.player()?.id)))
					}
				})
			)
		})()
	})
})

export type PlayerWithColor = R.RoomParticipant & { color: GL.Color }

export class Game {
	state: GL.GameState
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	subcription: Subscription
	runOnDipose: (() => void)[] = []

	constructor(
		private room: R.Room,
		private gameConfig: GameConfig,
		private playerColors: GL.GameState['players'],
		private playerId: string
	) {
		this.subcription = new Subscription()
		const startingBoard: BoardHistoryEntry = {
			board: startPos(),
			index: 0,
			hash: GL.hashBoard(startPos()),
		}
		let state = null as unknown as GL.GameState

		createRoot((dispose) => {
			this.runOnDipose.push(dispose)

			const boardHistory = from(
				this.room.yClient.observeEntities('boardHistory', true).pipe(startWith([startingBoard]))
			) as Accessor<BoardHistoryEntry[]>
			let moveHistory = from(
				this.observeGameActions().pipe(
					map((a) => (a.type === 'move' ? a.move : null)),
					filter((m) => !!m),
					scan((acc, m) => [...acc, m as GL.Move], [] as GL.Move[]),
					startWith([])
				)
			) as Accessor<GL.Move[]>

			const resigned = from(
				this.observeGameActions().pipe(
					map((a) =>
						a.type === 'game-finished' && a.outcome.reason === 'resigned' ? this.playerColors[a.playerId] : null
					),
					filter((p) => !!p),
					startWith(null)
				)
			) as unknown as Accessor<GL.Color | null>

			state = {
				get boardHistory(): BoardHistoryEntry[] {
					return boardHistory()
				},
				get moveHistory() {
					return moveHistory()
				},
				get board() {
					return this.boardHistory[this.boardHistory.length - 1].board
				},
				get lastMove() {
					return this.moveHistory[this.moveHistory.length - 1]
				},
				get outcome(): GL.GameOutcome | null {
					if (resigned()) {
						const winner = Object.values(this.players).find((color) => color !== resigned())!
						return {
							reason: 'resigned',
							winner,
						}
					}
					return GL.getGameOutcome(this)
				},
				players: this.playerColors,
			}
		})

		this.state = state

		const [_promotion, _setPromotion] = createSignal<null | PromotionSelection>(null)
		this.promotion = _promotion
		this.setPromotion = _setPromotion

		this.setupListeners()
	}

	get moveIndex() {
		return this.state.boardHistory.length - 1
	}

	async players() {
		const players = await this.room.yClient.getAllEntities('player')

		return players.map((p) => ({ ...p, color: this.playerColor(p.id) }) as PlayerWithColor)
	}

	// hot observable
	observeGameActions() {
		// this is a hot observable due to this
		const getLastNewGamePromise = this.room.yClient.getAllevents('roomAction').then(getCurrentNewGameAction)

		return this.room.yClient.observeEvent('roomAction', true).pipe(
			withLatestFrom(getLastNewGamePromise),
			filter(([a, lastNewGame]) => {
				if (!lastNewGame) return false
				return a.index > lastNewGame.index
			}),
			map(([a]) => a)
		)
	}

	playerColor(id: string) {
		return this.state.players[id]
	}

	isPlayerTurn() {
		return this.state.board.toMove === this.playerColor(this.playerId)
	}

	isEnded() {
		return !!this.state.outcome
	}

	async tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
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

		const newBoardIndex = this.state.boardHistory.length
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

		if (this.state.outcome) {
			await this.room.dispatchRoomAction({
				type: 'game-finished',
				outcome: this.state!.outcome,
				winnerId: this.state!.outcome!.winner,
			})
		}
	}

	async destroy() {
		await this.room.yClient.clearEntities('boardHistory')
		this.subcription.unsubscribe()
		this.runOnDipose.forEach((f) => f())
	}

	async resign() {
		const winnerId = (await this.players()).find((p) => p.id !== this.playerId)!.id
		await this.room.dispatchRoomAction({
			type: 'game-finished',
			outcome: {
				reason: 'resigned',
				winner: this.playerColor(winnerId),
			},
			winnerId,
		})
	}

	offerDraw() {
		throw new Error('not implemented')
	}

	private async setupListeners() {
		createRoot((dispose) => {
			this.runOnDipose.push(dispose)

			//#region handle promotion
			createEffect(() => {
				const _promotionSelection = this.promotion()
				if (_promotionSelection && _promotionSelection.status === 'selected') {
					this.setPromotion(null)
					this.tryMakeMove(_promotionSelection.from, _promotionSelection.to, _promotionSelection.piece)
				}
			})
			//#endregion
		})
	}
}

function getCurrentNewGameAction(actions: (R.RoomAction & HasTimestampAndIndex)[]) {
	let idx = -1
	for (let action of actions) {
		if (action.type === 'new-game') {
			idx = action.index
		}
	}
	if (idx === -1) return null
	return actions[idx]
}

export const playForBothSides = false
