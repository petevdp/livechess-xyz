import * as R from '../room.ts'
import * as GL from './gameLogic.ts'
import { BoardHistoryEntry, GameOutcome } from './gameLogic.ts'
import * as P from '../player.ts'
import { Accessor, createEffect, createRoot, createSignal, from, observable, onCleanup, untrack } from 'solid-js'
import { combineLatest, concatMap, distinctUntilChanged, EMPTY, from as rxFrom, Observable, ReplaySubject, skip } from 'rxjs'
import { unwrap } from 'solid-js/store'
import { isEqual } from 'lodash'
import { map } from 'rxjs/operators'
import { trackStore } from '@solid-primitives/deep'

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
}
export type DrawEvent = 'offered-by-opponent' | 'awaiting-response' | 'declined' | 'player-cancelled' | 'opponent-cancelled'

export class Game {
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	setViewedMove: (move: number | 'live') => void
	destroyed = false
	viewedMoveIndex: Accessor<number>
	drawEvent$: Observable<DrawEvent> = EMPTY

	get outcome() {
		return this.getOutcome()
	}
	//#region listeners
	private callWhenDestroyed: (() => void)[] = []

	constructor(
		public room: R.Room,
		public playerId: string,
		public gameConfig: GL.GameConfig
	) {
		const [promotion, setPromotion] = createSignal(null)
		this.setPromotion = setPromotion
		this.promotion = promotion

		//#region view history
		const [currentMove, setViewedMove] = createSignal<'live' | number>('live')
		this.viewedMoveIndex = () => (currentMove() === 'live' ? this.rollbackState.moveHistory.length - 1 : (currentMove() as number))
		this.setViewedMove = setViewedMove
		//#endregion

		this.registerListeners()
	}

	getColorPlayer(color: GL.Color) {
		return this.players.find((p) => p.color === color)!
	}

	get currentBoardView(): BoardView {
		const lastMove = this.rollbackState.moveHistory[this.viewedMoveIndex()] || null
		const entry = this.rollbackState.boardHistory[this.viewedMoveIndex() + 1]

		return {
			board: entry.board,
			inCheck: GL.inCheck(entry.board),
			lastMove,
		}
	}

	private get state() {
		return this.room.state.gameState!
	}

	get rollbackState() {
		return this.room.rollbackState.gameState!
	}

	private get board() {
		return this.rollbackState.boardHistory[this.rollbackState.boardHistory.length - 1].board
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

	get drawIsOfferedBy() {
		return GL.getDrawIsOfferedBy(this.rollbackState)
	}

	get moveHistoryAsNotation() {
		return getMoveHistoryAsNotation(this.rollbackState)
	}

	getPlayerColor(playerId: string) {
		return this.rollbackState.players[playerId]
	}

	async tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
		if (this.viewedMoveIndex() !== this.rollbackState.moveHistory.length - 1 || this.outcome) return
		console.log('trying move', { from, to, promotionPiece })
		let expectedMoveIndex = this.rollbackState.moveHistory.length
		await this.room.sharedStore.setStoreWithRetries((roomState) => {
			const state = roomState.gameState!
			// check that we're still on the same move
			if (state.moveHistory.length !== expectedMoveIndex) return
			let board = GL.getBoard(state)
			if (!GL.isPlayerTurn(board, this.getPlayerColor(this.playerId)) || !board.pieces[from]) return
			let result = GL.validateAndPlayMove(from, to, state, promotionPiece)
			if (!result) {
				console.error('invalid move')
				return
			}

			if (result.promoted && !promotionPiece) {
				this.setPromotion({ status: 'selecting', from, to })
				return
			}

			const newBoardIndex = this.rollbackState.boardHistory.length

			const newBoardHistoryEntry: BoardHistoryEntry = {
				board: result!.board,
				index: newBoardIndex,
				hash: GL.hashBoard(result!.board),
			}

			return [
				{
					path: ['gameState', 'boardHistory', newBoardIndex],
					value: newBoardHistoryEntry,
				},
				{ path: ['gameState', 'moveHistory', '__push__'], value: result.move },
				{ path: ['gameState', 'drawDeclinedBy'], value: null },
				{ path: ['gameState', 'drawOffers'], value: { white: null, black: null } },
			]
		})
		if (this.viewedMoveIndex() !== this.rollbackState.moveHistory.length - 1) {
			this.setViewedMove('live')
		}
	}

