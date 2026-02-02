import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Accessor, batch, createMemo, getOwner } from 'solid-js'
import { produce, reconcile, unwrap } from 'solid-js/store'

import * as C from '~/config'
import * as DS from '~/systems/debugSystem'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import { deepClone } from '~/utils/obj.ts'
import { SignalProperty, StoreProperty, createSignalProperty, createStoreProperty, trackAndUnwrap } from '~/utils/solid'

export type BoardViewState = {
	squareSize: number
	boardSize: number
	boardSizeCss: number
	boardFlipped: boolean
	boardIndex: number
	// may not match board in the game's history
	grabbingActivePiece: boolean
	mouseMovedAfterGrab: boolean
	activeSquare: string | null
	board: GL.Board
	animation: PieceAnimation | null
}

// alias for semantic clarity
export type DisplayCoords = GL.Coords

type PieceAnimation = PieceAnimationArgs & { currentFrame: number }
type PieceAnimationArgs = {
	// in frames for now
	movedPieces: MovedPiece[]
	addedPieces?: GL.Board['pieces']
	removedPieceSquares?: string[]
}
type MovedPiece = { to: string; from: string }

export class BoardView {
	state: StoreProperty<BoardViewState>
	legalMovesForActiveSquare: Accessor<string[]>
	/** the board which moves can actually be played on, aka the latest board  */
	inPlayBoard: Accessor<GL.Board>
	visibleSquares: Accessor<Set<string>>
	moveOnBoard: Accessor<GL.Move | null>
	hoveredSquare: Accessor<string | null>

	// only updated when there's an active square. kept separate from the board state to eliminate store overhead on read
	mousePos: SignalProperty<DisplayCoords | null>

	constructor(private game: G.Game) {
		if (!getOwner()) throw new Error('Owner not set')

		this.state = createStoreProperty<BoardViewState>({
			squareSize: 32,
			boardSize: 100,
			boardSizeCss: 100,
			activeSquare: null,
			boardFlipped: game.bottomPlayer.color === 'black',
			boardIndex: game.state.boardHistory.length - 1,
			grabbingActivePiece: false,
			mouseMovedAfterGrab: false,
			board: deepClone(unwrap(game.boardWithInProgressMove())),
			animation: null,
		})

		this.legalMovesForActiveSquare = createMemo(() => {
			const activeSquare = this.state.s.activeSquare
			const boardIndex = this.state.s.boardIndex
			if (!activeSquare || boardIndex !== game.state.boardHistory.length - 1) return []
			const moves = GL.getLegalMoves([GL.coordsFromNotation(activeSquare)], game.state, game.gameConfig.variant)
			return moves.map((m) => GL.notationFromCoords(m.to))
		})

		this.visibleSquares = () => {
			if (game.gameConfig.variant === 'fog-of-war' && this.game.isClientPlayerParticipating && !this.game.outcome)
				return GL.getVisibleSquares(game.state, game.bottomPlayer.color)
			return new Set<string>()
		}
		this.moveOnBoard = () => game.state.moveHistory[this.state.s.boardIndex - 1] || null
		const placingDuck = () => game.isPlacingDuck
		this.inPlayBoard = () => {
			return game.boardWithInProgressMove()
		}
		this.mousePos = createSignalProperty<null | DisplayCoords>(null)

		this.hoveredSquare = createMemo(() => {
			const s = this.state.s
			const mousePos = this.mousePos.get()
			if (!s.activeSquare || !mousePos) return null
			const square = this.getSquareFromDisplayCoords(mousePos)
			if (!square) return null
			if (!s.activeSquare || s.activeSquare === square) return null
			if (!this.legalMovesForActiveSquare().includes(square)) return null
			return square
		})

		DS.addHook(
			'boardView',
			() => {
				const s = trackAndUnwrap(this.state.s)
				return {
					...s,
					hoveredSquare: this.hoveredSquare(),
				}
			},
			getOwner()!
		)
	}

