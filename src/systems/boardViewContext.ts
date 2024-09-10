import { until } from '@solid-primitives/promise'
import { Accessor, createEffect, createMemo, getOwner } from 'solid-js'
import { unwrap } from 'solid-js/store'

import { BOARD_COLORS } from '~/config'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as Pieces from '~/systems/piece.tsx'
import * as P from '~/systems/player.ts'
import { deepClone } from '~/utils/obj.ts'
import { StoreProperty, createSignalProperty, createStoreProperty, trackAndUnwrap } from '~/utils/solid'

type BoardViewState = {
	squareSize: number
	boardSize: number
	boardSizeCss: number
	boardFlipped: boolean
	boardIndex: number
	// may not match board in the game's history
	board: GL.Board
	mousePos: { x: number; y: number } | null
	grabbingActivePiece: boolean
	activeSquare: string | null
	animation: PieceAnimation | null
}

// alias for semantic clarity
type DisplayCoords = GL.Coords

type PieceAnimation = PieceAnimationArgs & { currentFrame: number }
type PieceAnimationArgs = {
	// in frames for now
	duration: number
	boardBefore: GL.Board
	movedPieces: MovedPiece[]
	addedPieces: GL.Board['pieces']
	removedPieceSquares: string[]
	storeUpdates?: Partial<BoardViewState>
}
type MovedPiece = { to: string; from: string }

export class BoardViewContext {
	s: StoreProperty<BoardViewState>
	contexts!: {
		board: CanvasRenderingContext2D
		pieces: CanvasRenderingContext2D
		highlights: CanvasRenderingContext2D
		grabbedPiece: CanvasRenderingContext2D
	}
	legalMovesForActiveSquare: Accessor<string[]>
	grabbedPiecePos: Accessor<{ x: number; y: number } | null>
	activeBoard: Accessor<GL.Board>
	visibleSquares: Accessor<Set<string>>

	constructor(private game: G.Game) {
		if (!getOwner()) throw new Error('Owner not set')

		this.s = createStoreProperty<BoardViewState>({
			squareSize: 32,
			boardSize: 100,
			boardSizeCss: 100,
			activeSquare: null,
			board: deepClone(unwrap(game.board)),
			boardFlipped: game.bottomPlayer.color === 'black',
			boardIndex: game.state.boardHistory.length - 1,
			animation: null,
			grabbingActivePiece: false,
			mousePos: null,
		})

		this.legalMovesForActiveSquare = createMemo(() => {
			const activeSquare = this.s.state.activeSquare
			const boardIndex = this.s.state.boardIndex
			if (!activeSquare || boardIndex !== game.state.boardHistory.length - 1) return []
			const moves = GL.getLegalMoves([GL.coordsFromNotation(activeSquare)], game.state, game.gameConfig.variant)
			return moves.map((m) => GL.notationFromCoords(m.to))
		})

		const shouldHideNonVisible = () => false
		this.visibleSquares = () => new Set<string>()
		const lastMove = () => game.state.moveHistory[this.s.state.boardIndex - 1] || null
		const placingDuck = () => game.placingDuck()
		this.activeBoard = () => game.state.boardHistory[this.s.state.boardIndex].board

		const hoveredSquare = createMemo(() => {
			if (!this.s.state.mousePos) return null
			return this.getSquareFromDisplayCoords(this.s.state.mousePos)
		})

		this.grabbedPiecePos = createMemo(() => {
			if (!this.s.state.grabbingActivePiece && !placingDuck()) return null
			return this.s.state.mousePos
		})

		//#region canvas rendering

		//#region render board
		createEffect(() => {
			const ctx = this.contexts.board
			scaleAndReset(ctx, this.s.state.boardSizeCss)
			const args: RenderBoardArgs = {
				squareSize: this.s.state.squareSize,
				boardFlipped: this.s.state.boardFlipped,
				visibleSquares: this.visibleSquares(),
				shouldHideNonVisible: shouldHideNonVisible(),
			}
			renderBoard(ctx, args)
		})
		//#endregion

		//#region render pieces
		createEffect(() => {
			const ctx = this.contexts.pieces
			if (!Pieces.initialized()) return
			scaleAndReset(ctx, this.s.state.boardSizeCss)
			const animation = this.s.state.animation ? trackAndUnwrap(this.s.state.animation) : null
			const args: RenderPiecesArgs = {
				squareSize: this.s.state.squareSize,
				activeSquare: this.s.state.activeSquare,
				animation,
				board: trackAndUnwrap(this.s.state.board),
				boardFlipped: this.s.state.boardFlipped,
				grabbedPiecePos: this.grabbedPiecePos(),
				visibleSquares: this.visibleSquares(),
				shouldHideNonVisible: shouldHideNonVisible(),
			}
			renderPieces(ctx, args)
		})
		//#endregion

		//#region render highlights
		createEffect(() => {
			const ctx = this.contexts.highlights
			scaleAndReset(ctx, this.s.state.boardSizeCss)
			const args: RenderHighlightsArgs = {
				squareSize: this.s.state.squareSize,
				activeSquare: this.s.state.activeSquare,
				renderedBoard: trackAndUnwrap(this.s.state.board),
				boardFlipped: this.s.state.boardFlipped,
				hoveredSquare: hoveredSquare(),
				visibleSquares: this.visibleSquares(),
				shouldHideNonVisible: shouldHideNonVisible(),
				lastMove: lastMove(),
				legalMovesForActiveSquare: this.legalMovesForActiveSquare(),
				playerColor: game.bottomPlayer.color,
			}
			renderHighlights(ctx, args)
		})
		//#endregion

		//#region render grabbed piece
		createEffect(() => {
			const ctx = this.contexts.grabbedPiece
			scaleAndReset(ctx, this.s.state.boardSizeCss)
			const args: RenderGrabbedPieceArgs = {
				squareSize: this.s.state.squareSize,
				grabbedPiecePos: this.grabbedPiecePos(),
				activeSquare: this.s.state.activeSquare,
				grabbedPiece: this.grabbedPiecePos() && this.s.state.activeSquare ? this.activeBoard().pieces[this.s.state.activeSquare] : null,
				placingDuck: placingDuck(),
				touchScreen: P.settings.usingTouch,
			}
			renderGrabbedPiece(ctx, args)
		})
		//#endregion

		//#endregion
	}

