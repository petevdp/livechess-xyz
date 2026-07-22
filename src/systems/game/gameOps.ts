// game-scoped ops and their reducer logic. shared verbatim by every replica -- the server, remote
// clients, and the local vs-bot session -- so everything in here must be fully deterministic:
// randomness (seeds, game ids) and wall-clock times always travel inside op payloads.
import * as SS from '~/sharedStore/sharedStore.ts'

import * as GL from './gameLogic.ts'

//#region state

export type GameParticipant = {
	id: string
	color: GL.Color
}

export type RootGameState = {
	// TODO eventually just make this an array, it's just easier that way
	gameParticipants: { [key in GL.Color]: GameParticipant }
	gameConfig: GL.GameConfig
	moves: GL.Move[]
	outcome?: GL.GameOutcome
	inProgressMove?: GL.InProgressMove
	activeGameId?: string
	drawOffers: { [key in GL.Color]: number | null }
}

//#endregion

//#region events (side effects)

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
			move: GL.InProgressMove
	  }

//#endregion

//#region ops

export type GameOp = SS.BaseOp &
	(
		| { code: 'set-game-config'; config: Partial<GL.GameConfig> }
		| { code: 'reseed-fischer-random'; seed: number }
		| { code: 'start-game'; playerId: string; gameId: string }
		| {
				code: 'make-move'
				playerId: string
				gameId: string
				// pins the move to the position it was made against, so a stale dispatch can't double-apply
				expectedMoveIndex: number
				move: GL.InProgressMove
				// wall-clock time at the originator; becomes the committed move's ts on every replica
				time: number
		  }
		| { code: 'commit-in-progress-move'; playerId: string; gameId: string; move: GL.InProgressMove }
		| { code: 'offer-draw'; playerId: string; time: number }
		| { code: 'accept-draw'; playerId: string }
		| { code: 'decline-or-cancel-draw'; playerId: string }
		| { code: 'resign'; playerId: string }
		| { code: 'flag-timeout'; gameId: string; winner: GL.Color }
		| { code: 'back-to-pregame'; playerId: string }
	)

export const GAME_OP_CODES = [
	'set-game-config',
	'reseed-fischer-random',
	'start-game',
	'make-move',
	'commit-in-progress-move',
	'offer-draw',
	'accept-draw',
	'decline-or-cancel-draw',
	'resign',
	'flag-timeout',
	'back-to-pregame',
] as const
export type GameOpCode = (typeof GAME_OP_CODES)[number]

export type Rejection = { code: 'noop' } | { code: 'invalid'; reason: string }

export const noop: () => never = () => SS.reject<Rejection>({ code: 'noop' })
export const invalid: (reason: string) => never = (reason) => SS.reject<Rejection>({ code: 'invalid', reason }, reason)

//#endregion

//#region board history derivation

// board history is a pure function of (config, moves). reducers replay the same ops against several
// base states, so we memoize on the moves array reference -- reducers use structural sharing, and an
// untouched moves array keeps its identity across reduces.
const boardHistoryCache = new WeakMap<readonly GL.Move[], GL.BoardHistoryEntry[]>()

export function getBoardHistory(config: GL.GameConfig, moves: GL.Move[]): GL.BoardHistoryEntry[] {
	// an empty moves array is fully determined by config, which can still change (pregame) -- don't cache
	if (moves.length === 0) return [{ board: GL.getStartPos(config) }]
	const cached = boardHistoryCache.get(moves)
	if (cached) return cached
	let history: GL.BoardHistoryEntry[] = [{ board: GL.getStartPos(config) }]
	for (const move of moves) {
		const [board] = GL.applyMoveToBoard(move, history[history.length - 1].board, move.duck)
		history = [...history, { board }]
	}
	boardHistoryCache.set(moves, history)
	return history
}

function cacheBoardHistory(moves: GL.Move[], history: GL.BoardHistoryEntry[]) {
	if (moves.length > 0) boardHistoryCache.set(moves, history)
}

export function toGameState(state: RootGameState): GL.GameState {
	const white = state.gameParticipants.white
	const black = state.gameParticipants.black
	if (!white || !black) throw new Error('cannot build game state without both participants')
	return {
		players: { [white.id]: 'white', [black.id]: 'black' },
		boardHistory: getBoardHistory(state.gameConfig, state.moves),
		moveHistory: state.moves,
	}
}