	pieceAnimationDone = createSignalProperty(false)
	async runPieceAnimation(args: PieceAnimationArgs, storeUpdates?: Partial<BoardViewState>) {
		if (this.game.gameConfig.variant === 'fog-of-war') {
			console.error('animations not supported in fog-of-war variant')
			return
		}
		const animationAlreadyRunning = !!this.state.s.animation
		this.state.set({
			...(storeUpdates ?? {}),
			animation: {
				currentFrame: 0,
				...args,
			},
		})

		// just use the existing animation loop if it's already running
		if (!animationAlreadyRunning) {
			const runInner = () => {
				if (this.state.s.animation === null) {
					this.pieceAnimationDone.set(true)
					return
				}
				if (this.state.s.animation.currentFrame >= C.PIECE_ANIMATION_NUM_FRAMES) {
					// this.s.set(['animation'], null)
					this.pieceAnimationDone.set(true)
					return
				}
				this.state.set('animation', 'currentFrame', (f) => f + 1)
				requestAnimationFrame(runInner)
			}
			runInner()
		}
		await until(this.pieceAnimationDone.get)
		this.pieceAnimationDone.set(false)
		batch(() => {
			this.state.set('animation', null)
			this.state.set(
				'board',
				produce((board) => {
					for (const movedPiece of args.movedPieces) {
						board.pieces[movedPiece.to] = board.pieces[movedPiece.from]
						delete board.pieces[movedPiece.from]
					}

					if (args.addedPieces) {
						Object.assign(board.pieces, args.addedPieces)
					}

					if (args.removedPieceSquares)
						for (const square of args.removedPieceSquares) {
							delete board.pieces[square]
						}
				})
			)
		})
	}

	isVisibleSquare(square: string) {
		const squares = this.visibleSquares()
		return squares.size === 0 || squares.has(square)
	}

	squareWarnings() {
		const board = this.state.s.board
		const attacked: string[] = []
		const moveOnBoard = this.moveOnBoard()
		if (moveOnBoard && moveOnBoard.check) {
			const kingSquare = Object.keys(board.pieces).find(
				(square) => board.pieces[square].type === 'king' && board.pieces[square].color === board.toMove
			)
			attacked.push(kingSquare!)
		}
		for (const square of this.legalMovesForActiveSquare()) {
			if (board.pieces[square]?.color === this.game.topPlayer.color) attacked.push(square)
		}
		return attacked
	}

	squareNotationToDisplayCoords(square: string) {
		return squareNotationToDisplayCoords(square, this.state.s.boardFlipped, this.state.s.squareSize)
	}

	getPieceDisplayDetails(pieceSquare: string) {
		const s = this.state.s
		if (!s.board.pieces[pieceSquare] || (s.grabbingActivePiece && pieceSquare === s.activeSquare)) return
		const dispCoords = squareNotationToDisplayCoords(pieceSquare, s.boardFlipped, s.squareSize)
		if (s.animation) {
			const movedPiece = s.animation.movedPieces.find((m) => m.from === pieceSquare)
			if (movedPiece) {
				const to = GL.coordsFromNotation(movedPiece.to)
				const fromDisp = dispCoords
				const toDisp = boardCoordsToDisplayCoords(to, s.boardFlipped, s.squareSize)

				const distanceX = toDisp.x - fromDisp.x
				const distanceY = toDisp.y - fromDisp.y

				const stepX = distanceX / C.PIECE_ANIMATION_NUM_FRAMES
				const stepY = distanceY / C.PIECE_ANIMATION_NUM_FRAMES

				dispCoords.x += stepX * s.animation.currentFrame
				dispCoords.y += stepY * s.animation.currentFrame
				return { coords: dispCoords, isGrabbed: false }
			}
			if (s.animation.removedPieceSquares?.includes(pieceSquare)) {
				return null
			}
		}
		return { coords: dispCoords, isGrabbed: false }
	}

	getSquareFromDisplayCoords({ x, y }: { x: number; y: number }) {
		let col = Math.floor(x / this.state.s.squareSize)
		let row = Math.floor(y / this.state.s.squareSize)
		if (this.state.s.boardFlipped) {
			col = 7 - col
			row = 7 - row
		}

		return String.fromCharCode('a'.charCodeAt(0) + col) + (8 - row)
	}

	isLegalForActive(square: string) {
		return !!this.legalMovesForActiveSquare().find((s) => s === square)
	}

	get viewingLiveBoard() {
		return this.state.s.boardIndex === this.game.state.boardHistory.length - 1
	}

	async snapBackToLive() {
		if (this.viewingLiveBoard) return
		const boardIndex = this.state.s.boardIndex
		const boardIndexBeforeLive = this.game.state.boardHistory.length - 2
		if (boardIndex !== boardIndexBeforeLive) {
			this.updateBoardStatic(boardIndexBeforeLive)
		}
		await this.updateBoard(this.game.state.boardHistory.length - 1)
	}

	squareContainsPlayerPiece(square: string) {
		return this.inPlayBoard().pieces[square]?.color === this.game.bottomPlayer.color
	}

	getBoardByIndex(boardIndex: number) {
		if (boardIndex === this.game.state.boardHistory.length - 1) {
			return this.inPlayBoard()
		} else {
			return unwrap(this.game.state.boardHistory[boardIndex].board)
		}
	}