	pieceAnimationDone = createSignalProperty(false)
	async runPieceAnimation(args: PieceAnimationArgs) {
		if (this.game.gameConfig.variant === 'fog-of-war') {
			console.error('animations not supported in fog-of-war variant')
			return
		}
		args.storeUpdates ??= {}
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const animationAlreadyRunning = !!this.s.state.animation
		this.s.set({ ...args.storeUpdates, animation: { ...args, currentFrame: 0 } })

		// just highjack the existing animation loop if it's already running
		if (animationAlreadyRunning) return
		const runInner = () => {
			if (!this.s.state.animation === null) {
				this.pieceAnimationDone.set(true)
				return
			}
			if (this.s.state.animation!.currentFrame >= this.s.state.animation!.duration) {
				this.s.set({ animation: null })
				this.pieceAnimationDone.set(true)
				return
			}
			// renderPieces(this.contexts.pieces, this.s.state)
			this.s.set('animation', 'currentFrame', (f) => f + 1)
			requestAnimationFrame(runInner)
		}
		runInner()
		await until(this.pieceAnimationDone.get)
		this.pieceAnimationDone.set(false)
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
		return this.activeBoard().pieces[square]?.color === this.game.bottomPlayer.color
	}

	async updateBoardStatic(boardIndex: number) {
		this.s.set({
			boardIndex,
			board: this.game.state.boardHistory[boardIndex].board,
			animation: null,
			activeSquare: null,
			grabbingActivePiece: false,
		})
	}

	async updateBoardAnimated(boardIndex: number) {
		if (boardIndex === this.s.state.boardIndex) return
		if (boardIndex < 0 || boardIndex >= this.game.state.boardHistory.length) {
			throw new Error(`invalid board index: ${boardIndex}`)
		}
		const boardBefore = this.game.state.boardHistory[this.s.state.boardIndex].board
		const boardAfter = this.game.state.boardHistory[boardIndex].board
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

		const animDone = this.runPieceAnimation({
			boardBefore,
			duration: 20,
			movedPieces,
			addedPieces,
			removedPieceSquares,
			storeUpdates: { boardIndex, activeSquare: null, grabbingActivePiece: false, board: boardAfter },
		})
		await animDone
	}
}

//#region canvas rendering

type RenderBoardArgs = {
	squareSize: number
	boardFlipped: boolean
	visibleSquares: Set<string>
	shouldHideNonVisible: boolean
}

