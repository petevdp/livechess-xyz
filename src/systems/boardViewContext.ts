import { until } from '@solid-primitives/promise'
import { Accessor, createEffect, createMemo, getOwner, untrack } from 'solid-js'
import { unwrap } from 'solid-js/store'

import { BOARD_COLORS } from '~/config'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as Pieces from '~/systems/piece.ts'
import { DefaultMap } from '~/utils/defaultMap'
import { deepClone } from '~/utils/obj.ts'
import { StoreProperty, createSignalProperty, createStoreProperty, storeToSignal } from '~/utils/solid'

type BoardViewState = {
	squareSize: number
	boardSize: number
	boardSizeCss: number
	boardFlipped: boolean
	boardIndex: number
	// may not match board in the game's history
	board: GL.Board
	grabbedPiecePos: {
		x: number
		y: number
	} | null
	activeSquare: string | null
	hoveredSquare: string | null
}

type BoardView = BoardViewState & {
	lastMove: GL.Move | null
	shouldHideNonVisible: boolean
	visibleSquares: Set<string>
	legalMovesForActiveSquare: string[]
	animation: PieceAnimation | null
	placingDuck: boolean
}

type PieceAnimation = PieceAnimationArgs & { currentFrame: number }
type PieceAnimationArgs = {
	// in frames for now
	duration: number
	boardBefore: GL.Board
	mutations: { to: string; from: string }[]
	storeUpdates?: Partial<BoardViewState>
}

export class BoardViewContext {
	store: StoreProperty<BoardViewState>
	readonly view!: BoardView
	/**
	 * present in the view but their state is not tracked. useful when animation
	 */
	untracked = {
		animation: null as null | PieceAnimation,
	}

	contexts!: {
		board: CanvasRenderingContext2D
		pieces: CanvasRenderingContext2D
		highlights: CanvasRenderingContext2D
		grabbedPiece: CanvasRenderingContext2D
	}

	constructor(private game: G.Game) {
		if (!getOwner()) throw new Error('Owner not set')

		this.store = createStoreProperty<BoardViewState>({
			squareSize: 32,
			boardSize: 100,
			boardSizeCss: 100,
			activeSquare: null,
			board: deepClone(unwrap(game.board)),
			boardFlipped: false,
			grabbedPiecePos: null,
			hoveredSquare: null,
			boardIndex: game.state.boardHistory.length - 1,
		})

		const stateSignal = storeToSignal(this.store.state)
		const legalMovesForActiveSquare = createMemo(() => {
			const activeSquare = this.store.state.activeSquare
			const boardIndex = this.store.state.boardIndex
			if (!activeSquare || boardIndex !== game.state.boardHistory.length - 1) return []
			const moves = GL.getLegalMoves([GL.coordsFromNotation(activeSquare)], game.state, game.gameConfig.variant)
			return moves.map((m) => GL.notationFromCoords(m.to))
		})
		const viewSignal = createMemo(() => {
			return {
				...stateSignal(),
				...this.untracked,
				shouldHideNonVisible: false,
				visibleSquares: new Set(),
				legalMovesForActiveSquare: legalMovesForActiveSquare(),
				lastMove: game.state.moveHistory[this.store.state.boardIndex - 1] || null,
				placingDuck: game.placingDuck(),
			} satisfies BoardView as BoardView
		})
		Object.defineProperty(this, 'view', { get: viewSignal })

		//#region canvas rendering

		//#region render board
		createEffect(() => {
			const ctx = this.contexts.board
			scaleAndReset(ctx, this.view.boardSizeCss)
			renderBoard(ctx, this.view)
		})
		//#endregion

		//#region render pieces
		createEffect(() => {
			const ctx = this.contexts.pieces
			if (!Pieces.initialized() || this.view.animation) return
			scaleAndReset(ctx, this.view.boardSizeCss)
			renderPieces(ctx, this.view)
		})
		//#endregion

		//#region render highlights
		createEffect(() => {
			const ctx = this.contexts.highlights
			scaleAndReset(ctx, this.view.boardSizeCss)
			renderHighlights(ctx, this.view)
		})
		//#endregion

		//#region render grabbed piece
		createEffect(() => {
			const ctx = this.contexts.grabbedPiece
			scaleAndReset(ctx, this.view.boardSizeCss)
			renderGrabbedPiece(ctx, this.view)
		})
		//#ednregion

		//#endregion
	}

	pieceAnimationDone = createSignalProperty(false)
	async runPieceAnimation(args: PieceAnimationArgs) {
		if (this.game.gameConfig.variant === 'fog-of-war') {
			console.error('animations not supported in fog-of-war variant')
			return
		}
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const animationAlreadyRunning = !!this.view.animation
		this.untracked.animation = {
			...args,
			currentFrame: 0,
		}
		args.storeUpdates && this.store.set(args.storeUpdates)

		// just highjack the existing animation loop if it's already running
		if (animationAlreadyRunning) return
		const runInner = () => {
			if (this.view.animation!.currentFrame >= this.view.animation!.duration) {
				this.untracked.animation = null
				this.pieceAnimationDone.set(true)
				return
			}
			renderPieces(this.contexts.pieces, this.view)
			this.untracked.animation!.currentFrame++
			requestAnimationFrame(runInner)
		}
		runInner()
		await until(this.pieceAnimationDone.get)
		this.pieceAnimationDone.set(false)
	}

