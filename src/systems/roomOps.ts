// room-scoped ops and reducer: wraps the game reducer with room concerns (membership, readiness,
// piece swapping, connection tracking). shared verbatim by the server and every client -- keep it
// deterministic: randomness (preferred colors, game ids, seeds) travels inside op payloads.
import * as SS from '~/sharedStore/sharedStore.ts'

import * as GL from './game/gameLogic.ts'
import * as GO from './game/gameOps.ts'
import * as P from './player.ts'

//#region state

export type RoomMember = P.Player & {
	disconnectedAt?: number
	// joined explicitly as a spectator; never gets auto-seated on rejoin
	isSpectator?: boolean
}

export type RoomState = {
	members: RoomMember[]
	// will contain id of player that initiated the piece swap
	agreePieceSwap: string | null
	isReadyForGame: { [playerId: string]: boolean }
	status: 'pregame' | 'playing' | 'postgame'
} & GO.RootGameState

export type ClientOwnedState = {
	playerId: string
}

export function getInitialRoomState(): RoomState {
	return {
		members: [],
		status: 'pregame',
		gameParticipants: {} as RoomState['gameParticipants'],
		agreePieceSwap: null,
		isReadyForGame: {},
		gameConfig: GL.getDefaultGameConfig(),
		drawOffers: { white: null, black: null },
		moves: [],
	}
}

//#endregion

//#region events (side effects)

export const ROOM_ONLY_EVENTS = [
	'initiate-piece-swap',
	'agree-piece-swap',
	'decline-or-cancel-piece-swap',
	'player-connected',
	'player-disconnected',
	'player-reconnected',
] as const

export type RoomEvent =
	| {
			type: (typeof ROOM_ONLY_EVENTS)[number]
			playerId: string
	  }
	| GO.GameEvent

//#endregion

//#region ops

export type RoomOp =
	| GO.GameOp
	| (SS.BaseOp &
			(
				| { code: 'join'; player: P.Player; isSpectating: boolean; preferredColor: GL.Color }
				| { code: 'set-name'; playerId: string; name: string }
				| { code: 'initiate-or-agree-piece-swap'; playerId: string }
				| { code: 'decline-or-cancel-piece-swap'; playerId: string }
				| { code: 'set-ready'; playerId: string; ready: boolean }
				// server-authored connection tracking
				| { code: 'player-disconnected'; playerId: string; time: number }
				| { code: 'player-reconnected'; playerId: string }
				| { code: 'player-timed-out'; playerId: string }
			))

const { noop, invalid } = GO

// ops only the server may author. the network layer drops client batches containing any of these:
// connection tracking is derived from sockets the server owns, and flag-timeout claims are only
// trustworthy when computed against the server's clock (see computeClocks)
export const SERVER_AUTHORED_OP_CODES: ReadonlySet<string> = new Set([
	'flag-timeout',
	'player-disconnected',
	'player-reconnected',
	'player-timed-out',
] satisfies RoomOp['code'][])

// the playerId a client-authored op claims to act as, so the network layer can check it against
// the sender's registered identity. null means the op carries no author (e.g. config changes).
export function opAuthor(op: RoomOp): string | null {
	if (op.code === 'join') return op.player.id
	return 'playerId' in op ? op.playerId : null
}

// clients stamp op times in estimated server time (SharedStore.serverNow), so honest clients land
// well within these bounds regardless of local clock skew
export const MAX_OP_TIME_FUTURE_MS = 2_500
export const MAX_OP_TIME_PAST_MS = 10_000

/**
 * sanity-checks client-reported wall-clock times against the server's own clock and the committed
 * history. the shared reducer can't do this (it must be deterministic and time-free), so the
 * network layer runs it before committing a batch and rejects the batch outright on failure.
 */
