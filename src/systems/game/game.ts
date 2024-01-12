import * as R from '../room.ts'
import * as GL from './gameLogic.ts'
import * as P from '../player.ts'
import { Accessor, createEffect, createMemo, createSignal, from, getOwner, observable, onCleanup, Setter } from 'solid-js'
import { combineLatest, concatMap, distinctUntilChanged, EMPTY, from as rxFrom, Observable, ReplaySubject, skip } from 'rxjs'
import { isEqual } from 'lodash'
import { map } from 'rxjs/operators'
import { storeToSignal } from '~/utils/solid.ts'
import { unwrap } from 'solid-js/store'

export type PlayerWithColor = P.Player & { color: GL.Color }


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

type BoardView = {
	board: GL.Board
	inCheck: boolean
	lastMove: GL.Move | null
	visibleSquares: Set<string>
}
export type DrawEvent = 'offered-by-opponent' | 'awaiting-response' | 'declined' | 'player-cancelled' | 'opponent-cancelled'
export type MoveType = 'move' | 'capture' | 'checkmate'

export class Game {
	setViewedMove: (move: number | 'live') => void
	viewedMoveIndex: Accessor<number>
	drawEvent$: Observable<DrawEvent> = EMPTY
	currentBoardView: BoardView
	gameConfig: GL.GameConfig
	setDuckPlacement: Setter<DuckSelectedMove | null>
	stateSignal: Accessor<GL.GameState>

	private getMoveHistoryAsNotation: Accessor<[string, string | null][]>
	// object returned will be mutated as updates come in

	get outcome() {
		return this.getOutcome()
	}

