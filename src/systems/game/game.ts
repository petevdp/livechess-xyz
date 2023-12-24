import { Accessor, createEffect, createRoot, createSignal, from, on, untrack } from 'solid-js'
import * as GL from './gameLogic.ts'
import { BoardHistoryEntry, GameConfig, startPos } from './gameLogic.ts'
import * as R from '../room.ts'
import * as P from '../player.ts'
import { concat, endWith, firstValueFrom, mergeAll, scan, Subscription } from 'rxjs'
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
	let gameIndex = 0
	createEffect(() => {
		const room = R.room()
		untrack(() => {
			if (!room) {
				subscription.unsubscribe()
				subscription = new Subscription()
				return
			}
			subscription.add(
				observeGameActions(room)
					.pipe(filter((a) => a.type === 'new-game'))
					.subscribe(async (a) => {
						console.log('initializing game')
						if (a.index < gameIndex) return
						const allActions = await room.yClient.getAllevents('roomAction')
						let currentNewGameActionIndex = getCurrentNewGameActionIndex(allActions)
						if (currentNewGameActionIndex === -1) return
						const newGameAction = allActions[currentNewGameActionIndex]
						await game()?.destroy()
						let _game = new Game(
							room,
							//@ts-ignore I quit
							newGameAction.gameConfig,
							//@ts-ignore
							newGameAction.playerColors,
							await until(() => P.player()?.id)
						)
						setGame(_game)
					})
			)
		})
	})
})

export type PlayerWithColor = R.RoomParticipant & { color: GL.Color }

export class Game {
	state: GL.GameState
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	subscription: Subscription
	runOnDipose: (() => void)[] = []

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
				get board() {
					return this.boardHistory[this.boardHistory.length - 1].board
				},
				get lastMove() {
					return this.moveHistory[this.moveHistory.length - 1]
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
	playerColor(id: string) {
		return this.state.players[id]
	}

	isPlayerTurn() {
		return this.state.board.toMove === this.playerColor(this.playerId)
	}

	async tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
		console.log('tryMakeMove', { from, to, promotionPiece })
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

	async waitForGameOutcome() {
		return await firstValueFrom(
			this.observeLastGameAction().pipe(
				map((a) => (a.type === 'game-finished' ? a.outcome : null)),
				filter((a) => !!a),
				endWith(null)
			)
		).then((a) => {
			if (!a) throw new Error('stopped receving game-finished events, but no game-outcome yet')
			return a
		})
	}

	private async setupListeners() {
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

			//#region sync gamestate derived outcomes
			createEffect(() => {
				if (!this.isPlayerTurn()) return // so we don't trigger this effect on both clients
				on(
					() => GL.getGameOutcome(this.state),
					(gameOutcome) => {
						if (!gameOutcome) return
						const winnerId = (gameOutcome.winner && this.playerColor(gameOutcome.winner)) || null
						this.room.dispatchRoomAction({ type: 'game-finished', outcome: gameOutcome, winnerId })
					}
				)
			})

			//#endregion
		})
	}
}

export function observeGameActions(room: R.Room) {
	// this is a hot observable due to this
	const getLastNewGamePromise = room.yClient.getAllevents('roomAction').then(getCurrentNewGameActionIndex)

	return room.yClient.observeEvent('roomAction', true).pipe(
		map(async (a) => {
			const lastNewGameIndex = (await getLastNewGamePromise) || 0
			if (a.index < lastNewGameIndex) return null as unknown as typeof a
			return a
		}),
		mergeAll(),
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

export const playForBothSides = false
