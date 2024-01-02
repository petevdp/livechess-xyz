import { batch, createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import * as G from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import * as Modal from './Modal.tsx'
import styles from './Board.module.css'
import { Button } from './Button.tsx'
import { until } from '@solid-primitives/promise'

//TODO provide some method to view the current game's config

export function Board() {
	const game = G.game()!
	//#region board rendering and mouse events
	const imageCache: Record<string, HTMLImageElement> = {}
	const canvas = (<canvas class={styles.board} width={600} height={600} />) as HTMLCanvasElement
	const squareSize = canvas.width / 8
	const [boardFlipped, setBoardFlipped] = createSignal(false)
	const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
	const [grabbedSquare, setGrabbedSquare] = createSignal(null as null | string)
	const [clickedSquare, setClickedSquare] = createSignal(null as null | string)
	const [grabbedSquareMousePos, setGrabbedSquareMousePos] = createSignal(null as null | { x: number; y: number })

	// TODO explore using dirty checking for partial rendering instead of brute force
	//#region rendering
	function render() {
		const ctx = canvas.getContext('2d')!
		//#region draw board

		// set background to light brown
		ctx.fillStyle = '#eaaa69'
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		// fill in squars as dark brown

		// fill in dark squares
		ctx.fillStyle = '#a05a2c'
		for (let i = 0; i < 8; i++) {
			for (let j = (i + 1) % 2; j < 8; j += 2) {
				ctx.fillRect(j * squareSize, i * squareSize, squareSize, squareSize)
			}
		}
		//#endregion

		//#region draw last move highlight
		const highlightColor = '#aff682'
		if (game.lastMove) {
			const highlightedSquares = [game.lastMove.from, game.lastMove.to]
			for (let square of highlightedSquares) {
				if (!square) continue
				let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
				let y = 8 - parseInt(square[1])
				if (boardFlipped()) {
					x = 7 - x
					y = 7 - y
				}
				ctx.fillStyle = highlightColor
				ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize)
			}
		}
		//#endregion

		//#region draw pieces
		for (let [square, piece] of Object.entries(game.board.pieces)) {
			if (square === grabbedSquare()) {
				continue
			}
			const _promotionSelection = game.promotion()
			if (_promotionSelection && _promotionSelection.status === 'selecting' && _promotionSelection.to === square) {
				continue
			}

			if (_promotionSelection && _promotionSelection.status === 'selecting' && _promotionSelection.from === square) {
				square = _promotionSelection.to
			}

			let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
			let y = 8 - parseInt(square[1])
			if (boardFlipped()) {
				x = 7 - x
				y = 7 - y
			}
			ctx.drawImage(imageCache[resolvePieceImagePath(piece)], x * squareSize, y * squareSize, squareSize, squareSize)
		}
		//#endregion

		//#region draw grabbed piece
		if (grabbedSquare() && grabbedSquareMousePos()) {
			let x = grabbedSquareMousePos()!.x
			let y = grabbedSquareMousePos()!.y
			ctx.drawImage(
				imageCache[resolvePieceImagePath(game.board.pieces[grabbedSquare()!]!)],
				x - squareSize / 2,
				y - squareSize / 2,
				squareSize,
				squareSize
			)
		}
		//#endregion

		// run this function every frame
		requestAnimationFrame(render)
	}

	// preload piece images
	onMount(async () => {
		await Promise.all(
			Object.values(game.board.pieces).map(async (piece) => {
				const src = resolvePieceImagePath(piece)
				imageCache[src] = await loadImage(src)
			})
		)
		requestAnimationFrame(render)
	})

	createEffect(() => {
		if (game.player && game.player.color === 'black') {
			setBoardFlipped(true)
		}
	})

	// contextually set cursor style
	createEffect(() => {
		if (grabbedSquare()) {
			canvas.style.cursor = 'grabbing'
		} else if (hoveredSquare() && game.board.pieces[hoveredSquare()!] && game.board.pieces[hoveredSquare()!]!.color === game.player.color) {
			canvas.style.cursor = 'grab'
		} else {
			canvas.style.cursor = 'default'
		}
	})

	//#endregion

	//#region mouse events
	onMount(() => {
		function getSquareFromCoords(x: number, y: number) {
			let col = Math.floor(x / squareSize)
			let row = Math.floor(y / squareSize)
			if (boardFlipped()) {
				col = 7 - col
				row = 7 - row
			}

			return String.fromCharCode('a'.charCodeAt(0) + col) + (8 - row)
		}

		// track mouse

		canvas.addEventListener('mousemove', (e) => {
			batch(() => {
				const rect = canvas.getBoundingClientRect()
				const x = e.clientX - rect.left
				const y = e.clientY - rect.top
				// check if mouse is over a square with a piece
				setHoveredSquare(getSquareFromCoords(x, y))
				if (grabbedSquare()) {
					setGrabbedSquareMousePos({ x, y })
				}
			})
		})

		canvas.addEventListener('mousedown', (e) => {
			batch(() => {
				if (clickedSquare() && hoveredSquare() && clickedSquare() !== hoveredSquare()) {
					game.tryMakeMove(clickedSquare()!, hoveredSquare()!)
					setClickedSquare(null)
				} else if (
					hoveredSquare() &&
					game.board.pieces[hoveredSquare()!] &&
					game.board.pieces[hoveredSquare()!]!.color === game.player.color
				) {
					setGrabbedSquare(hoveredSquare)
					const rect = canvas.getBoundingClientRect()
					setGrabbedSquareMousePos({
						x: e.clientX - rect.left,
						y: e.clientY - rect.top,
					})
				}
			})
		})

		canvas.addEventListener('mouseup', (e) => {
			batch(() => {
				const rect = canvas.getBoundingClientRect()
				const square = getSquareFromCoords(e.clientX - rect.left, e.clientY - rect.top)
				const _grabbedSquare = grabbedSquare()
				if (_grabbedSquare && _grabbedSquare === hoveredSquare()) {
					setClickedSquare(square)
					setGrabbedSquare(null)
				} else if (_grabbedSquare && _grabbedSquare !== hoveredSquare()) {
					game.tryMakeMove(_grabbedSquare!, square)
					setGrabbedSquare(null)
				}
			})
		})
	})

	//#endregion

	//#endregion

	// @ts-ignore
	const setPromotion = (piece: GL.PromotionPiece) =>
		game.setPromotion({
			status: 'selected',
			piece,
			from: game.promotion()!.from,
			to: game.promotion()!.to,
		})

	//#region game over modal
	const [isGameOverModalDisposed, setIsGameOverModalDisposed] = createSignal(false)

	onCleanup(() => {
		setIsGameOverModalDisposed(true)
	})
	;(async function handleGameEnd() {
		const outcome = await until(() => game.outcome)
		Modal.prompt(
			(_props) => {
				console.log('rendering outocme')
				return (
					<div>
						<GameOutcomeDisplay outcome={outcome} />
						<Button
							kind="primary"
							onclick={() => {
								_props.onCompleted(true)
								game.room.configureNewGame()
							}}
						>
							Play Again
						</Button>
					</div>
				)
			},
			false,
			isGameOverModalDisposed
		)
		await until(() => game.room.state.status === 'pregame')
		setIsGameOverModalDisposed(true)
	})().catch((err) => console.error(err))
	//#endregion

	return (
		<div class={styles.boardContainer}>
			<PlayerDisplay player={game.opponent} class={styles.opponent} clock={game.clock[game.opponent.color]} />
			{canvas}
			<PlayerDisplay player={game.player} class={styles.player} clock={game.clock[game.player.color]} />
			<div class={styles.leftPanel}>
				<GameStateDisplay inCheck={game.inCheck} toMove={game.board.toMove} outcome={game.outcome} />
				<Show when={game.room.state.status === 'postgame'}>
					<Button kind="primary" onClick={() => game.room.configureNewGame()}>
						Play Again
					</Button>
				</Show>
				<div class="align-center flex flex-col">
					<For each={game.moveHistoryAsNotation}>{(move) => <code class="text-neutral-400">{move}</code>}</For>
				</div>
			</div>
			<div class={styles.rightPanel}>
				<Button kind="secondary" onclick={() => setBoardFlipped((f) => !f)} class="mb-1">
					flip
				</Button>
				<Button kind="secondary" onclick={() => game.offerDraw()} class="mb-1">
					offer draw
				</Button>
				<Button kind="secondary" onclick={() => game.resign()} class="mb-1">
					resign
				</Button>
				<Show when={game.drawIsOfferedBy}>
					<DrawOffers
						offeredBy={game.drawIsOfferedBy}
						player={game.player}
						opponent={game.opponent}
						cancelDraw={() => game.cancelDraw()}
						acceptDraw={() => game.offerDraw()}
						declineDraw={() => game.declineDraw()}
					/>
				</Show>
			</div>
			<Show when={game.promotion()?.status === 'selecting'}>
				{GL.PROMOTION_PIECES.map((piece) => {
					return (
						<Button kind={'secondary'} onclick={() => setPromotion(piece)}>
							{piece}
						</Button>
					)
				})}
			</Show>
		</div>
	)
}

