import { Accessor, createEffect, createRoot, createSignal, from, on } from 'solid-js'
import * as GL from './gameLogic.ts'
import { BoardHistoryEntry, GameConfig, startPos, timeControlToMs } from './gameLogic.ts'
import * as R from '../room.ts'
import {
	concat,
	concatMap,
	distinctUntilChanged,
	endWith,
	firstValueFrom,
	interval,
	Observable,
	scan,
	share,
	startWith,
	Subscription,
	switchMap,
	takeUntil,
} from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { HasTimestampAndIndex } from '../../utils/yjs.ts'

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

// createRoot(() => {
// 	let subscription = new Subscription()
// 	let gameIndex = 0
// 	createEffect(() => {
// 		const room = R.room()
// 		untrack(() => {
// 			if (!room) {
// 				subscription.unsubscribe()
// 				subscription = new Subscription()
// 				return
// 			}
// 			subscription.add(
// 				observeGameActions(room)
// 					.pipe(filter((a) => a.type === 'new-game'))
// 					.subscribe(async (a) => {
// 						console.log('initializing game')
// 						if (a.index < gameIndex) return
// 						const allActions = await room.yClient.getAllevents('roomAction')
// 						let currentNewGameActionIndex = getCurrentNewGameActionIndex(allActions)
// 						if (currentNewGameActionIndex === -1) return
// 						const newGameAction = allActions[currentNewGameActionIndex]
// 						await game()?.destroy()
// 						let _game = new Game(
// 							room,
// 							//@ts-ignore I quit
// 							newGameAction.gameConfig,
// 							//@ts-ignore
// 							newGameAction.playerColors,
// 							await until(() => P.player()?.id)
// 						)
// 						setGame(_game)
// 					})
// 			)
// 		})
// 	})
// })
//

export type PlayerWithColor = R.RoomParticipant & { color: GL.Color }

export class Game {
	state: GL.GameState
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	subscription: Subscription
	runOnDipose: (() => void)[] = []
	clock$: Observable<Record<string, number>>

	constructor(
		private room: R.Room,
		private gameConfig: GameConfig,
		private playerColors: GL.GameState['players'],
		private playerId: string
	) {
		console.log(this.gameConfig)
		this.subscription = new Subscription()
		const startingBoard: BoardHistoryEntry = {
			board: startPos(),
			index: 0,
			hash: GL.hashBoard(startPos()),
		}
		let state = null as unknown as GL.GameState

		createRoot((dispose) => {
			this.runOnDipose.push(dispose)

			this.room.yClient.setEntity('boardHistory', '0', startingBoard)
			const boardHistory = from(this.room.yClient.observeEntities('boardHistory', true))

			let moveHistory = from(
				observeGameActions(this.room).pipe(
					map((a) => (a.type === 'move' ? a.move : null)),
					filter((m) => !!m),
					scan((acc, m) => [...acc, m as GL.Move], [] as GL.Move[])
				)
			)

			state = {
				get boardHistory(): BoardHistoryEntry[] {
					return boardHistory() || [startingBoard]
				},
				get moveHistory() {
					return moveHistory() || []
				},
				players: this.playerColors,
			}
		})

		this.state = state
		this.clock$ = this.observeClock().pipe(share())

		const [_promotion, _setPromotion] = createSignal<null | PromotionSelection>(null)
		this.promotion = _promotion
		this.setPromotion = _setPromotion

		this.setupListeners()
	}

	get moveIndex() {
		return this.state.boardHistory.length - 1
	}

	get moveHistoryAsNotation(): string[] {
		let moves = []
		for (let i = 0; i < Math.ceil(this.state.moveHistory.length / 2); i++) {
			const whiteMove = GL.moveToChessNotation(i * 2, this.state)
			if (i * 2 + 1 >= this.state.moveHistory.length) {
				moves.push(`${i + 1} ${whiteMove}`)
				break
			}
			const blackMove = GL.moveToChessNotation(i * 2 + 1, this.state)
			moves.push(`${i + 1} ${whiteMove} ${blackMove}`)
		}
		return moves
	}

	// hot observable
	playerColor(id: string) {
		return this.state.players[id]
	}

	colorPlayer(color: GL.Color) {
		return Object.entries(this.state.players).find(([_, c]) => c === color)![0]
	}

	isPlayerTurn(playerId: string) {
		return this.state.board.toMove === this.playerColor(playerId)
	}

	async players() {
		const players = await this.room.yClient.getAllEntities('player')

		return players.map((p) => ({ ...p, color: this.playerColor(p.id) }) as PlayerWithColor)
	}

