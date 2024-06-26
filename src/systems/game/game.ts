import { until } from '@solid-primitives/promise'
import { isEqual } from 'lodash-es'
import { Observable, ReplaySubject, combineLatest, concatMap, distinctUntilChanged, from as rxFrom, skip } from 'rxjs'
import { map } from 'rxjs/operators'
import { Accessor, createEffect, createMemo, createSignal, from, getOwner, observable, onCleanup } from 'solid-js'
import { unwrap } from 'solid-js/store'

import { PUSH } from '~/utils/sharedStore.ts'
import { storeToSignal, trackAndUnwrap } from '~/utils/solid.ts'
import { unit } from '~/utils/unit.ts'

import * as P from '../player.ts'
import * as R from '../room.ts'
import * as GL from './gameLogic.ts'
import { MoveDisambiguation } from './gameLogic.ts'

//#region types
export type PlayerWithColor = P.Player & { color: GL.Color }
export type BoardView = {
	board: GL.Board
	inCheck: boolean
	lastMove: GL.Move | null
	visibleSquares: Set<string>
}
const DRAW_EVENTS = ['draw-offered', 'draw-accepted', 'draw-declined', 'draw-canceled'] as const
export type DrawEventType = (typeof DRAW_EVENTS)[number]
export type DrawEvent = { type: DrawEventType; participant: R.GameParticipant }
export type MoveEvent = { type: 'make-move'; participant: R.GameParticipant; moveIndex: number }

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

//#endregion

/**
 * Interprets and updates the state of a single game
 */
export class Game {
	gameConfig: GL.GameConfig

	constructor(
		public gameId: string,
		public room: R.Room,
		gameConfig: GL.GameConfig
	) {
		if (!getOwner()) throw new Error('Game constructor must be called in reactive context')
		this.gameConfig = JSON.parse(JSON.stringify(gameConfig)) as GL.GameConfig

		this.setupStateSignal()
		this.setupBoardView()
		this.setupOutcomeAndClocks()
		this.setupDrawEvents()
		this.setupMoveSelectionAndValidation()
	}

	//#region move selection, validation and updates

	currentMove = unit as unknown as Accessor<GL.SelectedMove | null>
	setCurrentMove = unit as (move: GL.SelectedMove | null) => void
	setCurrentDisambiguation = unit as (disambiguation: null | MoveDisambiguation) => void
	placingDuck = unit as unknown as Accessor<false>
	setPlacingDuck = unit as (placing: boolean) => void
	currentDuckPlacement: string | null = null
	private currentDisambiguation = unit as unknown as Accessor<null | MoveDisambiguation>
	private boardWithCurrentMove = unit as unknown as Accessor<null | GL.Board>
	setBoardWithCurrentMove = unit as (board: null | GL.Board) => void
	private _candidateMovesForSelected = unit as unknown as Accessor<any[] | GL.CandidateMove[]>

	setupMoveSelectionAndValidation() {
		;[this.currentMove, this.setCurrentMove] = createSignal(null as null | GL.SelectedMove)
		;[this.boardWithCurrentMove, this.setBoardWithCurrentMove] = createSignal(null as null | GL.Board)
		;[this.currentDisambiguation, this.setCurrentDisambiguation] = createSignal(null as null | MoveDisambiguation)
		;[this.placingDuck, this.setPlacingDuck] = createSignal(false)

		this._candidateMovesForSelected = () => {
			const currentMove = this.currentMove()
			if (!currentMove) return []
			return this.getLegalMovesForSquare(currentMove.from).filter((move) => GL.notationFromCoords(move.to) === currentMove!.to)
		}
	}