	async returnBoardToLive() {
		const boardIndex = this.view.boardIndex
		if (boardIndex === this.game.state.boardHistory.length - 1) return
		const boardNext = this.game.state.boardHistory[this.game.state.boardHistory.length - 1].board
		const boardCurrent = this.game.state.boardHistory[boardIndex].board
		const moveCurrent = this.game.state.moveHistory[boardIndex - 1]
		await this.runPieceAnimation({
			boardBefore: boardCurrent,
			duration: 30,
			mutations: [{ from: moveCurrent.from, to: moveCurrent.to }],
			storeUpdates: { boardIndex: this.game.state.boardHistory.length - 1, board: boardNext },
		})
	}

	async morphToBoardIndex(boardIndex: number) {
		if (boardIndex === this.view.boardIndex) return
		if (boardIndex < 0 || boardIndex >= this.game.state.boardHistory.length) {
			throw new Error(`invalid board index: ${boardIndex}`)
		}
		const boardBefore = this.game.state.boardHistory[this.view.boardIndex].board
		const boardAfter = this.game.state.boardHistory[boardIndex].board
		const mutations: { from: string; to: string }[] = []
		const availableStartingPieceCounts = new DefaultMap<string, string[]>(() => [])
		const getPieceKey = (piece: GL.ColoredPiece) => `${piece.type}:${piece.color}`
		for (const [square, piece] of Object.entries(boardBefore.pieces)) {
			const key = getPieceKey(piece)
			// square contains same piece, no need to move it
			if (key === getPieceKey(boardAfter.pieces[square])) continue
			const arr = availableStartingPieceCounts.get(key) || []
			arr.push(square)
			availableStartingPieceCounts.set(key, arr)
		}

		for (const [toSquare, piece] of Object.entries(boardAfter.pieces)) {
			const key = getPieceKey(piece)
			const squares = availableStartingPieceCounts.get(key)
			if (!squares || squares.length === 0) continue
			const fromSquare = squares.pop()!
			mutations.push({ from: fromSquare, to: toSquare })
		}
		this.store.set({ boardIndex })
		const animDone = this.runPieceAnimation({
			boardBefore,
			duration: 30,
			mutations,
		})
		await animDone
	}
}

//#region canvas rendering

function renderBoard(ctx: CanvasRenderingContext2D, args: BoardView) {
	// fill in light squares as background
	ctx.fillStyle = args.shouldHideNonVisible ? BOARD_COLORS.lightFog : BOARD_COLORS.light
	ctx.fillRect(0, 0, args.squareSize * 8, args.squareSize * 8)

	if (args.shouldHideNonVisible) {
		ctx.fillStyle = BOARD_COLORS.light
		for (const square of args.visibleSquares) {
			let { x, y } = GL.coordsFromNotation(square)
			if ((x + y) % 2 === 0) continue
			;[x, y] = boardCoordsToDisplayCoords({ x, y }, args.boardFlipped, args.squareSize)
			ctx.fillRect(x, y, args.squareSize, args.squareSize)
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

			const [x, y] = boardCoordsToDisplayCoords({ x: j, y: i }, args.boardFlipped, args.squareSize)

			ctx.fillStyle = visible ? BOARD_COLORS.dark : BOARD_COLORS.darkFog
			ctx.fillRect(x, y, args.squareSize, args.squareSize)
		}
	}
}

function renderPieces(ctx: CanvasRenderingContext2D, args: BoardView) {
	const pieces = args.animation ? args.animation.boardBefore.pieces : args.board.pieces
	for (const [square, piece] of Object.entries(pieces)) {
		if ((args.grabbedPiecePos && args.activeSquare === square) || (args.shouldHideNonVisible ? !args.visibleSquares.has(square) : false)) {
			continue
		}

		let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
		let y = 8 - parseInt(square[1])
		if (args.boardFlipped) {
			x = 7 - x
			y = 7 - y
		}

		if (args.animation) {
			const mutationStart = args.animation.mutations.find((m) => m.from === square)
			// piece is part
			if (mutationStart) {
				const from = GL.coordsFromNotation(mutationStart.from)
				const to = GL.coordsFromNotation(mutationStart.to)

				const distanceX = (to.x - from.x) * args.squareSize
				const distanceY = (to.y - from.y) * args.squareSize

				const stepX = distanceX / args.animation.duration
				const stepY = distanceY / args.animation.duration

				x = from.x * args.squareSize + stepX * args.animation.currentFrame
				y = from.y * args.squareSize + stepY * args.animation.currentFrame
			}
			const mutationEnd = args.animation.mutations.find((m) => m.to === square)
		}

		ctx.drawImage(Pieces.getCachedPiece(piece), x * args.squareSize, y * args.squareSize, args.squareSize, args.squareSize)
	}
}

