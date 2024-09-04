import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Observable, ReplaySubject, distinctUntilChanged, filter, first, from as rxFrom } from 'rxjs'
import { map } from 'rxjs/operators'
import { Accessor, createEffect, createMemo, createSignal, getOwner, observable, on, onCleanup } from 'solid-js'
import { unwrap } from 'solid-js/store'

import * as SS from '~/sharedStore/sharedStore.ts'
import { PUSH, StoreMutation } from '~/sharedStore/sharedStore.ts'
import { createId } from '~/utils/ids.ts'
import { storeToSignal } from '~/utils/solid.ts'
import { unit } from '~/utils/unit.ts'

import * as P from '../player.ts'
import * as GL from './gameLogic.ts'
import { Color } from './gameLogic.ts'

//#region types
export type PlayerWithColor = P.Player & { color: GL.Color }
export type BoardView = {
	board: GL.Board
	inCheck: boolean
	lastMove: GL.Move | null
	visibleSquares: Set<string>
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
			type: DrawEventType | 'new-game'
			playerId: string
	  }

export type MakeMoveResult =
	| { type: 'invalid' }
	| { type: 'accepted'; move: GL.Move }
	| { type: 'ambiguous' }
	| {
			type: 'placing-duck'
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

export type GameParticipantWithDetails = GameParticipant & { name: string }

export type RootGameState = {
	// TODO eventually just make this an array, it's just easier that way
	gameParticipants: { [key in GL.Color]: GameParticipant }
	gameConfig: GL.GameConfig
	moves: GL.Move[]
	outcome?: GL.GameOutcome
	activeGameId?: string
	drawOffers: { [key in GL.Color]: number }
}

export interface RootGameContext {
	state: RootGameState
	sharedStore: SS.SharedStore<RootGameState, object, GameEvent>
	rollbackState: RootGameState
	members: P.Player[]

	configureNewGame(): void
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

	constructor(
		public gameId: string,
		public gameContext: RootGameContext,
		gameConfig: GL.GameConfig
	) {
		if (!getOwner()) throw new Error('Game constructor must be called in reactive context')
		this.gameConfig = JSON.parse(JSON.stringify(gameConfig)) as GL.GameConfig

		this.setupGameState()
		this.setupBoardView()
		this.setupClocks()
		this.setupMoveSelectionAndValidation()
	}

	//#region game state / board
	get isActiveGame() {
		return this.gameContext.rollbackState.activeGameId === this.gameId
	}

	stateSignal = unit as unknown as Accessor<GL.GameState>

	get state(): GL.GameState {
		return this.stateSignal()
	}

	setupGameState() {
		const moveHistory = storeToSignal(this.gameContext.rollbackState.moves)
		// createEffect(() => {
		// 	console.log('move history changed: ', moveHistory())
		// })
		const boardHistory = GL.useBoardHistory(moveHistory, GL.getStartPos(this.gameConfig))
		// const [state, setState] = createSignal<GL.GameState>(null as any)
		// this.stateSignal = state

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
	}

	//#endregion

	//#region move selection, validation and updates

	currentMove = unit as unknown as Accessor<GL.SelectedMove | null>
	setCurrentMove = unit as (move: GL.SelectedMove | null) => void
	placingDuck = unit as unknown as Accessor<false>
	setPlacingDuck = unit as (placing: boolean) => void

	currentDuckPlacement() {
		return this.currentMove()?.duck
	}

	setCurrentDisambiguation(disambiguation?: undefined | GL.MoveDisambiguation) {
		const currentMove = this.currentMove()
		if (!currentMove) return
		this.setCurrentMove({ ...currentMove, disambiguation })
	}

	private boardWithCurrentMove = unit as unknown as Accessor<null | GL.Board>
	setBoardWithCurrentMove = unit as (board: null | GL.Board) => void
	private _candidateMovesForSelected = unit as unknown as Accessor<any[] | GL.CandidateMove[]>

	setupMoveSelectionAndValidation() {
		;[this.currentMove, this.setCurrentMove] = createSignal(null as null | GL.SelectedMove)
		;[this.boardWithCurrentMove, this.setBoardWithCurrentMove] = createSignal(null as null | GL.Board)
		;[this.placingDuck, this.setPlacingDuck] = createSignal(false)

		this._candidateMovesForSelected = () => {
			const currentMove = this.currentMove()
			if (!currentMove) return []
			return this.getLegalMovesForSquare(currentMove.from).filter((move) => GL.notationFromCoords(move.to) === currentMove!.to)
		}
	}

	get currentMoveAmbiguity(): MoveAmbiguity | null {
		const currentMove = this.currentMove()
		if (!currentMove || this.currentMove()?.disambiguation) return null
		const candidateMoves = this.candidateMovesFromSelected
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

	get candidateMovesFromSelected() {
		return this._candidateMovesForSelected()
	}

	getLegalMovesForSquare(startingSquare: string) {
		if (!this.board.pieces[startingSquare]) return []
		return GL.getLegalMoves([GL.coordsFromNotation(startingSquare)], this.stateSignal(), this.gameConfig.variant)
	}

	makeMoveProgrammatic(move: GL.SelectedMove, playerId: string) {
		const result = GL.validateAndPlayMove(move, this.stateSignal(), this.gameConfig.variant)
		if (!result) {
			throw new Error(`invalid move: ${JSON.stringify(result)}`)
		}
		const expectedMoveIndex = this.state.moveHistory.length
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) return
			if (this.state.moveHistory.length !== expectedMoveIndex) return
			return this.getMoveTransaction(result, this.state, playerId)
		})
	}

	async tryMakeMove(move?: GL.SelectedMove): Promise<MakeMoveResult> {
		if (!this.isClientPlayerParticipating) return { type: 'invalid' }
		if (move) this.setCurrentMove(move)
		if (this.outcome || !this.currentMove) return { type: 'invalid' }
		const currentMove = this.currentMove()!
		const getResult = () => GL.validateAndPlayMove(currentMove, this.stateSignal(), this.gameConfig.variant)

		if (this.currentMoveAmbiguity) {
			const result = getResult()
			if (!result) return { type: 'invalid' }
			if (this.currentMoveAmbiguity.type === 'promotion') {
				// while we're promoting, display the promotion square as containing the pawn
				result.board.pieces[currentMove.to] = {
					type: 'pawn',
					color: this.board.toMove,
				}
			}
			if (this.currentMoveAmbiguity.type === 'castle') {
				// while we're castling/moving the king, display the king in the destination square
				result.board.pieces[currentMove.to] = {
					type: 'king',
					color: this.board.toMove,
				}
			}
			this.setBoardWithCurrentMove(result.board)
			return { type: 'ambiguous' }
		}

		if (this.gameConfig.variant === 'duck' && !this.currentDuckPlacement) {
			const result = getResult()
			if (!result) return { type: 'invalid' }
			if (!GL.kingCaptured(result.board)) {
				this.setPlacingDuck(true)
				this.setBoardWithCurrentMove(result.board)
				const prevDuckPlacement = Object.keys(this.board.pieces).find((square) => this.board.pieces[square]!.type === 'duck')
				if (prevDuckPlacement) {
					// render previous duck while we're placing the new one, so it's clear that the duck can't be placed in the same spot twice
					result.board.pieces[prevDuckPlacement] = GL.DUCK
				}
				return { type: 'accepted', move: result.move }
			}
		}

		const expectedMoveIndex = this.state.moveHistory.length
		this.setCurrentMove(null)
		this.setPlacingDuck(false)
		this.setBoardWithCurrentMove(null)
		const [acceptedMove, setAcceptedMove] = createSignal(null as null | GL.Move)
		void this.gameContext.sharedStore.setStoreWithRetries(() => {
			if (!this.isActiveGame) return
			const state = unwrap(this.state)
			if (this.viewedMoveIndex() !== state.moveHistory.length - 1 || this.outcome) return
			// check that we're still on the same currentMove
			if (this.state.moveHistory.length !== expectedMoveIndex) return
			const board = GL.getBoard(state)
			if (!GL.isPlayerTurn(board, this.bottomPlayer.color) || !board.pieces[currentMove.from]) return
			const result = GL.validateAndPlayMove(currentMove, state, this.gameConfig.variant)
			if (!result) {
				return
			}
			setAcceptedMove(result.move)
			return this.getMoveTransaction(result, state, this.bottomPlayer.id)
		})
		return { type: 'accepted', move: await until(() => acceptedMove()) }
	}

	private getMoveTransaction(_result: ReturnType<typeof GL.validateAndPlayMove>, state: GL.GameState, playerId: string) {
		const result = _result!
		const mutations: StoreMutation[] = [
			{
				path: ['moves', PUSH],
				value: result.move,
			},
		]
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

	//#region board view and history
	currentBoardView = {} as BoardView
	private _setViewedMove = unit as unknown as (move: number | 'live') => void
	viewedMoveIndex = unit as unknown as Accessor<number>

	setupBoardView() {
		const [currentMove, setViewedMove] = createSignal<'live' | number>('live')
		this.viewedMoveIndex = () => (currentMove() === 'live' ? this.state.moveHistory.length - 1 : (currentMove() as number))
		this._setViewedMove = setViewedMove
		const lastMove = () => this.state.moveHistory[this.viewedMoveIndex()] || null

		// boards are only so we don't need to deeply track this
		const viewedBoard = () => {
			if (this.boardWithCurrentMove() && this.viewingLiveBoard) {
				return this.boardWithCurrentMove()!
			} else {
				return this.state.boardHistory[this.viewedMoveIndex() + 1].board
			}
		}

		const inCheck = createMemo(() => GL.inCheck(viewedBoard()))
		const visibleSquares = createMemo(() => {
			if (this.gameConfig.variant === 'fog-of-war') {
				return GL.getVisibleSquares(this.stateSignal(), this.bottomPlayer.color)
			}
			// just avoid computing this when not needed
			return new Set()
		})

		this.currentBoardView = {
			get board() {
				return viewedBoard()
			},
			get visibleSquares() {
				return visibleSquares()
			},
			get inCheck() {
				return inCheck()
			},
			get lastMove() {
				return lastMove()
			},
		} as BoardView

		let prevMoveCount = this.state.moveHistory.length
		createEffect(() => {
			if (this.state.moveHistory.length !== prevMoveCount) {
				this.setViewedMove('live')
			}
			prevMoveCount = this.state.moveHistory.length
		})
	}

	get viewingLiveBoard() {
		return this.viewedMoveIndex() === this.state.moveHistory.length - 1
	}

	setViewedMove(move: number | 'live') {
		if (move === 'live') {
			this._setViewedMove(this.state.moveHistory.length - 1)
		} else if (move >= -1 && move < this.state.moveHistory.length) {
			this._setViewedMove(move)
		} else {
			throw new Error(`invalid move index ${move}`)
		}
	}

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
		if (draw !== null) return color as Color
	}
	return null
}

export function getNewGameTransaction(playerId: string): { mutations: SS.StoreMutation[]; events: GameEvent[] } {
	return {
		events: [{ type: 'new-game', playerId }],
		mutations: [
			{ path: ['status'], value: 'playing' },
			{ path: ['moves'], value: [] },
			{ path: ['drawOffers'], value: { white: null, black: null } },
			{ path: ['activeGameId'], value: createId(6) },
			{ path: ['outcome'], value: undefined },
		],
	}
}

//#endregion

export const [game, setGame] = createSignal<Game | null>(null)