export function validateOpTimestamps(state: RoomState, ops: RoomOp[], serverNow: number): SS.OpsRejectedReason | null {
	for (const op of ops) {
		if (!('time' in op)) continue
		if (op.time > serverNow + MAX_OP_TIME_FUTURE_MS) {
			return {
				code: 'clock-out-of-sync',
				message: 'Action rejected: it was timestamped in the future. Your system clock appears to be out of sync.',
			}
		}
		if (op.time < serverNow - MAX_OP_TIME_PAST_MS) {
			return {
				code: 'op-time-unreasonable',
				message: 'Action rejected: it was timestamped too far in the past. Check your network connection and system clock.',
			}
		}
		if (op.code === 'make-move') {
			const lastMove = state.moves[state.moves.length - 1]
			if (lastMove && op.time < lastMove.ts) {
				return {
					code: 'clock-out-of-sync',
					message: 'Move rejected: it was timestamped before the previous move. Your system clock appears to be out of sync.',
				}
			}
		}
	}
	return null
}

//#endregion

//#region reducer

// see gameOps draft(): shallow copies of every container a handler may touch. moves is shared on
// purpose (identity is load-bearing); game handlers guard it themselves.
function draft(state: RoomState): RoomState {
	return {
		...state,
		members: state.members.map((m) => ({ ...m })),
		isReadyForGame: { ...state.isReadyForGame },
		gameParticipants: { ...state.gameParticipants },
		gameConfig: { ...state.gameConfig },
		drawOffers: { ...state.drawOffers },
	}
}

function participantByPlayerId(state: RoomState, playerId: string) {
	return Object.values(state.gameParticipants).find((p) => p && p.id === playerId) ?? null
}

function participantCount(state: RoomState) {
	return Object.values(state.gameParticipants).filter((p) => !!p).length
}

// swaps the two participants' colors (or flips a lone participant's color)
function swapParticipantColors(next: RoomState) {
	const participants = Object.values(next.gameParticipants).filter((p) => !!p)
	const swapped = participants.map((p) => ({ ...p, color: GL.oppositeColor(p.color) }))
	next.gameParticipants = {} as RoomState['gameParticipants']
	for (const p of swapped) {
		next.gameParticipants[p.color] = p
	}
}

