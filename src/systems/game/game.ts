import { Observable, filter } from 'rxjs'
import { map } from 'rxjs/operators'
import { Accessor, createMemo, createRoot, createSignal, getOwner, on, onCleanup } from 'solid-js'
import { unwrap } from 'solid-js/store'

import * as SS from '~/sharedStore/sharedStore.ts'
import * as DS from '~/systems/debugSystem'
import { createId } from '~/utils/ids.ts'
import { deepClone } from '~/utils/obj.ts'
import { SignalProperty, createSignalProperty } from '~/utils/solid.ts'

import { log } from '../logger.browser.ts'
import * as P from '../player.ts'
import * as GL from './gameLogic.ts'
import * as GO from './gameOps.ts'

//#region types
export type { GameEvent, DrawEventType, GameParticipant, RootGameState } from './gameOps.ts'
export { DRAW_EVENTS, getDrawIsOfferedBy } from './gameOps.ts'

export type PlayerWithColor = P.Player & { color: GL.Color }
export type BoardView = {
	board: GL.Board
	lastMove: GL.Move | null
	moveIndex: number
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

export type GameParticipantWithDetails = GO.GameParticipant & { name: string }

// any store whose state embeds the game state and whose ops include the game ops satisfies this
// (the room store does, and the vs-bot store is exactly this)
export type GameStore = SS.SharedStore<GO.RootGameState, GO.GameOp, GO.GameEvent>

export interface RootGameContext {
	state: GO.RootGameState
	sharedStore: GameStore
	members: P.Player[]

	backToPregame(): void
	event$: Observable<GO.GameEvent>

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
		return this.gameContext.state.activeGameId === this.gameId
	}

	stateSignal!: Accessor<GL.GameState>

	get state(): GL.GameState {
		return this.stateSignal()
	}

	inProgressMoveLocal!: SignalProperty<GL.InProgressMove | undefined>
	boardWithInProgressMove!: Accessor<GL.Board>

	setupGameState() {
		// the move list is a raw path: a plain array behind a reference-equality signal, no proxying
		const moveHistory = () => this.gameContext.sharedStore.raw.moves ?? []
		const boardHistory = GL.useBoardHistory(moveHistory, GL.getStartPos(this.gameConfig))

		// only update state on board history change because syncing chained signals can be annoying
		this.stateSignal = createMemo(
			on(boardHistory, (boardHistory) => {
				const state: GL.GameState = {
					boardHistory: boardHistory,
					moveHistory: moveHistory(),
					players: {
						[this.gameContext.state.gameParticipants.white.id]: 'white',
						[this.gameContext.state.gameParticipants.black.id]: 'black',
					}!,
				}
				return state
			})
		)

		DS.addHook('board', () => this.board, getOwner()!)

		this.inProgressMoveLocal = createSignalProperty<GL.InProgressMove | undefined>(
			this.isThisPlayersTurn() ? this.gameContext.state.inProgressMove : undefined
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
		return this.gameContext.state.inProgressMove
	}
	get comittedInProgressMove() {
		return this.gameContext.state.inProgressMove
	}
	setBaseInProgressMove(move: { from: string; to: string }) {
		this.inProgressMoveLocal.set(move)
	}

	// broadcasts in progress move to other clients
	async commitInProgressMove() {
		const move = this.inProgressMoveLocal.get()
		if (!this.isActiveGame || !this.isThisPlayersTurn() || !move) return
		await this.gameContext.sharedStore.dispatch({
			code: 'commit-in-progress-move',
			playerId: this.bottomPlayer.id,
			gameId: this.gameId,
			move,
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
		const state = this.stateSignal()
		const result = GL.validateAndPlayMove(move, state, this.gameConfig.variant)
		if (!result) {
			throw new Error(`invalid move: ${JSON.stringify(move)}`)
		}
		const board = GL.getBoard(state)
		const playerId = Object.keys(state.players).find((id) => state.players[id] === board.toMove)!
		void this.gameContext.sharedStore.dispatch({
			code: 'make-move',
			playerId,
			gameId: this.gameId,
			expectedMoveIndex: state.moveHistory.length,
			move,
			time: this.gameContext.sharedStore.serverNow(),
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
		const state = unwrap(this.state)

		// the reducer re-validates against whatever state the op actually lands on; this is just a
		// local fast-path check so obviously stale moves don't get dispatched at all
		const board = GL.getBoard(state)
		if (!GL.isPlayerTurn(board, this.bottomPlayer.color) || !board.pieces[move.from]) return
		if (!GL.validateAndPlayMove(move, state, this.gameConfig.variant)) return

		const res = await this.gameContext.sharedStore.dispatch({
			code: 'make-move',
			playerId: this.bottomPlayer.id,
			gameId: this.gameId,
			expectedMoveIndex: state.moveHistory.length,
			move,
			time: this.gameContext.sharedStore.serverNow(),
		})
		this.inProgressMoveLocal.set(undefined)
		if (res.rejected) {
			log.warn(res.error.data, 'move rejected')
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
		// display only: flagging is done by whichever session is the clock authority (the server for
		// rooms, the local leader store for vs-bot -- see clockAuthority.ts). derived statelessly
		// from the move history on every tick, so rolled-back moves can't corrupt the clocks; move
		// timestamps are in server time, so elapsed time is measured on the same clock (serverNow).
		if (this.gameConfig.timeControl === 'unlimited') return
		const [tick, setTick] = createSignal(0)
		const interval = setInterval(() => {
			if (!this.outcome) setTick((t) => t + 1)
		}, 100)
		onCleanup(() => clearInterval(interval))
		this.getClocks = createMemo(() => {
			tick()
			const clocks = GO.computeClocks(
				{ gameConfig: this.gameConfig, moves: this.state.moveHistory },
				this.gameContext.sharedStore.serverNow()
			)
			if (!clocks) return { white: 0, black: 0 }
			return { white: Math.max(clocks.white, 0), black: Math.max(clocks.black, 0) }
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
		if (!this.isClientPlayerParticipating || !this.isActiveGame || this.outcome) return
		const drawIsOfferedBy = this.drawIsOfferedBy
		if (drawIsOfferedBy === this.bottomPlayer.color) return
		if (drawIsOfferedBy) {
			void this.gameContext.sharedStore.dispatch({ code: 'accept-draw', playerId: this.bottomPlayer.id })
		} else {
			void this.gameContext.sharedStore.dispatch({
				code: 'offer-draw',
				playerId: this.bottomPlayer.id,
				time: this.gameContext.sharedStore.serverNow(),
			})
		}
	}

	declineOrCancelDraw() {
		if (!this.isClientPlayerParticipating || !this.isActiveGame || this.outcome) return
		if (!this.drawIsOfferedBy) return
		void this.gameContext.sharedStore.dispatch({ code: 'decline-or-cancel-draw', playerId: this.bottomPlayer.id })
	}

	resign() {
		if (!this.isClientPlayerParticipating || !this.isActiveGame || this.outcome) return
		void this.gameContext.sharedStore.dispatch({ code: 'resign', playerId: this.bottomPlayer.id })
	}

	get drawIsOfferedBy() {
		return GO.getDrawIsOfferedBy(this.gameContext.state.drawOffers)
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
export function newGameId() {
	return createId(6)
}

//#endregion
