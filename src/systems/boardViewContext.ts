import { until } from '@solid-primitives/promise'
import { Accessor, batch, createMemo, getOwner } from 'solid-js'
import { produce, reconcile, unwrap } from 'solid-js/store'

import * as C from '~/config'
import * as DS from '~/systems/debugSystem'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import { deepClone } from '~/utils/obj.ts'
import { StoreProperty, createSignalProperty, createStoreProperty, trackAndUnwrap } from '~/utils/solid'

export type BoardViewState = {
	squareSize: number
	boardSize: number
	boardSizeCss: number
	boardFlipped: boolean
	boardIndex: number
	// may not match board in the game's history
	mousePos: { x: number; y: number } | null
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

export class BoardViewContext {
	s: StoreProperty<BoardViewState>
	legalMovesForActiveSquare: Accessor<string[]>
	grabbedPiecePos: Accessor<{ x: number; y: number } | null>
	/** the board which moves can actually be played on, aka the latest board  */
	inPlayBoard: Accessor<GL.Board>
	visibleSquares: Accessor<Set<string>>
	lastMove: Accessor<GL.Move | null>
	hoveredSquare: Accessor<string | null>

	constructor(private game: G.Game) {
		if (!getOwner()) throw new Error('Owner not set')

		this.s = createStoreProperty<BoardViewState>({
			squareSize: 32,
			boardSize: 100,
			boardSizeCss: 100,
			activeSquare: null,
			boardFlipped: game.bottomPlayer.color === 'black',
			boardIndex: game.state.boardHistory.length - 1,
			grabbingActivePiece: false,
			mouseMovedAfterGrab: false,
			mousePos: null,
			board: deepClone(unwrap(game.boardWithInProgressMove())),
			animation: null,
		})

		this.legalMovesForActiveSquare = createMemo(() => {
			const activeSquare = this.s.state.activeSquare
			const boardIndex = this.s.state.boardIndex
			if (!activeSquare || boardIndex !== game.state.boardHistory.length - 1) return []
			const moves = GL.getLegalMoves([GL.coordsFromNotation(activeSquare)], game.state, game.gameConfig.variant)
			return moves.map((m) => GL.notationFromCoords(m.to))
		})

		this.visibleSquares = () => new Set<string>()
		this.lastMove = () => game.state.moveHistory[this.s.state.boardIndex - 1] || null
		const placingDuck = () => game.isPlacingDuck
		this.inPlayBoard = () => {
			return game.boardWithInProgressMove()
		}

		this.hoveredSquare = createMemo(() => {
			const s = this.s.state
			if (!s.mousePos || !s.grabbingActivePiece) return null
			const square = this.getSquareFromDisplayCoords(s.mousePos)
			if (!square) return null
			if (!s.activeSquare || s.activeSquare === square) return null
			if (!this.legalMovesForActiveSquare().includes(square)) return null
			return square
		})

		this.grabbedPiecePos = createMemo(() => {
			if (!this.s.state.grabbingActivePiece && !placingDuck()) return null
			return this.s.state.mousePos
		})

		DS.addHook(
			'boardCtx',
			() => {
				const s = trackAndUnwrap(this.s.state)
				return {
					...s,
					hoveredSquare: this.hoveredSquare(),
					grabbedPiecePos: this.grabbedPiecePos(),
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
		const animationAlreadyRunning = !!this.s.state.animation
		this.s.set({
			...(storeUpdates ?? {}),
			animation: {
				currentFrame: 0,
				...args,
			},
		})

		// just use the existing animation loop if it's already running
		if (!animationAlreadyRunning) {
			const runInner = () => {
				if (this.s.state.animation === null) {
					this.pieceAnimationDone.set(true)
					return
				}
				if (this.s.state.animation.currentFrame >= C.PIECE_ANIMATION_NUM_FRAMES) {
					// this.s.set(['animation'], null)
					this.pieceAnimationDone.set(true)
					return
				}
				this.s.set('animation', 'currentFrame', (f) => f + 1)
				requestAnimationFrame(runInner)
			}
			runInner()
		}
		await until(this.pieceAnimationDone.get)
		this.pieceAnimationDone.set(false)
		batch(() => {
			this.s.set('animation', null)
			this.s.set(
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

	attackedSquares() {
		if (!this.s.state.activeSquare || !this.viewingLiveBoard) return
		const attacked: string[] = []
		for (const square of this.legalMovesForActiveSquare()) {
			if (this.inPlayBoard().pieces[square]?.color === this.game.topPlayer.color) attacked.push(square)
		}
		return attacked
	}
	squareNotationToDisplayCoords(square: string) {
		return squareNotationToDisplayCoords(square, this.s.state.boardFlipped, this.s.state.squareSize)
	}

	getPieceDisplayDetails(pieceSquare: string) {
		const s = this.s.state
		if (!this.s.state.board.pieces[pieceSquare]) return
		if (s.grabbingActivePiece && s.mouseMovedAfterGrab && s.activeSquare === pieceSquare && s.mousePos) {
			const pos = { x: s.mousePos!.x - s.squareSize / 2, y: s.mousePos!.y - s.squareSize / 2 }
			return { coords: pos, isGrabbed: true }
		}

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
		let col = Math.floor(x / this.s.state.squareSize)
		let row = Math.floor(y / this.s.state.squareSize)
		if (this.s.state.boardFlipped) {
			col = 7 - col
			row = 7 - row
		}

		return String.fromCharCode('a'.charCodeAt(0) + col) + (8 - row)
	}

	isLegalForActive(square: string) {
		return !!this.legalMovesForActiveSquare().find((s) => s === square)
	}

	get viewingLiveBoard() {
		return this.s.state.boardIndex === this.game.state.boardHistory.length - 1
	}

	async snapBackToLive() {
		if (this.viewingLiveBoard) return
		const boardIndex = this.s.state.boardIndex
		const boardIndexBeforeLive = this.game.state.boardHistory.length - 2
		if (boardIndex !== boardIndexBeforeLive) {
			await this.updateBoardStatic(boardIndexBeforeLive)
		}
		await this.updateBoardAnimated(this.game.state.boardHistory.length - 1)
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

	updateBoardStatic(boardIndex: number) {
		const board = this.getBoardByIndex(boardIndex)
		batch(() => {
			this.s.set({
				boardIndex,
				animation: null,
				activeSquare: null,
				grabbingActivePiece: false,
			})
			this.s.set('board', reconcile(board))
		})
	}

	async visualizeMove(move: { from: string; to: string }, animate: boolean = false) {
		if (animate) {
			await this.runPieceAnimation({ movedPieces: [move] })
		} else {
			const newBoard = deepClone(unwrap(this.s.state.board))
			GL.applyInProgressMoveToBoardInPlace(move, newBoard)
			batch(() => {
				this.s.set('animation', null)
				this.s.set('board', reconcile(newBoard))
			})
		}
	}

	async updateBoardAnimated(boardIndex: number) {
		if (boardIndex === this.s.state.boardIndex) return
		if (boardIndex < 0 || boardIndex >= this.game.state.boardHistory.length) {
			throw new Error(`invalid board index: ${boardIndex}`)
		}
		const boardBefore = this.getBoardByIndex(this.s.state.boardIndex)
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

		const animDone = this.runPieceAnimation(
			{
				movedPieces,
				addedPieces,
				removedPieceSquares,
			},
			{ boardIndex, activeSquare: null, grabbingActivePiece: false }
		)
		await animDone
		this.s.set('board', reconcile(boardAfter))
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

//#endregion helpers

//#region check if user is using touch screen

//#endregion
