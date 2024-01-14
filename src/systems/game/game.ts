import { until } from '@solid-primitives/promise'
import { isEqual } from 'lodash'
import { Observable, ReplaySubject, combineLatest, concatMap, distinctUntilChanged, from as rxFrom } from 'rxjs'
import { map } from 'rxjs/operators'
import { Accessor, createEffect, createMemo, createSignal, from, getOwner, observable, onCleanup } from 'solid-js'
import { unwrap } from 'solid-js/store'

import { storeToSignal, trackAndUnwrap } from '~/utils/solid.ts'

import * as P from '../player.ts'
import * as R from '../room.ts'
import * as GL from './gameLogic.ts'


export type PlayerWithColor = P.Player & { color: GL.Color }

type BoardView = {
	board: GL.Board
	inCheck: boolean
	lastMove: GL.Move | null
	visibleSquares: Set<string>
}
const DRAW_EVENTS = ['draw-offered', 'draw-accepted', 'draw-declined', 'draw-canceled'] as const
export type DrawEventType = (typeof DRAW_EVENTS)[number]
export type DrawEvent = { type: DrawEventType; participant: R.GameParticipant }

export type MoveEvent = {
	type: 'make-move'
	participant: R.GameParticipant
	move: GL.Move
}

export type MakeMoveResult =
	| { type: 'invalid' }
	| { type: 'accepted'; move: GL.Move }
	| {
			type: 'promoting' | 'placing-duck'
			// in progress move
			move: GL.Move
	  }

export class Game {
	setViewedMove: (move: number | 'live') => void
	viewedMoveIndex: Accessor<number>
	drawEvent$: Observable<DrawEvent>
	moveEvent$: Observable<MoveEvent>
	currentBoardView: BoardView
	gameConfig: GL.GameConfig
	stateSignal: Accessor<GL.GameState>

	private getMoveHistoryAsNotation: Accessor<[string, string | null][]>
	// object returned will be mutated as updates come in
	currentMove: GL.SelectedMove | null = null
	currentPromotion: GL.PromotionPiece | null = null
	setChoosingPromotion: (choosing: boolean) => void
	choosingPromotion: Accessor<false>
	placingDuck: Accessor<false>
	setPlacingDuck: (placing: boolean) => void
	currentDuckPlacement: string | null = null
	boardWithCurrentMove: Accessor<null | GL.Board>
	setBoardWithCurrentMove: (board: null | GL.Board) => void

	get outcome() {
		return this.getOutcome()
	}