/**
 * remaining clock time (ms) for both players, derived from committed move timestamps. mirrors the
 * client display clock (useClock in game.ts): the time before white's first move is free, and each
 * move refunds the configured increment. returns null for untimed games. the server uses this over
 * its committed history to decide when to author flag-timeout ops.
 */
export function computeClocks(state: Pick<RootGameState, 'gameConfig' | 'moves'>, now: number): { white: number; black: number } | null {
	const parsed = GL.parseGameConfig(state.gameConfig)
	if (parsed.timeControl === null) return null
	const clocks = { white: parsed.timeControl, black: parsed.timeControl }
	let toMove: GL.Color = 'white'
	let lastTs = 0
	for (const move of state.moves) {
		if (lastTs !== 0) {
			clocks[toMove] = Math.min(clocks[toMove] - (move.ts - lastTs - parsed.increment), parsed.timeControl)
		}
		toMove = GL.oppositeColor(toMove)
		lastTs = move.ts
	}
	if (lastTs !== 0) {
		clocks[toMove] -= now - lastTs
	}
	return clocks
}

export function getDrawIsOfferedBy(offers: RootGameState['drawOffers']) {
	for (const [color, draw] of Object.entries(offers)) {
		if (draw !== null && draw !== undefined) return color as GL.Color
	}
	return null
}

//#endregion

//#region reducer logic

// a shallow-ish draft the handlers below can mutate freely. `moves` is intentionally shared: its
// identity is load-bearing (raw path tracking + board history memoization), so handlers only ever
// replace it wholesale.
function draft<S extends RootGameState>(state: S): S {
	return {
		...state,
		gameConfig: { ...state.gameConfig },
		gameParticipants: { ...state.gameParticipants },
		drawOffers: { ...state.drawOffers },
	}
}

function participantByPlayerId(state: RootGameState, playerId: string): GameParticipant | null {
	return Object.values(state.gameParticipants).find((p) => p && p.id === playerId) ?? null
}

/**
 * applies a single game op. returns the next state (structural sharing) or throws a RejectedError.
 * used directly as the vs-bot reducer and delegated to by the room reducer for game-scoped ops.
 */
