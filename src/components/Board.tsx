import { batch, createEffect, createSignal, For, Match, onCleanup, onMount, ParentProps, Show, Switch } from 'solid-js'
import * as G from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import * as Modal from './Modal.tsx'
import styles from './Board.module.css'
import { Button } from './Button.tsx'
import { until } from '@solid-primitives/promise'

//TODO provide some method to view the current game's config

const BOARD_SIZE = 600
const SQUARE_SIZE = BOARD_SIZE / 8

export function Board() {
	const game = G.game()!
	//#region board rendering and mouse events
	const imageCache: Record<string, HTMLImageElement> = {}
	const canvas = (<canvas class={styles.board} width={BOARD_SIZE} height={BOARD_SIZE} />) as HTMLCanvasElement
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
				ctx.fillRect(j * SQUARE_SIZE, i * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE)
			}
		}
		//#endregion

		//#region draw last move highlight
		const highlightColor = '#aff682'
		if (game.currentBoardView.lastMove) {
			const highlightedSquares = [game.currentBoardView.lastMove.from, game.currentBoardView.lastMove.to]
			for (let square of highlightedSquares) {
				if (!square) continue
				const [x, y] = squareToCoords(square, boardFlipped())
				ctx.fillStyle = highlightColor
				ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE)
			}
		}
		//#endregion

		//#region draw pieces
		for (let [square, piece] of Object.entries(game.currentBoardView.board.pieces)) {
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
			ctx.drawImage(imageCache[resolvePieceImagePath(piece)], x * SQUARE_SIZE, y * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE)
		}
		//#endregion

		//#region draw grabbed piece
		if (grabbedSquare() && grabbedSquareMousePos()) {
			let x = grabbedSquareMousePos()!.x
			let y = grabbedSquareMousePos()!.y
			ctx.drawImage(
				imageCache[resolvePieceImagePath(game.currentBoardView.board.pieces[grabbedSquare()!]!)],
				x - SQUARE_SIZE / 2,
				y - SQUARE_SIZE / 2,
				SQUARE_SIZE,
				SQUARE_SIZE
			)
		}
		//#endregion

		// run this function every frame
		requestAnimationFrame(render)
	}

	// preload piece images
	onMount(async () => {
		await Promise.all(
			Object.values(game.currentBoardView.board.pieces).map(async (piece) => {
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
		} else if (
			hoveredSquare() &&
			game.currentBoardView.board.pieces[hoveredSquare()!] &&
			game.currentBoardView.board.pieces[hoveredSquare()!]!.color === game.player.color
		) {
			canvas.style.cursor = 'grab'
		} else {
			canvas.style.cursor = 'default'
		}
	})

	//#endregion

	//#region mouse events
	onMount(() => {
		function getSquareFromCoords(x: number, y: number) {
			let col = Math.floor(x / SQUARE_SIZE)
			let row = Math.floor(y / SQUARE_SIZE)
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
					game.currentBoardView.board.pieces[hoveredSquare()!] &&
					game.currentBoardView.board.pieces[hoveredSquare()!]!.color === game.player.color
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

	//#region promotion
	const setPromotion = (piece: GL.PromotionPiece) => {
		game.tryMakeMove(game.promotion()!.from, game.promotion()!.to, piece)
		game.setPromotion(null)
	}

	const promoteModalPosition = () => {
		if (!game.promotion()) return undefined
		let coordsInt = squareToCoords(game.promotion()!.to, boardFlipped())
		coordsInt[0] = coordsInt[0] + canvas.getBoundingClientRect().left
		coordsInt[1] = coordsInt[1] + canvas.getBoundingClientRect().top

		return coordsInt.map((c) => `${c}px`) as [string, string]
	}

	Modal.addModal({
		title: null,
		render: () => (
			<div class="flex flex-row">
				<For each={GL.PROMOTION_PIECES}>
					{(pp) => (
						<button onclick={() => setPromotion(pp)}>
							<img src={resolvePieceImagePath({ color: game.player.color, type: pp })} />
						</button>
					)}
				</For>
			</div>
		),
		position: promoteModalPosition,
		visible: () => !!game.promotion() && game.promotion()!.status === 'selecting',
		closeOnEscape: false,
		closeOnOutsideClick: false,
		setVisible: () => {},
	})
	//#endregion

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
		await until(() => game.room.state.status === 'pregame' || isGameOverModalDisposed())
		!isGameOverModalDisposed() && setIsGameOverModalDisposed(true)
	})().catch()
	//#endregion

	return (
		<div class={styles.boardContainer}>
			<PlayerDisplay player={game.opponent} class={styles.opponent} clock={game.clock[game.opponent.color]} />
			{canvas}
			<PlayerDisplay player={game.player} class={styles.player} clock={game.clock[game.player.color]} />
			<div class={styles.leftPanel}>
				<GameStateDisplay inCheck={game.currentBoardView.inCheck} toMove={game.currentBoardView.board.toMove} outcome={game.outcome} />
				<Show when={game.room.state.status === 'postgame'}>
					<Button kind="primary" onClick={() => game.room.configureNewGame()}>
						Play Again
					</Button>
				</Show>
				<MoveHistory />
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
		<span class="w-full">
			{!props.outcome ? `${props.toMove} to move` : <GameOutcomeDisplay outcome={props.outcome} />}
			{props.inCheck && <span class="text-red-400">Check!</span>}
		</span>
	)
}

function MoveHistory() {
	const game = G.game()!
	return (
		<div class="align-center flex w-full flex-col space-y-1">
			<div class="flex justify-evenly">
				<button disabled={game.viewedMoveIndex() === -1} onClick={() => game.setViewedMove(-1)}>
					<FirstStepSvg />
				</button>
				<button disabled={game.viewedMoveIndex() === -1} onClick={() => game.setViewedMove(game.viewedMoveIndex() - 1)}>
					<PrevStepSvg />
				</button>
				<button onClick={() => game.setViewedMove(game.viewedMoveIndex() + 1)}>
					<NextStepSvg />
				</button>
				<button disabled={game.viewedMoveIndex() === game.rollbackState.moveHistory.length - 1} onClick={() => game.setViewedMove('live')}>
					<LastStepSvg />
				</button>
			</div>
			<MoveHistoryButton active={game.viewedMoveIndex() === -1} onClick={() => game.setViewedMove(-1)}>
				Start
			</MoveHistoryButton>
			<For each={game.moveHistoryAsNotation}>
				{(move, index) => (
					<code class="text-neutral-400">
						{index()}.{' '}
						<MoveHistoryButton active={game.viewedMoveIndex() === index() * 2} onClick={() => game.setViewedMove(index() * 2)}>
							{move[0]}
						</MoveHistoryButton>{' '}
						<Show when={move[1]}>
							<MoveHistoryButton active={game.viewedMoveIndex() === index() * 2 + 1} onClick={() => game.setViewedMove(index() * 2 + 1)}>
								{move[1]}
							</MoveHistoryButton>
						</Show>
					</code>
				)}
			</For>
		</div>
	)
}

function NextStepSvg() {
	return (
		<svg fill="rgb(212 212 212 / var(--tw-text-opacity))" xmlns="http://www.w3.org/2000/svg" height="16" width="10" viewBox="0 0 320 512">
			<path d="M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416V96C0 83.6 7.2 72.3 18.4 67s24.5-3.6 34.1 4.4l192 160L256 241V96c0-17.7 14.3-32 32-32s32 14.3 32 32V416c0 17.7-14.3 32-32 32s-32-14.3-32-32V271l-11.5 9.6-192 160z" />
		</svg>
	)
}

const svgFill = 'rgb(212 212 212 / var(--tw-text-opacity))'

function PrevStepSvg() {
	return (
		<svg fill={svgFill} xmlns="http://www.w3.org/2000/svg" height="16" width="10" viewBox="0 0 320 512">
			<path d="M267.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29V96c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4l-192 160L64 241V96c0-17.7-14.3-32-32-32S0 78.3 0 96V416c0 17.7 14.3 32 32 32s32-14.3 32-32V271l11.5 9.6 192 160z" />
		</svg>
	)
}

function LastStepSvg() {
	return (
		<svg fill={svgFill} xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 512 512">
			<path d="M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416V96C0 83.6 7.2 72.3 18.4 67s24.5-3.6 34.1 4.4L224 214.3V256v41.7L52.5 440.6zM256 352V256 128 96c0-12.4 7.2-23.7 18.4-29s24.5-3.6 34.1 4.4l192 160c7.3 6.1 11.5 15.1 11.5 24.6s-4.2 18.5-11.5 24.6l-192 160c-9.5 7.9-22.8 9.7-34.1 4.4s-18.4-16.6-18.4-29V352z" />
		</svg>
	)
}

function FirstStepSvg() {
	return (
		<svg fill={svgFill} xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 512 512">
			<path d="M459.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29V96c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4L288 214.3V256v41.7L459.5 440.6zM256 352V256 128 96c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4l-192 160C4.2 237.5 0 246.5 0 256s4.2 18.5 11.5 24.6l192 160c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29V352z" />
		</svg>
	)
}

export function MoveHistoryButton(props: ParentProps<{ active: boolean; onClick: () => void }>) {
	return (
		<button
			onClick={props.onClick}
			class="rounded p-1 text-xs text-neutral-300"
			classList={{
				['bg-neutral-700']: props.active,
				['cursor-default']: props.active,
			}}
		>
			{props.children}
		</button>
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

function squareToCoords(square: string, boardFlipped: boolean) {
	let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
	let y = 8 - parseInt(square[1])
	if (boardFlipped) {
		x = 7 - x
		y = 7 - y
	}
	return [x * SQUARE_SIZE, y * SQUARE_SIZE] as [number, number]
}