function DrawOffers(props: {
	offeredBy: GL.Color
	player: G.PlayerWithColor
	opponent: G.PlayerWithColor
	acceptDraw: () => void
	declineDraw: () => void
	cancelDraw: () => void
}) {
	const isPlayer = () => props.offeredBy === props.player.color
	return (
		<Switch>
			<Match when={isPlayer()}>
				<div>You have Offered a draw</div>
				<Button onClick={props.cancelDraw} kind="primary">
					Cancel
				</Button>
			</Match>
			<Match when={!isPlayer()}>
				<div>
					<i>{props.opponent.name}</i> has offered a draw
				</div>
				<Button onClick={props.acceptDraw} kind="primary">
					Accept
				</Button>
				<Button kind={'secondary'} onClick={props.declineDraw}>
					Decline
				</Button>
			</Match>
		</Switch>
	)
}

function GameStateDisplay(props: { toMove: GL.Color; outcome: GL.GameOutcome | null; inCheck: boolean }) {
	return (
		<span>
			{!props.outcome ? `${props.toMove} to move` : <GameOutcomeDisplay outcome={props.outcome} />}
			{props.inCheck && <span class="text-red-400">Check!</span>}
		</span>
	)
}

function GameOutcomeDisplay(props: { outcome: GL.GameOutcome }) {
	return (
		<span>
			{props.outcome.reason}
			{props.outcome.winner ? `: ${props.outcome.winner} wins!` : ''}
		</span>
	)
}

function PlayerDisplay(props: { player: G.PlayerWithColor; class: string; clock: number }) {
	const formattedClock = () => {
		// clock is in ms
		const minutes = Math.floor(props.clock / 1000 / 60)
		const seconds = Math.floor((props.clock / 1000) % 60)
		if (minutes === 0) {
			const tenths = Math.floor((props.clock / 100) % 10)
			const hundredths = Math.floor((props.clock / 10) % 10)
			return `${seconds}.${tenths}${hundredths}`
		}
		return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
	}
	return (
		<div class={props.class}>
			{props.player.name} <i class="text-neutral-400">({props.player.color})</i> {formattedClock()}
		</div>
	)
}

function resolvePieceImagePath(piece: GL.ColoredPiece) {
	const abbrs = {
		pawn: 'p',
		knight: 'n',
		bishop: 'b',
		rook: 'r',
		queen: 'q',
		king: 'k',
	}
	const color = piece.color == 'white' ? 'l' : 'd'

	return `/pieces/${abbrs[piece.type]}${color}t45.svg`
}

function loadImage(src: string) {
	return new Promise<HTMLImageElement>((resolve) => {
		const img = new Image()
		img.src = src
		img.onload = () => {
			resolve(img)
		}
	})
}
