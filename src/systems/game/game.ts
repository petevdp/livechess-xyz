import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Observable, ReplaySubject, distinctUntilChanged, filter, first, from as rxFrom } from 'rxjs'
import { map } from 'rxjs/operators'
import { Accessor, createEffect, createMemo, createRoot, createSignal, getOwner, observable, on, onCleanup } from 'solid-js'
import { unwrap } from 'solid-js/store'

import * as SS from '~/sharedStore/sharedStore.ts'
import { PUSH, StoreMutation } from '~/sharedStore/sharedStore.ts'
import * as DS from '~/systems/debugSystem'
import { createId } from '~/utils/ids.ts'
import { deepClone } from '~/utils/obj.ts'
import { SignalProperty, createSignalProperty, trackAndUnwrap } from '~/utils/solid.ts'

import { log } from '../logger.browser.ts'
import * as P from '../player.ts'
import * as GL from './gameLogic.ts'

//#region types
export type PlayerWithColor = P.Player & { color: GL.Color }
export type BoardView = {
	board: GL.Board
	lastMove: GL.Move | null
	moveIndex: number
}
export const DRAW_EVENTS = ['draw-offered', 'draw-accepted', 'draw-declined', 'draw-canceled'] as const
export type DrawEventType = (typeof DRAW_EVENTS)[number]

export type GameEvent =
	| {
			type: 'make-move'
			playerId: string
			moveIndex: number
	  }
	| {
			type: 'game-over'
	  }
	| {
			type: DrawEventType
			playerId: string
	  }
	| {
			type: 'new-game'
			playerId: string
			gameId: string
	  }
	| {
			type: 'committed-in-progress-move'
			playerId: string
			gameId: string
	  }

export type ValidateMoveResult =
	| { code: 'invalid' }
	| { code: 'valid' }
	| { code: 'ambiguous' }
	| {
			code: 'placing-duck'
	  }

export type MoveAmbiguity =
	| {
			type: 'promotion'
	  }
	| {
			type: 'castle'
			options: GL.CandidateMove[]
	  }

export type GameParticipant = {
	id: string
	color: GL.Color
}

export type BoardViewEvent =
	| {
			type: 'return-to-live'
	  }
	| {
			type: 'load-move'
			move: GL.Move
	  }
	| {
			type: 'flip-board'
	  }

export type GameParticipantWithDetails = GameParticipant & { name: string }

export type RootGameState = {
	// TODO eventually just make this an array, it's just easier that way
	gameParticipants: { [key in GL.Color]: GameParticipant }
	gameConfig: GL.GameConfig
	moves: GL.Move[]
	outcome?: GL.GameOutcome
	inProgressMove?: GL.InProgressMove
	activeGameId?: string
	drawOffers: { [key in GL.Color]: number }
}

export interface RootGameContext {
	state: RootGameState
	sharedStore: SS.SharedStore<RootGameState, object, GameEvent>
	rollbackState: RootGameState
	members: P.Player[]

	backToPregame(): void
	event$: Observable<GameEvent>

	player: P.Player
}

export interface GameConfigContext {
	gameConfig: GL.GameConfig
	vsBot: boolean

	setGameConfig(config: Partial<GL.GameConfig>): void

	reseedFischerRandom(): void

	editingConfigDisabled: Accessor<boolean>
}

//#endregion

/**
 * Interprets and updates the state of a single game
 */
export class Game {
	gameConfig: GL.GameConfig
	dispose!: () => void

	constructor(
		public gameId: string,
		public gameContext: RootGameContext,
		gameConfig: GL.GameConfig
	) {
		this.gameConfig = deepClone(gameConfig) as GL.GameConfig
		createRoot((dispose) => {
			this.dispose = () => {
				log.debug(`disposing game: %s`, gameId)
				dispose()
			}
			this.init()
		})
	}

	init() {
		this.setupGameState()
		this.setupClocks()
	}

	//#region game state / board
	get isActiveGame() {
		return this.gameContext.rollbackState.activeGameId === this.gameId
	}

	stateSignal!: Accessor<GL.GameState>

	get state(): GL.GameState {
		return this.stateSignal()
	}

	inProgressMoveLocal!: SignalProperty<GL.InProgressMove | undefined>
	boardWithInProgressMove!: Accessor<GL.Board>