	constructor(
		public gameId: string,
		public room: R.Room,
		gameConfig: GL.GameConfig
	) {
		if (!getOwner()) throw new Error('Game constructor must be called in reactive context')
		this.gameConfig = JSON.parse(JSON.stringify(gameConfig)) as GL.GameConfig

		//#region currentMove input state
		;[this.boardWithCurrentMove, this.setBoardWithCurrentMove] = createSignal(null as null | GL.Board)
		;[this.choosingPromotion, this.setChoosingPromotion] = createSignal(false)
		;[this.placingDuck, this.setPlacingDuck] = createSignal(false)
		//#endregion

		//#region view history
		const [currentMove, setViewedMove] = createSignal<'live' | number>('live')
		this.viewedMoveIndex = () => (currentMove() === 'live' ? this.state.moveHistory.length - 1 : (currentMove() as number))
		this.setViewedMove = setViewedMove
		//#endregion

		//#region viewedBoard view
		const lastMove = () => this.state.moveHistory[this.viewedMoveIndex()] || null

		// boards are only so we don't need to deeply track this
		const viewedBoard = () => {
			if (this.boardWithCurrentMove() && this.viewingLiveBoard) {
				return this.boardWithCurrentMove()!
			} else {
				return trackAndUnwrap(this.state.boardHistory[this.viewedMoveIndex() + 1].board)
			}
		}

		this.stateSignal = storeToSignal(this.state)

		const inCheck = createMemo(() => GL.inCheck(viewedBoard()))
		const visibleSquares = createMemo(() => {
			if (this.gameConfig.variant === 'fog-of-war') {
				return GL.getVisibleSquares(this.stateSignal(), this.topPlayer.color)
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

		//#endregion

		//#region outcome and clock
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

		const outcome$ = combineLatest([gameOutcome$, timeout$]).pipe(
			map(([outcome, timeouts]): GL.GameOutcome | undefined => {
				if (timeouts.white) return { winner: 'black', reason: 'flagged' }
				if (timeouts.black) return { winner: 'white', reason: 'flagged' }
				return outcome || undefined
			})
		)
		this.getOutcome = from(outcome$)
		//#endregion

		//#region handle draw offer events
		this.drawEvent$ = this.room.action$.pipe(
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
		this.moveEvent$ = this.room.action$.pipe(
			concatMap((action): MoveEvent[] => {
				const participant = this.room.participants.find((p) => p.id === action.player.id)
				if (action.type !== 'make-move' || !participant) return []
				return [
					{
						type: action.type as DrawEventType,
						participant: participant,
						move: this.lockstepState.moveHistory[this.viewedMoveIndex()],
					},
				]
			})
		)

		//#endregion

		//#region reset view when currentMove history changes
		let prevMoveCount = this.state.moveHistory.length
		createEffect(() => {
			if (this.state.moveHistory.length !== prevMoveCount) {
				this.setViewedMove('live')
			}
			prevMoveCount = this.state.moveHistory.length
		})
		//#endregion
	}

	get viewingLiveBoard() {
		return this.viewedMoveIndex() === this.state.moveHistory.length - 1
	}

	getColorPlayer(color: GL.Color) {
		return this.players.find((p) => p.color === color)!
	}

	get state() {
		return this.room.rollbackState.gameStates[this.gameId]
	}

	get moveHistoryAsNotation() {
		return this.getMoveHistoryAsNotation()
	}

	get parsedGameConfig() {
		return GL.parseGameConfig(this.gameConfig)
	}

	get drawIsOfferedBy() {
		return GL.getDrawIsOfferedBy(this.state)
	}

	get players() {
		return this.room.members.map((p) => ({
			...p,
			color: this.getPlayerColor(p.id),
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

	get clock() {
		return this.getClocks()
	}

	get board() {
		return this.state.boardHistory[this.state.boardHistory.length - 1].board
	}

	private get lockstepState() {
		return this.room.state.gameStates[this.gameId]
	}

	isPlayerTurn(color: GL.Color) {
		return GL.isPlayerTurn(this.board, color)
	}

	private get gameStatePath(): string[] {
		return ['gameStates', this.gameId]
	}

	getLegalMovesForSquare(startingSquare: string) {
		if (!this.board.pieces[startingSquare]) return []
		return GL.getLegalMoves([GL.coordsFromNotation(startingSquare)], this.stateSignal(), this.gameConfig.variant === 'fog-of-war')
	}

	capturedPieces(color: GL.Color) {
		function getPieceCounts(pieces: GL.Piece[]) {
			const counts = {} as Record<GL.Piece, number>

			for (let piece of pieces) {
				counts[piece] = (counts[piece] || 0) + 1
			}

			return counts
		}

		const pieceCounts = getPieceCounts(
			Object.values(GL.startPos().pieces)
				.filter((p) => p.color === color)
				.map((p) => p.type)
		)
		const currentPieceCounts = getPieceCounts(
			Object.values(this.board.pieces)
				.filter((p) => p.color === color)
				.map((p) => p.type)
		)

		for (let [key, count] of Object.entries(currentPieceCounts)) {
			//@ts-ignore
			pieceCounts[key] -= count
		}

		const capturedPieces: GL.ColoredPiece[] = []

		for (let [key, count] of Object.entries(pieceCounts)) {
			for (let i = 0; i < count; i++) {
				//@ts-ignore
				capturedPieces.push({ type: key, color })
			}
		}

		return capturedPieces
	}

	getPlayerColor(playerId: string) {
		return this.state.players[playerId]
	}

	async tryMakeMove(move?: GL.SelectedMove): Promise<MakeMoveResult> {
		if (!this.isClientPlayerParticipating) return { type: 'invalid' }
		if (!move && !this.currentMove) return { type: 'invalid' }
		if (move) {
			this.currentMove = move
		}
		if (this.outcome || !this.currentMove) return { type: 'invalid' }
		const res = GL.validateAndPlayMove(
			this.currentMove.from,
			this.currentMove.to,
			this.stateSignal(),
			!!this.currentDuckPlacement || GL.VARIANTS_ALLOWING_SELF_CHECKS.includes(this.gameConfig.variant),
			this.currentPromotion || undefined,
			this.currentDuckPlacement || undefined
		)
		if (!res) {
			this.currentDuckPlacement = null
			return { type: 'invalid' }
		}
		if (move) {
			if (res.promoted && !this.currentPromotion) {
				// while we're promoting, display the promotion square as containing the pawn
				res.board.pieces[this.currentMove.to] = {
					type: 'pawn',
					color: this.board.toMove,
				}
			}

			// this displays whatever move we've made while we're placing the duck as well
			this.setBoardWithCurrentMove(res.board)
		}

		// this is a dumb way of doing this, we should return validation errors from validateAndPlayMove instead
		if (res?.promoted && !this.currentPromotion) {
			this.setChoosingPromotion(true)
			this.setBoardWithCurrentMove(res.board)
			return { type: 'promoting', move: res.move }
		}
		this.setChoosingPromotion(false)

		if (this.gameConfig.variant === 'duck' && !this.currentDuckPlacement) {
			this.setPlacingDuck(true)
			this.setBoardWithCurrentMove(res.board)
			let prevDuckPlacement = Object.keys(res.board.pieces).find((square) => res.board.pieces[square]!.type === 'duck')
			if (prevDuckPlacement) {
				// render previous duck while we're placing the new one, so it's clear that the duck can't be placed in the same spot twice
				res.board.pieces[prevDuckPlacement] = GL.DUCK
			}
			return { type: 'placing-duck', move: res.move }
		}

		let expectedMoveIndex = this.state.moveHistory.length
		const currentMove = this.currentMove!
		const currentPromotion = this.currentPromotion
		const currentDuckPlacement = this.currentDuckPlacement
		this.currentMove = null
		this.currentPromotion = null
		this.currentDuckPlacement = null
		this.setChoosingPromotion(false)
		this.setPlacingDuck(false)
		this.setBoardWithCurrentMove(null)
		let [acceptedMove, setAcceptedMove] = createSignal(null as null | GL.Move)
		this.room.sharedStore.setStoreWithRetries(() => {
			console.log('trying move for real')
			const state = unwrap(this.state)
			if (this.viewedMoveIndex() !== state.moveHistory.length - 1 || this.outcome) return
			// check that we're still on the same move
			if (this.state.moveHistory.length !== expectedMoveIndex) return
			let board = GL.getBoard(state)
			if (!GL.isPlayerTurn(board, this.bottomPlayer.color) || !board.pieces[currentMove.from]) return
			const result = GL.validateAndPlayMove(
				currentMove.from,
				currentMove.to,
				state,
				GL.VARIANTS_ALLOWING_SELF_CHECKS.includes(this.gameConfig.variant),
				currentPromotion || undefined,
				currentDuckPlacement || undefined
			)
			if (!result) {
				console.error('invalid move', this.currentMove, this.currentPromotion, this.currentDuckPlacement)
				return
			}
			console.log('setting accepted move', result.move)
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
						path: [...this.gameStatePath, 'moveHistory', '__push__'],
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
		console.log('waiting for move to be accepted')
		return { type: 'accepted', move: await until(() => acceptedMove()) }
	}

	//#region draw actions
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

	//#endregion

	resign() {
		if (!this.isClientPlayerParticipating) return
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			return [
				{
					path: [...this.gameStatePath, 'resigned'],
					value: this.bottomPlayer.id,
				},
			]
		})
	}

	private getOutcome: Accessor<GL.GameOutcome | undefined> = () => undefined

	// will be reassigned
	private getClocks = () => ({ white: 0, black: 0 })
}

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
	let startingTime = gameConfig.timeControl
	const [white, setWhite] = createSignal(startingTime)
	const [black, setBlack] = createSignal(startingTime)
	let lastMoveTs = 0
	let toPlay: GL.Color = 'white'

	const sub = move$.subscribe((move) => {
		if (gameEnded()) return
		// this means that time before the first move is not counted towards the player's clock
		if (lastMoveTs !== 0) {
			const lostTime = move.ts - lastMoveTs - gameConfig.increment
			if (toPlay === 'white') {
				setWhite(Math.min(white() - lostTime, startingTime))
			} else {
				setBlack(Math.min(black() - lostTime, startingTime))
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

//TODO is promotion handled correctly?
//TODO W don't handle disambiguation
function getMoveHistoryAsNotation(state: GL.GameState) {
	let moves: [string, string | null][] = []
	for (let i = 0; i < Math.ceil(state.moveHistory.length / 2); i++) {
		const whiteMove = GL.moveToChessNotation(i * 2, state)
		if (i * 2 + 1 >= state.moveHistory.length) {
			moves.push([whiteMove, null])
			break
		}
		const blackMove = GL.moveToChessNotation(i * 2 + 1, state)
		moves.push([whiteMove, blackMove])
	}
	return moves
}

export const [game, setGame] = createSignal<Game | null>(null)