function renderBoard(ctx: CanvasRenderingContext2D, args: RenderBoardArgs) {
	// fill in light squares as background
	ctx.fillStyle = args.shouldHideNonVisible ? BOARD_COLORS.lightFog : BOARD_COLORS.light
	ctx.fillRect(0, 0, args.squareSize * 8, args.squareSize * 8)

	if (args.shouldHideNonVisible) {
		ctx.fillStyle = BOARD_COLORS.light
		for (const square of args.visibleSquares) {
			const coords = GL.coordsFromNotation(square)
			if ((coords.x + coords.y) % 2 === 0) continue
			const dispCoords = boardCoordsToDisplayCoords(coords, args.boardFlipped, args.squareSize)
			ctx.fillRect(dispCoords.x, dispCoords.y, args.squareSize, args.squareSize)
		}
	}

	// fill in dark squares
	for (let i = 0; i < 8; i++) {
		for (let j = i % 2; j < 8; j += 2) {
			const visible =
				!args.shouldHideNonVisible ||
				args.visibleSquares.has(
					GL.notationFromCoords({
						x: j,
						y: i,
					})
				)

			const { x, y } = boardCoordsToDisplayCoords({ x: j, y: i }, args.boardFlipped, args.squareSize)

			ctx.fillStyle = visible ? BOARD_COLORS.dark : BOARD_COLORS.darkFog
			ctx.fillRect(x, y, args.squareSize, args.squareSize)
		}
	}
}

type RenderPiecesArgs = {
	animation: PieceAnimation | null
	board: GL.Board
	visibleSquares: Set<string>
	shouldHideNonVisible: boolean
	grabbedPiecePos: {
		x: number
		y: number
	} | null
	activeSquare: string | null
	boardFlipped: boolean
	squareSize: number
}

function renderPieces(ctx: CanvasRenderingContext2D, args: RenderPiecesArgs) {
	const pieces = args.animation ? args.animation.boardBefore.pieces : args.board.pieces
	for (const [square, piece] of Object.entries(pieces)) {
		if ((args.grabbedPiecePos && args.activeSquare === square) || (args.shouldHideNonVisible ? !args.visibleSquares.has(square) : false)) {
			continue
		}

		const dispCoords = boardCoordsToDisplayCoords(GL.coordsFromNotation(square), args.boardFlipped, args.squareSize)
		let movedPiece: MovedPiece | undefined
		if (args.animation && (movedPiece = args.animation.movedPieces.find((m) => m.from === square))) {
			const to = GL.coordsFromNotation(movedPiece.to)
			const fromDisp = dispCoords
			const toDisp = boardCoordsToDisplayCoords(to, args.boardFlipped, args.squareSize)

			const distanceX = toDisp.x - fromDisp.x
			const distanceY = toDisp.y - fromDisp.y

			const stepX = distanceX / args.animation.duration
			const stepY = distanceY / args.animation.duration

			dispCoords.x += stepX * args.animation.currentFrame
			dispCoords.y += stepY * args.animation.currentFrame
		}
		ctx.drawImage(Pieces.getCachedPiece(piece), dispCoords.x, dispCoords.y, args.squareSize, args.squareSize)
	}

	if (!args.animation) return
	if (args.activeSquare && args.animation) throw new Error('active square should not be set during animation')
	for (const [square, piece] of Object.entries(args.animation.addedPieces)) {
		if ((args.grabbedPiecePos && args.activeSquare === square) || (args.shouldHideNonVisible ? !args.visibleSquares.has(square) : false)) {
			continue
		}

		const dispCoords = boardCoordsToDisplayCoords(GL.coordsFromNotation(square), args.boardFlipped, args.squareSize)
		ctx.drawImage(Pieces.getCachedPiece(piece), dispCoords.x, dispCoords.y, args.squareSize, args.squareSize)
	}
}

type RenderHighlightsArgs = {
	renderedBoard: GL.Board
	lastMove: GL.Move | null
	visibleSquares: Set<string>
	playerColor: GL.Color
	shouldHideNonVisible: boolean
	activeSquare: string | null
	hoveredSquare: string | null
	legalMovesForActiveSquare: string[]
	boardFlipped: boolean
	squareSize: number
}