	setupGameState() {
		const moveHistory = () => trackAndUnwrap(this.gameContext.rollbackState.moves)
		const boardHistory = GL.useBoardHistory(moveHistory, GL.getStartPos(this.gameConfig))
		// createEffect(() => {
		// 	console.log('moves raw', trackAndUnwrap(this.gameContext.rollbackState.moves))
		// })
		// createEffect(() => {
		// 	console.log('move history', moveHistory())
		// 	console.log('board history', boardHistory())
		// })

		// only update state on board history change because syncing chained signals can be annoying
		this.stateSignal = createMemo(
			on(boardHistory, (boardHistory) => {
				const state: GL.GameState = {
					boardHistory: boardHistory,
					moveHistory: moveHistory(),
					players: {
						[this.gameContext.rollbackState.gameParticipants.white.id]: 'white',
						[this.gameContext.rollbackState.gameParticipants.black.id]: 'black',
					}!,
				}
				return state
			})
		)

		DS.addHook('board', () => this.board, getOwner()!)

		this.inProgressMoveLocal = createSignalProperty<GL.InProgressMove | undefined>(
			this.isThisPlayersTurn() ? this.gameContext.rollbackState.inProgressMove : undefined
		)

		this.boardWithInProgressMove = createMemo(() => {
			let board = this.board
			const inProgressMove = this.inProgressMove
			if (inProgressMove) {
				board = deepClone(board)
				GL.applyInProgressMoveToBoardInPlace(inProgressMove, board)
			}
			return board
		})
	}

	//#endregion

	//#region move selection, validation and updates

	get inProgressMove() {
		return this.gameContext.rollbackState.inProgressMove
	}
	get comittedInProgressMove() {
		return this.gameContext.rollbackState.inProgressMove
	}
	setBaseInProgressMove(move: { from: string; to: string }) {
		this.inProgressMoveLocal.set(move)
	}

	// boardcasts in progress move to other clients
	async commitInProgressMove() {
		await this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame || !this.isThisPlayersTurn() || !this.inProgressMoveLocal.get()) return

