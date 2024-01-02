import * as R from '../room.ts'
import * as GL from './gameLogic.ts'
import { BoardHistoryEntry } from './gameLogic.ts'
import * as P from '../player.ts'
import { Accessor, createEffect, createMemo, createRoot, createSignal, onCleanup, untrack } from 'solid-js'
import { Observable, ReplaySubject } from 'rxjs'
import { unwrap } from 'solid-js/store'

export type PlayerWithColor = P.Player & { color: GL.Color }
export type Clock = Record<GL.Color, number>

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

export class Game {
	promotion: Accessor<PromotionSelection | null>
	setPromotion: (p: PromotionSelection | null) => void
	setViewedMove: (move: number | 'live') => void
	viewedMoveIndex: Accessor<number>
	private getOutcome: Accessor<GL.GameOutcome | null>
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

		this.getOutcome = createMemo(() => GL.getGameOutcome(this.state))
		const [currentMove, setViewedMove] = createSignal<'live' | number>('live')

		this.viewedMoveIndex = () => (currentMove() === 'live' ? this.rollbackState.moveHistory.length - 1 : (currentMove() as number))
		this.setViewedMove = setViewedMove
		this.registerListeners()
	}

	get outcome(): GL.GameOutcome | null {
		if (this.clock.white <= 0) return { winner: 'black', reason: 'flagged' }
		if (this.clock.black <= 0) return { winner: 'white', reason: 'flagged' }
		return this.getOutcome()
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
		return this.state.players[playerId]
	}

	async tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
		if (this.viewedMoveIndex() !== this.rollbackState.moveHistory.length - 1) return
		console.log('trying move', { from, to, promotionPiece })
		let expectedMoveIndex = this.state.moveHistory.length
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

			const newBoardIndex = this.state.boardHistory.length

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
				{ path: ['gameState', 'moveHistory', this.state.moveHistory.length], value: result.move },
				{ path: ['gameState', 'drawDeclinedBy'], value: null },
				{ path: ['gameState', 'drawOffers'], value: { white: false, black: false } },
			]
		})
		if (this.viewedMoveIndex() !== this.rollbackState.moveHistory.length - 1) {
			this.setViewedMove('live')
		}
	}

	//#region draw actions
	offerDraw() {
		const moveOffered = this.state.moveHistory.length
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || state.gameState.moveHistory.length !== moveOffered || GL.getGameOutcome(state.gameState)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(state.gameState)
			if (drawIsOfferedBy === this.getPlayerColor(this.playerId)) return
			return [{ path: ['gameState', 'drawOffers', this.getPlayerColor(this.playerId)], value: true }]
		})
	}

	cancelDraw() {
		const moveOffered = this.state.moveHistory.length
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || state.gameState.moveHistory.length !== moveOffered || GL.getGameOutcome(state.gameState)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(state.gameState)
			if (drawIsOfferedBy !== this.getPlayerColor(this.playerId)) return
			return [{ path: ['gameState', 'drawOffers', this.getPlayerColor(this.playerId)], value: false }]
		})
	}

	//#endregion

	declineDraw() {
		const moveOffered = this.state.moveHistory.length
		this.room.sharedStore.setStoreWithRetries((state) => {
			if (!state.gameState || state.gameState.moveHistory.length !== moveOffered || GL.getGameOutcome(state.gameState)) return
			const drawIsOfferedBy = GL.getDrawIsOfferedBy(state.gameState)
			if (drawIsOfferedBy === this.getPlayerColor(this.playerId)) return
			return [
				{
					path: ['gameState', 'drawOffers', this.drawIsOfferedBy],
					value: false,
				},
				{ path: ['gameState', 'drawDeclinedBy'], value: this.getPlayerColor(this.getPlayerColor(this.playerId)) },
			]
		})
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

	destroy() {
		this.callWhenDestroyed.forEach((c) => c())
	}

	// will be reassigned
	private getClocks = () => ({ white: 0, black: 0 })

	private registerListeners() {
		createRoot((d) => {
			this.callWhenDestroyed.push(d)

			const move$ = observeMoves(this.state)
			this.getClocks = useClock(move$, this.gameConfig)
		})
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
		return times
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

const [_game, setGame] = createSignal<Game | null>(null)
export const game = _game

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