	async tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
		console.log('tryMakeMove', { from, to, promotionPiece })
		if (!this.isPlayerTurn(this.playerId) || !this.state.board.pieces[from]) return
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
	}

	async destroy() {
		await this.room.yClient.clearEntities('boardHistory')
		this.subscription.unsubscribe()
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

	async offerDraw() {
		await this.room.dispatchRoomAction({
			type: 'offer-draw',
		})
	}

	observeDrawOffered() {
		return this.room.yClient.observeValue('drawOfferedBy', true)
	}

	observeLastGameAction() {
		return concat(this.room.yClient.getLatestEvent('roomAction'), this.room.yClient.observeEvent('roomAction', false))
	}

	observeClock() {
		const moves = observeGameActions(this.room).pipe(
			filter((a) => a.type === 'move'),
			map((a) => ({ playerId: a.playerId, ts: a.ts }))
		)
		const timesElapsed$ = observePlayerTimesElapsedBeforeMove(moves, this.gameConfig, Object.keys(this.state.players))

		return timesElapsed$.pipe(
			takeUntil(this.waitForGameOutcome()),
			switchMap((timesElapsed) => {
				const clocks = { ...timesElapsed }
				const lastMoveTs = this.state.moveHistory.length > 0 ? this.state.lastMove.ts : 0
				clocks[this.colorPlayer(this.state.board.toMove)] -= Date.now() - lastMoveTs
				return interval(100).pipe(
					map(() => {
						for (let id of Object.keys(clocks)) {
							if (this.isPlayerTurn(id)) clocks[id] -= 100
							if (clocks[id] < 0) clocks[id] = 0
						}
						return clocks
					})
				)
			}),
			startWith(getStartingClocks(this.gameConfig.timeControl, Object.keys(this.state.players)))
		)
	}

	observeGameOutcome() {
		return this.observeLastGameAction().pipe(
			map((a) => (a.type === 'game-finished' ? a.outcome : null)),
			startWith(null),
			distinctUntilChanged()
		)
	}

	async waitForGameOutcome() {
		return await firstValueFrom(
			this.observeGameOutcome().pipe(
				filter((a) => !!a),
				endWith(null)
			)
		).then((a) => {
			if (!a) throw new Error('stopped receiving game-finished events, but no game-outcome yet')
			return a
		})
	}

	private async setupListeners() {
		createRoot((dispose) => {
			this.runOnDipose.push(dispose)

			//#region handle draw offers
			const drawOfferedBy = from(this.observeDrawOffered())
			this.subscription.add(
				this.observeLastGameAction().subscribe((a) => {
					if (a.playerId !== this.playerId) return
					// we're checking against offer-draw here instead of a possible draw-accepted event so if they offer at the same time, the draw is automatically made
					if (a.type === 'offer-draw' && drawOfferedBy() && drawOfferedBy() !== a.playerId) {
						this.room.yClient.runWithTransaction(async (t) => {
							await this.room.dispatchRoomAction(
								{
									type: 'game-finished',
									outcome: { reason: 'draw-accepted', winner: null },
									winnerId: null,
								},
								t
							)
							await this.room.yClient.setValue('drawOfferedBy', null, t)
						})
						return
					} else if (a.type === 'offer-draw') {
						this.room.yClient.setValue('drawOfferedBy', a.playerId)
					} else {
						this.room.yClient.setValue('drawOfferedBy', null)
					}
				})
			)
			//#endregion

			//#region handle promotion
			createEffect(() => {
				const _promotionSelection = this.promotion()
				if (_promotionSelection && _promotionSelection.status === 'selected') {
					this.setPromotion(null)
					this.tryMakeMove(_promotionSelection.from, _promotionSelection.to, _promotionSelection.piece)
				}
			})
			//#endregion

			//#region sync gamestate derived outcomes
			createEffect(() => {
				if (!this.isPlayerTurn(this.playerId)) return // so we don't trigger this effect on both clients
				on(
					() => GL.getGameOutcome(this.state),
					(gameOutcome) => {
						if (!gameOutcome) return
						const winnerId = (gameOutcome.winner && this.playerColor(gameOutcome.winner)) || null
						this.room.dispatchRoomAction({ type: 'game-finished', outcome: gameOutcome, winnerId })
					}
				)
			})

			const outcome = from(this.observeGameOutcome())
			//#region handle flagged(clock empty)
			this.subscription.add(
				this.clock$.subscribe((clock) => {
					if (outcome()) return
					for (let [playerId, timeLeft] of Object.entries(clock)) {
						if (timeLeft <= 0 && this.isPlayerTurn(playerId)) {
							this.room.dispatchRoomAction({
								type: 'game-finished',
								outcome: { reason: 'flagged', winner: this.playerColor(playerId) },
								winnerId: Object.keys(this.state.players).find((id) => id !== playerId)!,
							})
							return
						}
					}
				})
			)
			//#endregion
		})
	}
}

function observeGameActions(room: R.Room) {
	// this is a hot observable due to this
	const getLastNewGamePromise = room.yClient.getAllevents('roomAction').then(getCurrentNewGameActionIndex)

	return room.yClient.observeEvent('roomAction', true).pipe(
		concatMap(async (a) => {
			const lastNewGameIndex = (await getLastNewGamePromise) || 0
			if (a.index < lastNewGameIndex) return null as unknown as typeof a
			return a
		}),
		filter((a) => a !== null)
	)
}

function getCurrentNewGameActionIndex(actions: (R.RoomAction & HasTimestampAndIndex)[]) {
	let idx = -1
	for (let action of actions) {
		if (action.type === 'new-game') {
			idx = action.index
		}
	}
	return idx
}

function getStartingClocks(timeControl: GL.TimeControl, playerIds: string[]) {
	let clocks = {} as Record<string, number>
	for (let id of playerIds) clocks[id] = timeControlToMs(timeControl)
	return clocks
}

function observePlayerTimesElapsedBeforeMove(
	moves: Observable<{
		playerId: string
		ts: number
	}>,
	config: GL.GameConfig,
	playerIds: string[]
) {
	return new Observable<Record<string, number>>((s) => {
		const timeLeft = getStartingClocks(config.timeControl, playerIds)
		let lastMoveTs = 0

		moves.subscribe({
			next: (a) => {
				if (!timeLeft[a.playerId]) throw new Error(`player ${a.playerId} not in game`)

				// this means that time before the first move is not counted towards the player's clock
				if (lastMoveTs !== 0) {
					timeLeft[a.playerId] -= a.ts - lastMoveTs + parseInt(config.increment)
				}
				s.next(timeLeft)
				lastMoveTs = a.ts
			},
			complete: () => s.complete(),
			error: (e) => s.error(e),
		})
	})
}

export const playForBothSides = false