			return {
				events: [
					{
						type: 'committed-in-progress-move',
						gameId: this.gameId,
						playerId: this.bottomPlayer.id,
						move: this.inProgressMoveLocal.get(),
					},
				],
				mutations: [{ path: ['inProgressMove'], value: this.inProgressMoveLocal.get() }],
			}
		})
	}
	async setDuck(duckSquare: string) {
		const m = this.inProgressMoveLocal.get()!
		if (!m) throw new Error('tried to set duck without setting base move')
		const isValid = GL.validateDuckPlacement(duckSquare, this.boardWithInProgressMove())
		if (!isValid) return false
		const newMove: GL.InProgressMove = { ...m, duck: duckSquare }
		this.inProgressMoveLocal.set(newMove)
		this.makePlayerMove()
		return true
	}

	get isPlacingDuck() {
		return this.gameConfig.variant === 'duck' && !!this.inProgressMoveLocal.get() && !this.inProgressMoveLocal.get()?.duck
	}

	async selectPromotion(piece: GL.PromotionPiece) {
		this.inProgressMoveLocal.set((m) => ({ ...m!, disambiguation: { type: 'promotion', piece } }))
		this.makePlayerMove()
	}

	async selectIsCastling(isCastling: boolean) {
		this.inProgressMoveLocal.set((m) => ({ ...m!, disambiguation: { type: 'castle', castling: isCastling } }))
		this.makePlayerMove()
	}

	get currentMoveAmbiguity(): MoveAmbiguity | null {
		const currentMove = this.inProgressMoveLocal.get()
		if (!currentMove || currentMove?.disambiguation) return null
		const candidateMoves = this.getLegalMovesForSquare(currentMove.from).filter(
			(move) => GL.notationFromCoords(move.to) === currentMove!.to
		)

		if (candidateMoves.length <= 1) return null
		if (candidateMoves.some((move) => move.promotion)) {
			return {
				type: 'promotion',
			} as MoveAmbiguity
		}
		if (candidateMoves.some((move) => move.castle)) {
			return {
				type: 'castle',
				options: candidateMoves,
			} as MoveAmbiguity
		} else {
			console.warn('unknown ambiguous move', currentMove, candidateMoves)
			throw new Error('unknown ambiguous move')
		}
	}

	getLegalMovesForSquare(startingSquare: string) {
		if (!this.board.pieces[startingSquare]) return []
		return GL.getLegalMoves([GL.coordsFromNotation(startingSquare)], this.stateSignal(), this.gameConfig.variant)
	}

	makeMoveProgrammatic(move: GL.InProgressMove) {
		const result = GL.validateAndPlayMove(move, this.stateSignal(), this.gameConfig.variant)
		if (!result) {
			throw new Error(`invalid move: ${JSON.stringify(result)}`)
		}
		const expectedMoveIndex = this.state.moveHistory.length
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) return
			if (this.state.moveHistory.length !== expectedMoveIndex) return
			return this.getMoveTransaction(result, this.state)
		})
	}

	async validateInProgressMove(): Promise<ValidateMoveResult> {
		const move = this.inProgressMoveLocal.get()
		if (!move) throw new Error('no in progress move')
		if (!this.isClientPlayerParticipating) return { code: 'invalid' }
		if (this.outcome) return { code: 'invalid' }

		const getResult = () => {
			const result = GL.validateAndPlayMove(move, this.stateSignal(), this.gameConfig.variant)
			return result
		}

		if (this.currentMoveAmbiguity) {
			return { code: 'ambiguous' }
		}

		const result = getResult()
		if (!result) return { code: 'invalid' }

		if (this.gameConfig.variant === 'duck' && !this.inProgressMoveLocal.get()?.duck) {
			return { code: 'placing-duck' }
		}

		return { code: 'valid' }
	}

	async makePlayerMove() {
		const move = this.inProgressMoveLocal.get()
		if (!move) throw new Error('no in progress move')
		if (!this.isClientPlayerParticipating) return { code: 'invalid' }
		if (this.outcome) return { code: 'invalid' }
		const expectedMoveIndex = this.state.moveHistory.length

		const [cancelled, setCancelled] = createSignal(false)
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) {
				setCancelled(true)
				return
			}
			const state = unwrap(this.state)
			if (this.outcome) {
				setCancelled(true)
				return
			}
			// check that we're still on the same currentMove
			if (this.state.moveHistory.length !== expectedMoveIndex) {
				setCancelled(true)
				return
			}
			const board = GL.getBoard(state)
			if (!GL.isPlayerTurn(board, this.bottomPlayer.color) || !board.pieces[move.from]) {
				setCancelled(true)
				return
			}
			const result = GL.validateAndPlayMove(move, state, this.gameConfig.variant)
			if (!result) {
				setCancelled(true)
				return
			}
			return this.getMoveTransaction(result, state)
		})
		this.inProgressMoveLocal.set(undefined)
		await until(() => {
			return expectedMoveIndex === this.state.moveHistory.length - 1 || cancelled()
		})
	}

	private getMoveTransaction(_result: ReturnType<typeof GL.validateAndPlayMove>, state: GL.GameState) {
		const result = _result!
		const mutations: StoreMutation[] = [
			{
				path: ['moves', PUSH],
				value: result.move,
			},
			{
				path: ['inProgressMove'],
				value: SS.DELETE,
			},
		]
		const toMove = state.boardHistory[state.boardHistory.length - 1].board.toMove
		const playerId = Object.keys(state.players).find((id) => state.players[id] === toMove)!
		const events: GameEvent[] = [
			{
				type: 'make-move',
				playerId: playerId,
				moveIndex: state.moveHistory.length,
			},
		]
		const newState: GL.GameState = {
			players: this.state.players,
			moveHistory: [...state.moveHistory, result.move],
			boardHistory: [...state.boardHistory, { board: result.board }],
		}
		const outcome = GL.getGameOutcome(newState, this.parsedGameConfig)
		if (outcome) {
			mutations.push({
				path: ['outcome'],
				value: outcome,
			})
			events.push({
				type: 'game-over',
			})
		}

		if (this.drawIsOfferedBy) {
			mutations.push({ path: ['drawOfferedBy'], value: null })
			if (this.drawIsOfferedBy === this.bottomPlayer.color) {
				events.push({ type: 'draw-canceled', playerId: playerId })
			} else {
				events.push({ type: 'draw-declined', playerId: playerId })
			}
		}

		return {
			events,
			mutations,
		}
	}

	//#endregion

	capturedPieces(color: GL.Color) {
		function getPieceCounts(pieces: GL.Piece[]) {
			const counts = {} as Record<GL.Piece, number>

			for (const piece of pieces) {
				counts[piece] = (counts[piece] || 0) + 1
			}

			return counts
		}

		const pieceCounts = getPieceCounts(
			Object.values(this.state.boardHistory[0].board.pieces)
				.filter((p) => p.color === color)
				.map((p) => p.type)
		)
		const currentPieceCounts = getPieceCounts(
			Object.values(this.board.pieces)
				.filter((p) => p.color === color)
				.map((p) => p.type)
		)

		for (const [key, count] of Object.entries(currentPieceCounts)) {
			pieceCounts[key as keyof typeof pieceCounts] -= count
		}

		const capturedPieces: GL.ColoredPiece[] = []

		for (const [key, count] of Object.entries(pieceCounts)) {
			for (let i = 0; i < count; i++) {
				capturedPieces.push({ type: key as GL.Piece, color })
			}
		}

		return capturedPieces
	}

	//#endregion

	//#region clocks

	private getClocks = () => ({ white: 0, black: 0 })

	setupClocks() {
		if (this.gameConfig.timeControl === 'unlimited') return
		const move$ = observeMoves(this.stateSignal)
		this.getClocks = useClock(move$, this.parsedGameConfig, () => !!this.outcome)

		type Timeouts = {
			white: boolean
			black: boolean
		}

		const timeout$ = rxFrom(observable(this.getClocks)).pipe(
			map(
				(clocks) =>
					({
						white: clocks.white <= 0,
						black: clocks.black <= 0,
					}) as Timeouts
			),
			distinctUntilChanged(deepEquals)
		)

		const sub = timeout$
			.pipe(
				filter((t) => t.white || t.black),
				first()
			)
			.subscribe((timeouts) => {
				if (!timeouts) return
				const outcome: GL.GameOutcome = {
					winner: timeouts.white ? 'black' : 'white',
					reason: 'flagged',
				}
				void this.gameContext.sharedStore.setStoreWithRetries(() => {
					if (!this.isActiveGame) return
					if (this.outcome) return
					const events: GameEvent[] = [{ type: 'game-over' }]

					const mutations: StoreMutation[] = [
						{
							path: ['outcome'],
							value: outcome,
						},
					]
					return {
						events,
						mutations,
					}
				})
			})

		onCleanup(() => {
			sub.unsubscribe()
		})
	}

	get clock() {
		return this.getClocks()
	}

	get outcome() {
		return this.gameContext.state.outcome
	}

	get outcome$() {
		return this.gameContext.event$.pipe(
			filter((e) => e.type === 'game-over'),
			map(() => this.outcome)
		)
	}

	//#endregion

	//#region draws and resignation
	offerOrAcceptDraw() {
		if (!this.isClientPlayerParticipating) return
		const moveOffered = this.state.moveHistory.length
		const offerTime = Date.now()
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) return
			if (!this.state || this.state.moveHistory.length !== moveOffered || this.drawIsOfferedBy === this.bottomPlayer.color) return
			if (this.drawIsOfferedBy) {
				const outcome: GL.GameOutcome = {
					winner: null,
					reason: 'draw-accepted',
				}
				return {
					events: [{ type: 'draw-accepted', playerId: this.bottomPlayer.id }, { type: 'game-over' }],
					mutations: [
						{
							path: ['outcome'],
							value: outcome,
						},
					],
				}
			} else {
				return {
					events: [{ type: 'draw-offered', playerId: this.bottomPlayer.id }],
					mutations: [
						{
							path: ['drawOffers', this.bottomPlayer.color],
							value: offerTime,
						},
					],
				}
			}
		})
	}

	declineOrCancelDraw() {
		if (!this.isClientPlayerParticipating) return
		const moveOffered = this.state.moveHistory.length
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) return
			if (!this.state || this.state.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			const drawIsOfferedBy = getDrawIsOfferedBy(this.gameContext.state.drawOffers)
			if (!this.drawIsOfferedBy) return
			if (drawIsOfferedBy === this.bottomPlayer.color) {
				return {
					events: [{ type: 'draw-canceled', playerId: this.bottomPlayer.id }],
					mutations: [
						{
							path: ['drawOffers', this.bottomPlayer.color],
							value: null,
						},
					],
				}
			} else {
				return {
					events: [{ type: 'draw-declined', playerId: this.bottomPlayer.id }],
					mutations: [
						{
							path: ['drawOffers', this.topPlayer.color],
							value: null,
						},
					],
				}
			}
		})
	}

	resign() {
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) return
			if (!this.isClientPlayerParticipating || this.outcome) return
			const outcome: GL.GameOutcome = {
				winner: this.topPlayer.color,
				reason: 'resigned',
			}

			return {
				events: [
					{
						type: 'game-over',
					},
				],
				mutations: [{ path: ['outcome'], value: outcome }],
			}
		})
	}

	get drawIsOfferedBy() {
		return getDrawIsOfferedBy(this.gameContext.rollbackState.drawOffers)
	}

	//#endregion

	//#region generic helpers

	get parsedGameConfig() {
		return GL.parseGameConfig(this.gameConfig)
	}

	get players() {
		return Object.entries(this.gameContext.state.gameParticipants).map(([color, p]) => ({
			...this.gameContext.members.find((m) => m.id === p.id)!,
			color: color as GL.Color,
		}))
	}

	get isClientPlayerParticipating() {
		return Object.keys(this.state.players).includes(this.gameContext.player.id)
	}

	// either the client player or white if the client player is spectating
	get bottomPlayer() {
		if (this.isClientPlayerParticipating) return this.players.find((p) => p.id === this.gameContext.player.id)!
		return this.players.find((p) => p.color === 'white')!
	}

	get topPlayer() {
		if (this.isClientPlayerParticipating) return this.players.find((p) => p.id !== this.gameContext.player.id)!
		return this.players.find((p) => p.color === 'black')!
	}

	get board() {
		return this.state.boardHistory[this.state.boardHistory.length - 1].board
	}

	isPlayerTurn(color: GL.Color) {
		return GL.isPlayerTurn(this.board, color)
	}

	isThisPlayersTurn() {
		return this.isClientPlayerParticipating && this.isPlayerTurn(this.bottomPlayer.color)
	}

	//#endregion
}