export function applyRoomOp(state: RoomState, op: RoomOp, emit: (e: RoomEvent) => void): RoomState {
	switch (op.code) {
		//#region game op wrappers
		case 'start-game': {
			if (state.status !== 'pregame') noop()
			const dispatcher = participantByPlayerId(state, op.playerId)
			if (!dispatcher) noop()
			const other = Object.values(state.gameParticipants).find((p) => p && p.id !== op.playerId)
			if (!other || !state.isReadyForGame[other.id]) noop()
			const next = GO.applyGameOp(draft(state), op, emit)
			for (const id of Object.keys(next.isReadyForGame)) {
				next.isReadyForGame[id] = false
			}
			next.status = 'playing'
			return next
		}
		case 'back-to-pregame': {
			if (participantCount(state) < 2) noop()
			const next = GO.applyGameOp(draft(state), op, emit)
			next.status = 'pregame'
			// players swap sides between games
			swapParticipantColors(next)
			next.agreePieceSwap = null
			return next
		}
		//#endregion

		//#region room ops
		case 'join': {
			const existing = state.members.find((m) => m.id === op.player.id)
			// a known member re-dispatching join is reclaiming a seat lost to a pregame disconnect
			// timeout -- anything else is a no-op
			if (existing && (op.isSpectating || existing.isSpectator || participantByPlayerId(state, op.player.id))) noop()
			let freeColor: GL.Color | null
			if (!state.gameParticipants.white) {
				freeColor = state.gameParticipants.black ? 'white' : op.preferredColor
			} else {
				freeColor = state.gameParticipants.black ? null : 'black'
			}
			if (existing && !freeColor) noop()
			const next = draft(state)
			if (existing) {
				delete next.members.find((m) => m.id === op.player.id)!.disconnectedAt
			} else {
				next.members = [...next.members, { ...op.player, ...(op.isSpectating ? { isSpectator: true } : {}) }]
			}
			// a full room degrades a non-spectating joiner to a seatless member instead of rejecting
			if (!op.isSpectating && freeColor) {
				next.gameParticipants[freeColor] = { id: op.player.id, color: freeColor }
				next.isReadyForGame[op.player.id] = false
			}
			if (!existing) emit({ type: 'player-connected', playerId: op.player.id })
			return next
		}
		case 'set-name': {
			const member = state.members.find((m) => m.id === op.playerId)
			if (!member) noop()
			let name = op.name
			if (member!.name === name) noop()
			// check if name taken
			const duplicates = state.members.filter((m) => m.id !== op.playerId && m.name === name)
			if (duplicates.length > 0) {
				name = `${name} (${duplicates.length})`
			}
			const next = draft(state)
			next.members.find((m) => m.id === op.playerId)!.name = name
			return next
		}
		case 'initiate-or-agree-piece-swap': {
			if (state.status !== 'pregame') noop()
			const dispatcher = participantByPlayerId(state, op.playerId)
			if (!dispatcher) noop()
			if (participantCount(state) === 1) {
				const next = draft(state)
				swapParticipantColors(next)
				next.agreePieceSwap = null
				emit({ type: 'agree-piece-swap', playerId: op.playerId })
				return next
			}
			if (state.agreePieceSwap === op.playerId) noop()
			const next = draft(state)
			if (state.agreePieceSwap) {
				// the other participant already initiated -- this is the agreement
				swapParticipantColors(next)
				next.agreePieceSwap = null
				emit({ type: 'agree-piece-swap', playerId: op.playerId })
			} else {
				next.agreePieceSwap = op.playerId
				emit({ type: 'initiate-piece-swap', playerId: op.playerId })
			}
			return next
		}
		case 'decline-or-cancel-piece-swap': {
			if (state.status !== 'pregame') noop()
			if (!state.agreePieceSwap) noop()
			const next = draft(state)
			next.agreePieceSwap = null
			emit({ type: 'decline-or-cancel-piece-swap', playerId: op.playerId })
			return next
		}
		case 'set-ready': {
			if (state.status !== 'pregame') noop()
			if (!participantByPlayerId(state, op.playerId)) noop()
			if (!!state.isReadyForGame[op.playerId] === op.ready) noop()
			const next = draft(state)
			next.isReadyForGame[op.playerId] = op.ready
			return next
		}
		case 'player-disconnected': {
			const member = state.members.find((m) => m.id === op.playerId)
			if (!member || member.disconnectedAt !== undefined) noop()
			const next = draft(state)
			next.members.find((m) => m.id === op.playerId)!.disconnectedAt = op.time
			return next
		}
		case 'player-reconnected': {
			const member = state.members.find((m) => m.id === op.playerId)
			if (!member || member.disconnectedAt === undefined) noop()
			const next = draft(state)
			delete next.members.find((m) => m.id === op.playerId)!.disconnectedAt
			emit({ type: 'player-reconnected', playerId: op.playerId })
			return next
		}
		case 'player-timed-out': {
			const member = state.members.find((m) => m.id === op.playerId)
			if (!member || member.disconnectedAt === undefined) noop()
			emit({ type: 'player-disconnected', playerId: op.playerId })
			const participant = participantByPlayerId(state, op.playerId)
			if (state.status !== 'pregame' || !participant) {
				// mid-game we just report it; the seat is kept for a reconnect
				return state
			}
			const next = draft(state)
			delete next.gameParticipants[participant.color]
			delete next.isReadyForGame[op.playerId]
			if (next.agreePieceSwap === op.playerId) next.agreePieceSwap = null
			return next
		}
		//#endregion

		default:
			// remaining game-scoped ops apply to the embedded game state unchanged
			return GO.applyGameOp(draft(state), op, emit)
	}
}

export const roomReducer = SS.makeReducer<RoomOp, RoomState, RoomEvent>(applyRoomOp)

export type RoomStoreDefinition = SS.StoreDefinition<RoomOp, RoomState, RoomEvent>

export const roomStoreDefinition: RoomStoreDefinition = {
	reducer: roomReducer,
	// the move list is the hot path: it grows unboundedly and is consumed as a plain array by the
	// board-history derivation, so it stays out of the proxied tree
	rawPaths: [['moves']],
}

//#endregion