function renderHighlights(ctx: CanvasRenderingContext2D, args: BoardView) {
	//#region draw last move highlight
	const highlightColor = '#aff682'
	if (args.lastMove && !args.shouldHideNonVisible) {
		const highlightedSquares = [args.lastMove.from, args.lastMove.to]
		for (const square of highlightedSquares) {
			if (!square) continue
			const [x, y] = squareNotationToDisplayCoords(square, args.boardFlipped, args.squareSize)
			ctx.fillStyle = highlightColor
			ctx.fillRect(x, y, args.squareSize, args.squareSize)
		}
	}
	//#endregion

	//#region draw legal move highlights
	const dotColor = '#f2f2f2'
	const captureHighlightColor = '#fc3c3c'
	if (P.settings.showAvailablemoves) {
		for (const move of args.legalMovesForActiveSquare) {
			// draw dot in center of move end
			const [x, y] = boardCoordsToDisplayCoords(move.to, args.boardFlipped, args.squareSize)
			const piece = args.board.pieces[GL.notationFromCoords(move.to)]
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
		const [x, y] = squareNotationToDisplayCoords(square, args.boardFlipped, args.squareSize)
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
	if (
		args.hoveredSquare &&
		args.activeSquare &&
		args.legalMovesForActiveSquare.some((m) => deepEquals(m.to, GL.coordsFromNotation(args.hoveredSquare!)))
	) {
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
	context: CanvasRenderingContext2D
	grabbedMousePos: {
		x: number
		y: number
	} | null
	boardView: G.BoardView
	squareSize: number
	activePieceSquare: string | null
	placingDuck: boolean
	currentMousePos: {
		x: number
		y: number
	} | null
	touchScreen: boolean
}

function renderGrabbedPiece(ctx: CanvasRenderingContext2D, args: BoardView) {
	// TODO fix
	// const size = args.touchScreen ? args.squareSize * 1.5 : args.squareSize
	const size = args.squareSize
	if (args.grabbedPiecePos) {
		const x = args.grabbedPiecePos!.x
		const y = args.grabbedPiecePos!.y
		ctx.drawImage(Pieces.getCachedPiece(args.board.pieces[args.activeSquare!]!), x - size / 2, y - size / 2, size, size)
	}

	if (args.placingDuck && args.grabbedPiecePos) {
		const { x, y } = args.grabbedPiecePos!
		ctx.drawImage(Pieces.getCachedPiece(GL.DUCK), x - size / 2, y - size / 2, size, size)
	}
}

//#endregion

//#region helpers
function showGameOutcome(outcome: GL.GameOutcome): [string, string] {
	const game = G.game()!
	const winner = outcome.winner ? game.players.find((p) => p.color === outcome.winner)! : null
	const winnerTitle = `${winner?.name} (${winner?.color})`
	switch (outcome.reason) {
		case 'checkmate':
			return [`${winnerTitle} wins`, ` checkmate`]
		case 'stalemate':
			return ['Draw!', 'Stalemate']
		case 'insufficient-material':
			return ['Draw!', 'Insufficient Material']
		case 'threefold-repetition':
			return ['Draw!', 'Threefold Repetition']
		case 'draw-accepted':
			return ['Agreed to a draw', '']
		case 'resigned':
			return [`${winnerTitle} wins`, 'resignation']
		case 'flagged':
			return [`${winnerTitle} wins`, 'out of time']
		case 'king-captured':
			return [`${winnerTitle} wins`, `king captured`]
	}
}

function boardCoordsToDisplayCoords(square: GL.Coords, boardFlipped: boolean, squareSize: number) {
	let { x, y } = square
	if (!boardFlipped) {
		y = 7 - y
	} else {
		x = 7 - x
	}
	return [x * squareSize, y * squareSize] as [number, number]
}

function squareNotationToDisplayCoords(square: string, boardFlipped: boolean, squareSize: number) {
	const { x, y } = GL.coordsFromNotation(square)
	return boardCoordsToDisplayCoords({ x, y }, boardFlipped, squareSize)
}

function checkPastWarnThreshold(timeControl: GL.TimeControl, clock: number) {
	if (timeControl === 'unlimited') return false
	switch (timeControl) {
		case '1m':
			return clock < 1000 * 15
		case '3m':
			return clock < 1000 * 30
		case '5m':
			return clock < 1000 * 45
		case '10m':
			return clock < 1000 * 60
		case '15m':
			return clock < 1000 * 60 * 2
	}
}

function scaleAndReset(context: CanvasRenderingContext2D, size: number) {
	context.clearRect(0, 0, size, size)
	context.setTransform(1, 0, 0, 1, 0, 0)
	context.scale(devicePixelRatio, devicePixelRatio)
}

//#endregion helpers

//#region check if user is using touch screen

//#endregion