	//#region draw actions
	offerDraw() {
		const moveOffered = this.state.moveHistory.length
		const offerTime = Date.now()
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || state.gameState.moveHistory.length !== moveOffered || GL.getGameOutcome(state.gameState)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(state.gameState)
			if (drawIsOfferedBy === this.getPlayerColor(this.playerId)) return
			return [{ path: ['gameState', 'drawOffers', this.getPlayerColor(this.playerId)], value: offerTime }]
		})
	}

	configureNewGame() {
		setGame(null)
		this.destroy()
		this.room.configureNewGame()
	}

	cancelDraw() {
		const moveOffered = this.state.moveHistory.length
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || state.gameState.moveHistory.length !== moveOffered || GL.getGameOutcome(state.gameState)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(state.gameState)
			if (drawIsOfferedBy !== this.getPlayerColor(this.playerId)) return
			return [{ path: ['gameState', 'drawOffers', this.getPlayerColor(this.playerId)], value: null }]
		})
	}

	declineDraw() {
		const moveOffered = this.state.moveHistory.length
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || state.gameState.moveHistory.length !== moveOffered || GL.getGameOutcome(state.gameState)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(state.gameState)
			if (drawIsOfferedBy === this.getPlayerColor(this.playerId)) return
			return [
				{
					path: ['gameState', 'drawOffers', this.drawIsOfferedBy],
					value: null,
				},
				{
					path: ['gameState', 'drawDeclinedBy'],
					value: {
						color: this.getPlayerColor(this.getPlayerColor(this.playerId)),
						ts: Date.now(),
					} satisfies GL.GameState['drawDeclinedBy'],
				},
			]
		})
	}

	//#endregion

	destroy() {
		if (this.destroyed) return
		console.log('tearing down current game')
		this.destroyed = true
		this.callWhenDestroyed.forEach((c) => c())
	}

	resign() {
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || GL.getGameOutcome(state.gameState)) return
			return [
				{
					path: ['gameState', 'resigned'],
					value: this.getPlayerColor(this.playerId),
				},
			]
		})
	}

	private getOutcome: Accessor<GL.GameOutcome | undefined> = () => undefined

	// will be reassigned
	private getClocks = () => ({ white: 0, black: 0 })

	private registerListeners() {
		createRoot((d) => {
			// WARNING make sure this callback runs synchronously, or things will break

			this.callWhenDestroyed.push(d)

			const move$ = observeMoves(this.rollbackState)
			this.getClocks = useClock(move$, this.gameConfig)

			const gameOutcome$ = rxFrom(observable(() => GL.getGameOutcome(this.state)))
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
				map(([outcome, timeouts]): GameOutcome | undefined => {
					if (timeouts.white) return { winner: 'black', reason: 'flagged' }
					if (timeouts.black) return { winner: 'white', reason: 'flagged' }
					return outcome || undefined
				})
			)
			this.getOutcome = from(outcome$)
		})

		//#region draw offer events
		let prevOffers: GL.GameState['drawOffers'] = JSON.parse(JSON.stringify(this.rollbackState.drawOffers))
		let prevDeclinedBy: GL.GameState['drawDeclinedBy'] | null = JSON.parse(JSON.stringify(this.rollbackState.drawDeclinedBy))

		this.drawEvent$ = rxFrom(
			observable(() => [trackStore(this.rollbackState.drawOffers), this.rollbackState.drawDeclinedBy] as const)
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
	}

	//#endregion
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

function useClock(move$: Observable<GL.Move>, gameConfig: GL.GameConfig) {
	let startingTime = GL.timeControlToMs(gameConfig.timeControl)
	const [white, setWhite] = createSignal(startingTime)
	const [black, setBlack] = createSignal(startingTime)
	let lastMoveTs = 0
	let toPlay: GL.Color = 'white'

	const sub = move$.subscribe((move) => {
		// this means that time before the first move is not counted towards the player's clock
		if (lastMoveTs !== 0) {
			const lostTime = move.ts - lastMoveTs - parseInt(gameConfig.increment) * 1000
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

	onCleanup(() => {
		clearInterval(timeout)
		sub.unsubscribe()
	})

	return clocks
}

//TODO is promotion handled correctly?
//TODO I don't think we handle pins correctly
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

function setupGame() {}

createRoot(() => {
	createEffect(() => {
		const room = R.room()
		if (!room || room.state.status !== 'playing') return
		untrack(() => {
			game()?.destroy()
			const gameConfig = unwrap(room.state.gameConfig)
			setGame(new Game(room, P.playerId()!, gameConfig))
		})
	})
})