	private updateBoardStatic(boardIndex: number) {
		const board = this.getBoardByIndex(boardIndex)
		batch(() => {
			this.state.set({
				boardIndex,
				animation: null,
				// activeSquare: null,
				// grabbingActivePiece: false,
			})
			const s = this.state.s
			const activeSquareChanged = () =>
				s.activeSquare && board.pieces[s.activeSquare] && !deepEquals(board.pieces[s.activeSquare], unwrap(s.board.pieces[s.activeSquare]))
			if (boardIndex !== this.game.state.moveHistory.length - 1 || activeSquareChanged()) {
				this.state.set('activeSquare', null)
				this.state.set('grabbingActivePiece', false)
			}

			this.state.set('board', reconcile(board))
		})
	}

	async visualizeMove(move: { from: string; to: string }, animate: boolean = false) {
		if (animate && this.game.gameConfig.variant !== 'fog-of-war') {
			await this.runPieceAnimation({ movedPieces: [move] })
		} else {
			const newBoard = deepClone(unwrap(this.state.s.board))
			GL.applyInProgressMoveToBoardInPlace(move, newBoard)
			batch(() => {
				this.state.set('animation', null)
				this.state.set('board', reconcile(newBoard))
			})
		}
	}

	async updateBoard(boardIndex: number, animate: boolean = false) {
		if (boardIndex === this.state.s.boardIndex) return
		if (!animate || this.game.gameConfig.variant === 'fog-of-war') return this.updateBoardStatic(boardIndex)
		if (boardIndex < 0 || boardIndex >= this.game.state.boardHistory.length) {
			throw new Error(`invalid board index: ${boardIndex}`)
		}
		const boardBefore = this.getBoardByIndex(this.state.s.boardIndex)
		const boardAfter = this.getBoardByIndex(boardIndex)
		const movedPieces: { from: string; to: string }[] = []
		const removedPieceSquares: string[] = []
		const addedPieces: GL.Board['pieces'] = {}
		const modifiedPieces = new Map<string, string[]>()
		const getPieceKey = (piece: GL.ColoredPiece) => `${piece.type}:${piece.color}`
		for (const [square, piece] of Object.entries(boardBefore.pieces)) {
			const key = getPieceKey(piece)
			// square contains same piece, no need to move it
			if (boardAfter.pieces[square] && key === getPieceKey(boardAfter.pieces[square])) continue
			const squares = modifiedPieces.get(key) || []
			squares.push(square)
			modifiedPieces.set(key, squares)
		}

		for (const [square, piece] of Object.entries(boardAfter.pieces)) {
			const pieceKey = getPieceKey(piece)
			// board not modified
			if (boardBefore.pieces[square] && getPieceKey(boardBefore.pieces[square]) === pieceKey) continue
			const squaresWithPieceBefore = modifiedPieces.get(pieceKey)
			if (!squaresWithPieceBefore) {
				addedPieces[square] = piece
				continue
			}
			// TODO greedily move closest piece here
			movedPieces.push({ from: squaresWithPieceBefore.pop() ?? square, to: square })
			if (squaresWithPieceBefore.length === 0) modifiedPieces.delete(pieceKey)
		}

		// any remaining pieces were removed
		for (const squares of modifiedPieces.values()) {
			removedPieceSquares.push(...squares)
		}
		const resetActiveSquare =
			!!this.state.s.activeSquare &&
			(movedPieces.some((move) => move.from === this.state.s.activeSquare) || removedPieceSquares.includes(this.state.s.activeSquare))

		const animDone = this.runPieceAnimation(
			{
				movedPieces,
				addedPieces,
				removedPieceSquares,
			},
			{
				boardIndex,
				activeSquare: resetActiveSquare ? null : this.state.s.activeSquare,
				grabbingActivePiece: this.state.s.grabbingActivePiece && !resetActiveSquare,
			}
		)
		await animDone
		this.state.set('board', reconcile(boardAfter))
	}
}

//#region helpers

export function boardCoordsToDisplayCoords(square: GL.Coords, boardFlipped: boolean, squareSize: number) {
	let { x, y } = square
	if (!boardFlipped) {
		y = 7 - y
	} else {
		x = 7 - x
	}
	return { x: x * squareSize, y: y * squareSize } as DisplayCoords
}

function squareNotationToDisplayCoords(square: string, boardFlipped: boolean, squareSize: number) {
	const { x, y } = GL.coordsFromNotation(square)
	return boardCoordsToDisplayCoords({ x, y }, boardFlipped, squareSize)
}