//#region helpers
function observeMoves(gameState: Accessor<GL.GameState>) {
	const subject = new ReplaySubject<GL.Move>()
	let lastObserved = -1
	createEffect(() => {
		for (let i = lastObserved + 1; i < gameState().moveHistory.length; i++) {
			subject.next(gameState().moveHistory[i])
		}
		lastObserved = gameState().moveHistory.length - 1
	})

	onCleanup(() => {
		subject.complete()
	})

	return subject.asObservable()
}

function useClock(move$: Observable<GL.Move>, gameConfig: GL.ParsedGameConfig, gameEnded: Accessor<boolean>) {
	const startingTime = gameConfig.timeControl
	if (gameConfig.timeControl === null) {
		return () => ({ white: 0, black: 0 })
	}
	const [white, setWhite] = createSignal(startingTime!)
	const [black, setBlack] = createSignal(startingTime!)
	let lastMoveTs = 0
	let toPlay: GL.Color = 'white'

	const sub = move$.subscribe((move) => {
		if (gameEnded()) return
		// this means that time before the first move is not counted towards the player's clock
		if (lastMoveTs !== 0) {
			const lostTime = move.ts - lastMoveTs - gameConfig.increment
			if (toPlay === 'white') {
				setWhite(Math.min(white() - lostTime, startingTime!))
			} else {
				setBlack(Math.min(black() - lostTime, startingTime!))
			}
		}
		toPlay = toPlay === 'white' ? 'black' : 'white'
		lastMoveTs = move.ts
	})

	const [elapsedSinceLastMove, setElapsedSinceLastMove] = createSignal(0)

	function elapsedListener() {
		if (lastMoveTs === 0) return
		const elapsed = Date.now() - lastMoveTs
		setElapsedSinceLastMove(elapsed)
	}

	const timeout = setInterval(elapsedListener, 10)

	const clocks = () => {
		const times = {
			white: white(),
			black: black(),
		}
		times[toPlay] -= elapsedSinceLastMove()
		return {
			white: Math.max(times.white, 0),
			black: Math.max(times.black, 0),
		}
	}

	createEffect(() => {
		if (gameEnded()) {
			clearInterval(timeout)
			sub.unsubscribe()
		}
	})

	onCleanup(() => {
		clearInterval(timeout)
		sub.unsubscribe()
	})

	return clocks
}

export function getDrawIsOfferedBy(offers: RootGameState['drawOffers']) {
	for (const [color, draw] of Object.entries(offers)) {
		if (draw !== null) return color as GL.Color
	}
	return null
}

export function getNewGameTransaction(playerId: string): { mutations: SS.StoreMutation[]; events: GameEvent[] } {
	const gameId = createId(6)
	return {
		events: [{ type: 'new-game', playerId, gameId }],
		mutations: [
			{ path: ['moves'], value: [] },
			{ path: ['drawOffers'], value: { white: null, black: null } },
			{ path: ['activeGameId'], value: gameId },
			{ path: ['outcome'], value: undefined },
		],
	}
}

//#endregion