	constructor(
		public gameId: string,
		public room: R.Room,
		public playerId: string,
		gameConfig: GL.GameConfig
	) {
		if (!getOwner()) throw new Error('Game constructor must be called in reactive context')
		this.gameConfig = JSON.parse(JSON.stringify(gameConfig)) as GL.GameConfig

		//#region promotion
		const [promotion, setPromotion] = createSignal(null)
		this.setPromotion = setPromotion
		this.promotion = promotion
		//#endregion

		//#region duckPlacement
		const [duckPlacement, setDuckPlacement] = createSignal(null as null | GL.Move)
		this.setDuckPlacement = setDuckPlacement
		this.duckPlacement = duckPlacement
		//#endregion

		//#region view history
		const [currentMove, setViewedMove] = createSignal<'live' | number>('live')
		this.viewedMoveIndex = () => (currentMove() === 'live' ? this.state.moveHistory.length - 1 : (currentMove() as number))
		this.setViewedMove = setViewedMove
		//#endregion

		//#region viewedBoard view
		const lastMove = () => this.state.moveHistory[this.viewedMoveIndex()] || null

		// boards are only so we don't need to deeply track this
		const viewedBoard = () => unwrap(this.state.boardHistory[this.viewedMoveIndex() + 1].board)

		this.stateSignal = storeToSignal(this.state)

		const inCheck = createMemo(() => GL.inCheck(viewedBoard()))
		const visibleSquares = createMemo(() => {
			if (this.gameConfig.variant === 'fog-of-war') {
				return GL.getVisibleSquares(this.stateSignal(), this.player.color)
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

		//#region draw offer events
		let prevOffers: GL.GameState['drawOffers'] = JSON.parse(JSON.stringify(this.state.drawOffers))
		let prevDeclinedBy: GL.GameState['drawDeclinedBy'] | null = JSON.parse(JSON.stringify(this.state.drawDeclinedBy))

		this.drawEvent$ = rxFrom(
			observable(
				() =>
					[
						{
							white: this.state.drawOffers.white,
							black: this.state.drawOffers.black,
						} satisfies GL.GameState['drawOffers'],
						this.state.drawDeclinedBy,
					] as const
			)
		).pipe(
			skip(1),
			concatMap(([offers, declinedBy]) => {
				let opponentOffering = offers[this.opponent.color] !== null
				let opponentOfferingPrev = prevOffers[this.opponent.color] !== null
				let playerOffering = offers[this.player.color] !== null
				let playerOfferingPrev = prevOffers[this.player.color] !== null

				let events: DrawEvent[] = []
				if (this.outcome) {
				} else if (declinedBy && !prevDeclinedBy) events.push('declined')
				else if (opponentOffering && !opponentOfferingPrev) events.push('offered-by-opponent')
				else if (playerOffering && !playerOfferingPrev) events.push('awaiting-response')
				else if (!opponentOffering && opponentOfferingPrev) events.push('opponent-cancelled')
				else if (!playerOffering && playerOfferingPrev) events.push('player-cancelled')
				prevOffers = JSON.parse(JSON.stringify(offers))
				prevDeclinedBy = JSON.parse(JSON.stringify(offers))
				return events
			})
		)
		//#endregion

		//#region reset view when move history changes
		let prevMoveCount = this.state.moveHistory.length
		createEffect(() => {
			if (this.state.moveHistory.length !== prevMoveCount) {
				this.setViewedMove('live')
			}
			prevMoveCount = this.state.moveHistory.length
		})
		//#endregion
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
		return this.room.players.map((p) => ({ ...p, color: this.getPlayerColor(p.id) }))
	}

	get player() {
		return this.players.find((p) => p.id === this.playerId)!
	}

	get opponent() {
		return this.players.find((p) => p.id !== this.playerId)!
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

	get isPlayerTurn() {
		return GL.isPlayerTurn(this.board, this.player.color)
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

	tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece, duck?: string) {
		let expectedMoveIndex = this.state.moveHistory.length
		return this.room.sharedStore.setStoreWithRetries(() => {
			console.log('trying move for real')
			const state = unwrap(this.state)
			if (this.viewedMoveIndex() !== state.moveHistory.length - 1 || this.outcome) return
			// check that we're still on the same move
			if (this.state.moveHistory.length !== expectedMoveIndex) return
			let board = GL.getBoard(state)
			if (!GL.isPlayerTurn(board, this.getPlayerColor(this.playerId)) || !board.pieces[from]) return
			let result = GL.validateAndPlayMove(from, to, state, this.parsedGameConfig, promotionPiece, duck)
			if (!result) {
				console.error('invalid move')
				return
			}

			const newBoardIndex = state.boardHistory.length

			const newBoardHistoryEntry: GL.BoardHistoryEntry = {
				board: result!.board,
				index: newBoardIndex,
				hash: GL.hashBoard(result!.board),
			}

			console.log('setting move')
			return [
				{
					path: [...this.gameStatePath, 'boardHistory', newBoardIndex],
					value: newBoardHistoryEntry,
				},
				{ path: [...this.gameStatePath, 'moveHistory', '__push__'], value: result.move },
				{ path: [...this.gameStatePath, 'drawDeclinedBy'], value: null },
				{ path: [...this.gameStatePath, 'drawOffers'], value: { white: null, black: null } },
			]
		})
	}

	//#region draw actions
	offerDraw() {
		const moveOffered = this.state.moveHistory.length
		const offerTime = Date.now()
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || this.state.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(this.state)
			if (drawIsOfferedBy === this.getPlayerColor(this.playerId)) return
			return [{ path: [...this.gameStatePath, 'drawOffers', this.getPlayerColor(this.playerId)], value: offerTime }]
		})
	}

	cancelDraw() {
		const moveOffered = this.lockstepState.moveHistory.length
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || this.lockstepState.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig))
				return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(this.state)
			if (drawIsOfferedBy !== this.getPlayerColor(this.playerId)) return
			return [{ path: [...this.gameStatePath, 'drawOffers', this.getPlayerColor(this.playerId)], value: null }]
		})
	}

	declineDraw() {
		const moveOffered = this.lockstepState.moveHistory.length
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || this.state.moveHistory.length !== moveOffered || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(this.state)
			if (drawIsOfferedBy === this.getPlayerColor(this.playerId) || !this.drawIsOfferedBy) return
			return [
				{
					path: [...this.gameStatePath, 'drawOffers', this.drawIsOfferedBy],
					value: null,
				},
				{
					path: [...this.gameStatePath, 'drawDeclinedBy'],
					value: {
						color: this.getPlayerColor(this.getPlayerColor(this.playerId)),
						ts: Date.now(),
					} satisfies GL.GameState['drawDeclinedBy'],
				},
			]
		})
	}

	//#endregion

	resign() {
		this.room.sharedStore.setStoreWithRetries(() => {
			if (!this.state || GL.getGameOutcome(this.state, this.parsedGameConfig)) return
			return [
				{
					path: [...this.gameStatePath, 'resigned'],
					value: this.getPlayerColor(this.playerId),
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