	get currentMoveAmbiguity(): MoveAmbiguity | null {
		const currentMove = this.currentMove()
		if (!currentMove || this.currentDisambiguation()) return null
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

	get move$() {
		return this.drawEvent$
	}

	getLegalMovesForSquare(startingSquare: string) {
		if (!this.board.pieces[startingSquare]) return []
		return GL.getLegalMoves(
			[GL.coordsFromNotation(startingSquare)],
			this.stateSignal(),
			GL.VARIANTS_ALLOWING_SELF_CHECKS.includes(this.gameConfig.variant)
		)
	}

	async tryMakeMove(move?: GL.SelectedMove): Promise<MakeMoveResult> {
		if (!this.isClientPlayerParticipating) return { type: 'invalid' }
		if (move) this.setCurrentMove(move)
		if (this.outcome || !this.currentMove) return { type: 'invalid' }
		const currentMove = this.currentMove()!
		const getResult = () =>
			GL.validateAndPlayMove(
				currentMove.from,
				currentMove.to,
				this.stateSignal(),
				GL.VARIANTS_ALLOWING_SELF_CHECKS.includes(this.gameConfig.variant),
				this.currentDisambiguation() || undefined,
				this.currentDuckPlacement || undefined
			)

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

		const disambiguation = this.currentDisambiguation()
		this.setCurrentDisambiguation(null)
		const expectedMoveIndex = this.state.moveHistory.length
		const currentDuckPlacement = this.currentDuckPlacement
		this.setCurrentMove(null)
		this.currentDuckPlacement = null
		this.setPlacingDuck(false)
		this.setBoardWithCurrentMove(null)
		const [acceptedMove, setAcceptedMove] = createSignal(null as null | GL.Move)
		this.room.sharedStore.setStoreWithRetries(() => {
			const state = unwrap(this.state)
			if (this.viewedMoveIndex() !== state.moveHistory.length - 1 || this.outcome) return
			// check that we're still on the same currentMove
			if (this.state.moveHistory.length !== expectedMoveIndex) return
			const board = GL.getBoard(state)
			if (!GL.isPlayerTurn(board, this.bottomPlayer.color) || !board.pieces[currentMove.from]) return
			const result = GL.validateAndPlayMove(
				currentMove.from,
				currentMove.to,
				state,
				GL.VARIANTS_ALLOWING_SELF_CHECKS.includes(this.gameConfig.variant),
				disambiguation || undefined,
				currentDuckPlacement || undefined
			)
			if (!result) {
				return
			}
			setAcceptedMove(result.move)

			const newBoardIndex = state.boardHistory.length

			const newBoardHistoryEntry: GL.BoardHistoryEntry = {
				board: result!.board,
				index: newBoardIndex,
				hash: GL.hashBoard(result!.board),
			}

			return {
				events: [{ type: 'make-move', playerId: this.bottomPlayer.id, moveIndex: this.state.moveHistory.length }],
				mutations: [
					{
						path: [...this.gameStatePath, 'boardHistory', newBoardIndex],
						value: newBoardHistoryEntry,
					},
					{
						path: [...this.gameStatePath, 'moveHistory', PUSH],
						value: result.move,
					},
					{ path: [...this.gameStatePath, 'drawDeclinedBy'], value: null },
					{
						path: [...this.gameStatePath, 'drawOffers'],
						value: { white: null, black: null },
					},
				],
			}
		})
		return { type: 'accepted', move: await until(() => acceptedMove()) }
	}

	//#endregion

	//#region board view and history
	currentBoardView = {} as BoardView
	private _setViewedMove = unit as unknown as (move: number | 'live') => void
	viewedMoveIndex = unit as unknown as Accessor<number>
	private getMoveHistoryAsNotation = unit as Accessor<[string, string | null][]>

	get moveHistoryAsNotation() {
		return this.getMoveHistoryAsNotation()
	}

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
				return trackAndUnwrap(this.state.boardHistory[this.viewedMoveIndex() + 1].board)
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

		this.getMoveHistoryAsNotation = createMemo(() => getMoveHistoryAsNotation(this.stateSignal()))

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

	get moveEvent$() {
		return this.room.event$.pipe(
			concatMap((event): MoveEvent[] => {
				const participant = this.room.participants.find((p) => p.id === event.player.id)
				if (event.type !== 'make-move' || !participant) return []
				return [
					{
						type: 'make-move',
						participant: participant,
						moveIndex: event.moveIndex,
					},
				]
			})
		)
	}

	setViewedMove(move: number | 'live') {
		if (move === 'live') {
			this._setViewedMove(this.state.moveHistory.length - 1)
		} else if (move >= -1 && move < this.state.moveHistory.length) {
			this._setViewedMove(move)
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

	//#region clocks and outcome
	private getOutcome: Accessor<GL.GameOutcome | undefined> = () => undefined

	private getClocks = () => ({ white: 0, black: 0 })

	setupOutcomeAndClocks() {
		const move$ = observeMoves(this.state)
		this.getClocks = useClock(move$, this.parsedGameConfig, () => !!this.outcome)

		const gameOutcome$ = rxFrom(observable(() => GL.getGameOutcome(this.stateSignal(), this.parsedGameConfig)))
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
			distinctUntilChanged(isEqual)
		)

		let outcome$: Observable<GL.GameOutcome | undefined>
		if (this.gameConfig.timeControl === 'unlimited') {
			outcome$ = gameOutcome$.pipe(map((outcome) => outcome || undefined))
		} else {
			outcome$ = combineLatest([gameOutcome$, timeout$]).pipe(
				map(([outcome, timeouts]): GL.GameOutcome | undefined => {
					// timeouts are ignored if the game has been resolved in some other way
					if (outcome) return outcome
					if (timeouts.white) return { winner: 'black', reason: 'flagged' }
					if (timeouts.black) return { winner: 'white', reason: 'flagged' }
					// (both players will never run out of time simultaneously)
					return undefined
				})
			)
		}
		this.getOutcome = from(outcome$)
	}

	get clock() {
		return this.getClocks()
	}

	get outcome() {
		return this.getOutcome()
	}

	get outcome$() {
		return rxFrom(observable(() => this.outcome)).pipe(skip(1))
	}

	//#endregion

	//#region draws and resignation

	get drawEvent$() {
		return this.room.event$.pipe(
			concatMap((action): DrawEvent[] => {
				const participant = this.room.participants.find((p) => p.id === action.player.id)
				if (!DRAW_EVENTS.includes(action.type as DrawEventType) || !participant) return []
				return [
					{
						type: action.type as DrawEventType,
						participant: participant,
					},
				]
			})
		)
	}

	setupDrawEvents() {}

	offerOrAcceptDraw() {
		if (!this.isClientPlayerParticipating) return
		const moveOffered = this.state.moveHistory.length
		const offerTime = Date.now()
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || this.state.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(this.state)
			if (drawIsOfferedBy === this.bottomPlayer.color) return
			const eventType = drawIsOfferedBy ? 'draw-accepted' : 'draw-offered'
			return {
				events: [{ type: eventType, playerId: this.bottomPlayer.id }],
				mutations: [
					{
						path: [...this.gameStatePath, 'drawOffers', this.bottomPlayer.color],
						value: offerTime,
					},
				],
			}
		})
	}

