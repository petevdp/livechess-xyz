import {createStore, produce, SetStoreFunction} from "solid-js/store";
import {Accessor, batch, createEffect, createSignal} from "solid-js";
import * as GL from "./gameLogic.ts";
import * as R from '../room.ts'
import * as P from '../player.ts'

export const VARIANTS = ["regular", "fog-of-war", "duck", "fischer-random"] as const
export type Variant = typeof VARIANTS[number]
export const TIME_CONTROLS = ["15m", "10m", "5m", "3m", "1m"] as const
export type TimeControl = typeof TIME_CONTROLS[number]
export const INCREMENTS = ["0", "1", "2", "5"] as const
export type Increment = typeof INCREMENTS[number]


export type GameConfig = {
	variant: Variant,
	timeControl: TimeControl,
	increment: Increment
}


const startPos = () => ({
	pieces: {
		'a1': {color: 'white', type: 'rook'},
		'b1': {color: 'white', type: 'knight'},
		'c1': {color: 'white', type: 'bishop'},
		'd1': {color: 'white', type: 'queen'},
		'e1': {color: 'white', type: 'king'},
		'f1': {color: 'white', type: 'bishop'},
		'g1': {color: 'white', type: 'knight'},
		'h1': {color: 'white', type: 'rook'},
		'a2': {color: 'white', type: 'pawn'},
		'b2': {color: 'white', type: 'pawn'},
		'c2': {color: 'white', type: 'pawn'},
		'd2': {color: 'white', type: 'pawn'},
		'e2': {color: 'white', type: 'pawn'},
		'f2': {color: 'white', type: 'pawn'},
		'g2': {color: 'white', type: 'pawn'},
		'h2': {color: 'white', type: 'pawn'},

		'a8': {color: 'black', type: 'rook'},
		'b8': {color: 'black', type: 'knight'},
		'c8': {color: 'black', type: 'bishop'},
		'd8': {color: 'black', type: 'queen'},
		'e8': {color: 'black', type: 'king'},
		'f8': {color: 'black', type: 'bishop'},
		'g8': {color: 'black', type: 'knight'},
		'h8': {color: 'black', type: 'rook'},
		'a7': {color: 'black', type: 'pawn'},
		'b7': {color: 'black', type: 'pawn'},
		'c7': {color: 'black', type: 'pawn'},
		'd7': {color: 'black', type: 'pawn'},
		'e7': {color: 'black', type: 'pawn'},
		'f7': {color: 'black', type: 'pawn'},
		'g7': {color: 'black', type: 'pawn'},
		'h7': {color: 'black', type: 'pawn'},
	},
	toMove: 'white'
} as GL.Board)

export const defaultGameConfig: GameConfig = {
	variant: 'regular',
	timeControl: '5m',
	increment: '0'
}

type PromotionSelection = {
	status: 'selecting'
	from: string
	to: string
} | {
	from: string
	to: string
	status: 'selected'
	piece: GL.PromotionPiece
}

export function buildNewGame(player1: string, player2: string, board?: GL.Board): GL.GameNoGetters {
	return {
		winner: null,
		endReason: undefined,
		boardHistory: [toBoardHistoryEntry(board || startPos())],
		moveHistory: [],
		players: {[player1]: 'white', [player2]: 'black'},
	} satisfies GL.GameNoGetters
}

export let game: GL.Game;
export let setGame: SetStoreFunction<GL.Game>;
export let promotionSelection: Accessor<null | PromotionSelection>
export let setPromotionSelection: (p: null | PromotionSelection) => void

export function setupGame() {

	[game, setGame] = createStore({
		...buildNewGame('player1', 'player2', undefined),
		get board() {
			return this.boardHistory[this.boardHistory.length - 1][1]
		},
		get lastMove() {
			return this.moveHistory[this.moveHistory.length - 1]
		}
	} as GL.Game);
	[promotionSelection, setPromotionSelection] = createSignal<null | PromotionSelection>(null)

	createEffect(() => {
		setGame(produce((s) => {
			if (GL.checkmated(game)) {
				s.endReason = 'checkmate'
				s.winner = game.board.toMove === 'white' ? 'black' : 'white'
			} else if (GL.stalemated(game)) {
				s.endReason = 'stalemate'
			} else if (GL.insufficientMaterial(game)) {
				s.endReason = 'insufficient-material'
			} else if (GL.threefoldRepetition(game)) {
				s.endReason = 'threefold-repetition'
			}
		}))


		// handle promotion
		createEffect(() => {
			const _promotionSelection = promotionSelection()
			if (_promotionSelection && _promotionSelection.status === 'selected') {
				tryMakeMove(_promotionSelection.from, _promotionSelection.to, _promotionSelection.piece)
				setPromotionSelection(null)
			}
		})


// handle new actions
		function actionsListener(actions: R.PlayerAction[]) {
			let latestNewGameIdx = actions.findIndex(a => a.type === 'new-game');
			const startIdx = latestNewGameIdx === -1 ? 0 : latestNewGameIdx

			const _room = R.room() as R.Room
			// we don't care about previous games
			batch(() => {
				// skip any actions that happened before the latest new game, as they're not relevant
				for (let i = startIdx; i < actions.length; i++) {
					const action = actions[i];
					console.log({action})
					switch (action.type) {
						case 'new-game': {
							console.log('creating new game')
							let board = startPos();
							setGame(buildNewGame(action.players[0], action.players[1], board))
							break;
						}
						case 'move': {
							let board: GL.Board;
							// check if we've already computed this move on a peer
							let cachedMoveIndex = _room.cache.get('board')?.moveIndex
							if (cachedMoveIndex && cachedMoveIndex === game.boardHistory.length) {
								board = _room.cache.get('board')!.board
							} else {
								// we should have already validated this move before submitting the action, so no need to do it again
								[board] = GL.applyMoveToBoard(action.move, game.board)
								_room.cache.set('board', {moveIndex: game.boardHistory.length, board})
							}
							setGame(produce((game) => {
								game.boardHistory.push(toBoardHistoryEntry(board))
								game.moveHistory.push(action.move)
							}))
							break;
						}
						case 'resign': {
							setGame(produce(game => {
								game.endReason = 'resigned'
								game.winner = Object.entries(game.players).find(([k]) => k !== action.playerId)![1]
							}))
							break;
						}
					}
				}
			})
		}

		R.observeActions(actionsListener)
	})
}

export function tryMakeMove(from: string, to: string, promotionPiece?: GL.PromotionPiece) {
	console.log(`attempting move ${from} -> ${to}`)
	if (!isPlayerTurn() || !game.board.pieces[from]) return
	let result = GL.validateAndPlayMove(from, to, game, promotionPiece)
	let _promotionSelection = promotionSelection();
	if (!result) {
		console.log('invalid move')
		return;
	}
	if (_promotionSelection != null && _promotionSelection.status === 'selecting') return

	if (result.promoted && !_promotionSelection && !promotionPiece) {
		setPromotionSelection({status: 'selecting', from, to})
		return
	}

	console.log(`committing move ${from} -> ${to}`)
	R.dispatchAction({type: 'move', move: result.move})
}

export function toBoardHistoryEntry(board: GL.Board) {
	return [JSON.stringify(board), board] as [string, GL.Board]
}

export const playForBothSides = false;
export const playerColor = (id: string) => game.players[id]
export const isPlayerTurn = () => (game.board.toMove === playerColor(P.player().id) || playForBothSides) && isPlaying()


export function isPlaying() {
	return !game.endReason
}