function renderHighlights(ctx: CanvasRenderingContext2D, args: RenderHighlightsArgs) {
	//#region draw last move highlight
	const highlightColor = '#aff682'
	if (args.lastMove && !args.shouldHideNonVisible) {
		const highlightedSquares = [args.lastMove.from, args.lastMove.to]
		for (const square of highlightedSquares) {
			if (!square) continue
			const { x, y } = squareNotationToDisplayCoords(square, args.boardFlipped, args.squareSize)
			ctx.fillStyle = highlightColor
			ctx.fillRect(x, y, args.squareSize, args.squareSize)
		}
	}
	//#endregion

	//#region draw legal move highlights
	const dotColor = '#f2f2f2'
	const captureHighlightColor = '#fc3c3c'
	if (P.settings.showAvailablemoves) {
		for (const moveTo of args.legalMovesForActiveSquare) {
			// draw dot in center of move end
			const moveToCoords = GL.coordsFromNotation(moveTo)
			const { x, y } = boardCoordsToDisplayCoords(moveToCoords, args.boardFlipped, args.squareSize)
			const piece = args.renderedBoard.pieces[GL.notationFromCoords(moveToCoords)]
			// we need to check if the piece is our color we visually move pieces in the current board view while we're placing a duck and promoting
			if (piece && piece.type !== 'duck' && piece.color !== args.playerColor) {
				ctx.fillStyle = captureHighlightColor
				ctx.fillRect(x, y, args.squareSize, args.squareSize)
			} else {
				ctx.fillStyle = dotColor
				ctx.beginPath()
				ctx.arc(x + args.squareSize / 2, y + args.squareSize / 2, args.squareSize / 10, 0, 2 * Math.PI)
				ctx.fill()
				ctx.closePath()
			}
		}
	}

	//#endregion

	function renderHighlightRect(color: string, square: string) {
		const { x, y } = squareNotationToDisplayCoords(square, args.boardFlipped, args.squareSize)
		ctx.beginPath()
		ctx.strokeStyle = color
		const lineWidth = args.squareSize / 16
		ctx.lineWidth = lineWidth
		ctx.rect(x + lineWidth / 2, y + lineWidth / 2, args.squareSize - lineWidth, args.squareSize - lineWidth)
		ctx.stroke()
		ctx.closePath()
	}

	//#region draw hovered move highlight
	const moveHighlightColor = '#ffffff'
	if (args.hoveredSquare && args.activeSquare && args.legalMovesForActiveSquare.find((m) => m === args.hoveredSquare!)) {
		// draw empty square in hovered square
		renderHighlightRect(moveHighlightColor, args.hoveredSquare!)
	}
	//#endregion

	//#region draw clicked move highlight
	const clickedHighlightColor = '#809dfd'

	if (args.activeSquare) {
		renderHighlightRect(clickedHighlightColor, args.activeSquare)
	}

	//#endregion
}

type RenderGrabbedPieceArgs = {
	grabbedPiecePos: {
		x: number
		y: number
	} | null
	squareSize: number
	activeSquare: string | null
	placingDuck: boolean
	touchScreen: boolean
	grabbedPiece: GL.ColoredPiece | null
}

function renderGrabbedPiece(ctx: CanvasRenderingContext2D, args: RenderGrabbedPieceArgs) {
	// TODO fix
	// const size = args.touchScreen ? args.squareSize * 1.5 : args.squareSize
	const size = args.squareSize
	if (args.grabbedPiecePos && args.grabbedPiece) {
		const x = args.grabbedPiecePos!.x
		const y = args.grabbedPiecePos!.y
		ctx.drawImage(Pieces.getCachedPiece(args.grabbedPiece), x - size / 2, y - size / 2, size, size)
	}

	if (args.placingDuck && args.grabbedPiecePos) {
		const { x, y } = args.grabbedPiecePos!
		ctx.drawImage(Pieces.getCachedPiece(GL.DUCK), x - size / 2, y - size / 2, size, size)
	}
}

//#endregion

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

export function squareNotationToDisplayCoords(square: string, boardFlipped: boolean, squareSize: number) {
	const { x, y } = GL.coordsFromNotation(square)
	return boardCoordsToDisplayCoords({ x, y }, boardFlipped, squareSize)
}

function scaleAndReset(context: CanvasRenderingContext2D, size: number) {
	context.clearRect(0, 0, size, size)
	context.setTransform(1, 0, 0, 1, 0, 0)
	context.scale(devicePixelRatio, devicePixelRatio)
}

//#endregion helpers

//#region check if user is using touch screen

//#endregion