	cancelDraw() {
		if (!this.isClientPlayerParticipating) return
		const moveOffered = this.lockstepState.moveHistory.length
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || this.lockstepState.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig))
				return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(this.state)
			if (drawIsOfferedBy !== this.bottomPlayer.color) return
			return {
				events: [{ type: 'draw-canceled', playerId: this.bottomPlayer.id }],
				mutations: [
					{
						path: [...this.gameStatePath, 'drawOffers', this.bottomPlayer.color],
						value: null,
					},
				],
			}
		})
	}

	declineDraw() {
		if (!this.isClientPlayerParticipating) return
		const moveOffered = this.lockstepState.moveHistory.length
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || this.state.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(this.state)
			if (drawIsOfferedBy === this.bottomPlayer.color || !this.drawIsOfferedBy) return
			return {
				events: [{ type: 'draw-declined', playerId: this.bottomPlayer.id }],
				mutations: [
					{
						path: [...this.gameStatePath, 'drawOffers', this.drawIsOfferedBy],
						value: null,
					},
					{
						path: [...this.gameStatePath, 'drawDeclinedBy'],
						value: {
							color: this.bottomPlayer.color,
							ts: Date.now(),
						} satisfies GL.GameState['drawDeclinedBy'],
					},
				],
			}
		})
	}

	resign() {
		if (!this.isClientPlayerParticipating) return
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			return [
				{
					path: [...this.gameStatePath, 'resigned'],
					value: this.bottomPlayer.color,
				},
			]
		})
	}

	get drawIsOfferedBy() {
		return GL.getDrawIsOfferedBy(this.state)
	}

	//#endregion

	//#region generic helpers

	get state() {
		return this.room.rollbackState.gameStates[this.gameId]
	}

	stateSignal = unit as unknown as Accessor<GL.GameState>

	setupStateSignal() {
		this.stateSignal = storeToSignal(this.state)
	}

	get parsedGameConfig() {
		return GL.parseGameConfig(this.gameConfig)
	}

	get players() {
		return this.room.members.map((p) => ({
			...p,
			color: this.state.players[p.id],
		}))
	}

	get isClientPlayerParticipating() {
		return Object.keys(this.state.players).includes(this.room.player.id)
	}

	// either the client player or white if the client player is spectating
	get bottomPlayer() {
		if (this.isClientPlayerParticipating) return this.players.find((p) => p.id === this.room.player.id)!
		return this.players.find((p) => p.color === 'white')!
	}

	get topPlayer() {
		if (this.isClientPlayerParticipating) return this.players.find((p) => p.id !== this.room.player.id)!
		return this.players.find((p) => p.color === 'black')!
	}

	get board() {
		return this.state.boardHistory[this.state.boardHistory.length - 1].board
	}

	private get lockstepState() {
		return this.room.state.gameStates[this.gameId]
	}

	private get gameStatePath(): string[] {
		return ['gameStates', this.gameId]
	}

	isPlayerTurn(color: GL.Color) {
		return GL.isPlayerTurn(this.board, color)
	}

	//#endregion
}

//#region helpers
function observeMoves(gameState: GL.GameState) {
	const subject = new ReplaySubject<GL.Move>()
	let lastObserved = -1
	createEffect(() => {
		for (let i = lastObserved + 1; i < gameState.moveHistory.length; i++) {
			subject.next(gameState.moveHistory[i])
		}
		lastObserved = gameState.moveHistory.length - 1
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

	const timeout = setInterval(elapsedListener, 100)

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

function getMoveHistoryAsNotation(state: GL.GameState) {
	const moves: [string, string | null][] = []
	for (let i = 0; i < Math.ceil(state.moveHistory.length / 2); i++) {
		const whiteMove = GL.moveToAlgebraicNotation(i * 2, state)
		if (i * 2 + 1 >= state.moveHistory.length) {
			moves.push([whiteMove, null])
			break
		}
		const blackMove = GL.moveToAlgebraicNotation(i * 2 + 1, state)
		moves.push([whiteMove, blackMove])
	}
	return moves
}

//#endregion

export const [game, setGame] = createSignal<Game | null>(null)