export function applyGameOp<S extends RootGameState>(state: S, op: GameOp, emit: (e: GameEvent) => void): S {
	switch (op.code) {
		case 'set-game-config': {
			const next = draft(state)
			next.gameConfig = { ...next.gameConfig, ...op.config }
			return next
		}
		case 'reseed-fischer-random': {
			const next = draft(state)
			next.gameConfig.fischerRandomSeed = op.seed
			return next
		}
		case 'start-game': {
			if (state.activeGameId) noop()
			if (!state.gameParticipants.white || !state.gameParticipants.black) invalid('cannot start a game without two participants')
			const next = draft(state)
			next.moves = []
			next.drawOffers = { white: null, black: null }
			next.activeGameId = op.gameId
			delete next.outcome
			delete next.inProgressMove
			emit({ type: 'new-game', playerId: op.playerId, gameId: op.gameId })
			return next
		}
		case 'make-move': {
			if (state.activeGameId !== op.gameId) noop()
			if (state.outcome) noop()
			if (state.moves.length !== op.expectedMoveIndex) noop()
			const gameState = toGameState(state)
			const board = GL.getBoard(gameState)
			const mover = participantByPlayerId(state, op.playerId)
			if (!mover || mover.color !== board.toMove) noop()
			const parsedConfig = GL.parseGameConfig(state.gameConfig)
			let result: ReturnType<typeof GL.validateAndPlayMove>
			try {
				result = GL.validateAndPlayMove(op.move, gameState, state.gameConfig.variant)
			} catch {
				result = undefined
			}
			if (!result) invalid('illegal move')

			// duck rules are enforced here rather than trusted from the client: required in duck games,
			// forbidden elsewhere, and only ever placed on an empty square of the post-move board (which
			// still holds the old duck, so re-placing it where it already stands is also rejected)
			if (state.gameConfig.variant === 'duck') {
				if (!op.move.duck) invalid('duck placement required')
				const [postMoveBoard] = GL.applyMoveToBoard(result!.move, board)
				if (!GL.validateDuckPlacement(op.move.duck!, postMoveBoard)) invalid('invalid duck placement')
			} else if (op.move.duck) {
				invalid('duck placement not allowed in this variant')
			}

			const move: GL.Move = { ...result!.move, ts: op.time }
			const [boardWithDuck] = GL.applyMoveToBoard(move, board, move.duck)
			const newMoves = [...state.moves, move]
			const newBoardHistory = [...gameState.boardHistory, { board: boardWithDuck }]
			cacheBoardHistory(newMoves, newBoardHistory)

			const next = draft(state)
			next.moves = newMoves
			delete next.inProgressMove
			emit({ type: 'make-move', playerId: op.playerId, moveIndex: state.moves.length })

			const outcome = GL.getGameOutcome({ players: gameState.players, moveHistory: newMoves, boardHistory: newBoardHistory }, parsedConfig)
			if (outcome) {
				next.outcome = outcome
				emit({ type: 'game-over' })
			}

			const drawOfferedBy = getDrawIsOfferedBy(state.drawOffers)
			if (drawOfferedBy) {
				next.drawOffers = { white: null, black: null }
				emit({
					type: drawOfferedBy === mover!.color ? 'draw-canceled' : 'draw-declined',
					playerId: op.playerId,
				})
			}
			return next
		}
		case 'commit-in-progress-move': {
			if (state.activeGameId !== op.gameId) noop()
			if (state.outcome) noop()
			const mover = participantByPlayerId(state, op.playerId)
			if (!mover) noop()
			const next = draft(state)
			next.inProgressMove = op.move
			emit({ type: 'committed-in-progress-move', playerId: op.playerId, gameId: op.gameId, move: op.move })
			return next
		}
		case 'offer-draw': {
			if (!state.activeGameId || state.outcome) noop()
			const participant = participantByPlayerId(state, op.playerId)
			if (!participant) noop()
			if (getDrawIsOfferedBy(state.drawOffers)) noop()
			const next = draft(state)
			next.drawOffers[participant!.color] = op.time
			emit({ type: 'draw-offered', playerId: op.playerId })
			return next
		}
		case 'accept-draw': {
			if (!state.activeGameId || state.outcome) noop()
			const participant = participantByPlayerId(state, op.playerId)
			if (!participant) noop()
			const offeredBy = getDrawIsOfferedBy(state.drawOffers)
			if (!offeredBy || offeredBy === participant!.color) noop()
			const next = draft(state)
			next.outcome = { winner: null, reason: 'draw-accepted' }
			next.drawOffers = { white: null, black: null }
			emit({ type: 'draw-accepted', playerId: op.playerId })
			emit({ type: 'game-over' })
			return next
		}
		case 'decline-or-cancel-draw': {
			if (!state.activeGameId || state.outcome) noop()
			const participant = participantByPlayerId(state, op.playerId)
			if (!participant) noop()
			const offeredBy = getDrawIsOfferedBy(state.drawOffers)
			if (!offeredBy) noop()
			const next = draft(state)
			next.drawOffers = { white: null, black: null }
			emit({
				type: offeredBy === participant!.color ? 'draw-canceled' : 'draw-declined',
				playerId: op.playerId,
			})
			return next
		}
		case 'resign': {
			if (!state.activeGameId || state.outcome) noop()
			const participant = participantByPlayerId(state, op.playerId)
			if (!participant) noop()
			const next = draft(state)
			next.outcome = { winner: GL.oppositeColor(participant!.color), reason: 'resigned' }
			emit({ type: 'game-over' })
			return next
		}
		case 'flag-timeout': {
			if (state.activeGameId !== op.gameId) noop()
			if (state.outcome) noop()
			const next = draft(state)
			next.outcome = { winner: op.winner, reason: 'flagged' }
			emit({ type: 'game-over' })
			return next
		}
		case 'back-to-pregame': {
			if (!state.activeGameId) noop()
			const next = draft(state)
			delete next.activeGameId
			return next
		}
	}
}

export const gameReducer = SS.makeReducer<GameOp, RootGameState, GameEvent>(applyGameOp)

//#endregion
