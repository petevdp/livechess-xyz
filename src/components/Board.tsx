import {
	Accessor,
	batch,
	createEffect,
	createSignal,
	For,
	from,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from 'solid-js'
import { filter } from 'rxjs/operators'
import * as G from '../systems/game/game.ts'
import { PlayerWithColor } from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import { ColoredPiece } from '../systems/game/gameLogic.ts'
import * as R from '../systems/room.ts'
import * as P from '../systems/player.ts'
import * as Modal from './Modal.tsx'
import styles from './Board.module.css'
import { Button } from './Button.tsx'
import { firstValueFrom, from as rxFrom } from 'rxjs'

export function Board(props: { game: G.Game }) {
	const gameState = () => props.game.state
	const players = from(rxFrom(props.game.players()))
	const opponent = () =>
		players()?.find((p) => p.id !== P.player()!.id && !p.spectator) as G.PlayerWithColor | undefined
	const player = () => players()?.find((p) => p.id === P.player()!.id) as G.PlayerWithColor | undefined

	//#region board rendering and mouse events
	const imageCache: Record<string, HTMLImageElement> = {}
	const canvas = (<canvas class={styles.board} width={600} height={600} />) as HTMLCanvasElement
	const squareSize = canvas.width / 8
	const [boardFlipped, setBoardFlipped] = createSignal(false)
	const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
	const [grabbedSquare, setGrabbedSquare] = createSignal(null as null | string)
	const [clickedSquare, setClickedSquare] = createSignal(null as null | string)
	const [grabbedSquareMousePos, setGrabbedSquareMousePos] = createSignal(null as null | { x: number; y: number })
	function render() {
		const ctx = canvas.getContext('2d')!

		// set background to light brown
		ctx.fillStyle = '#eaaa69'
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		// fill in squars as dark brown
		const highlightColor = '#aff682'

		// fill in dark squares
		ctx.fillStyle = '#a05a2c'
		for (let i = 0; i < 8; i++) {
			for (let j = (i + 1) % 2; j < 8; j += 2) {
				ctx.fillRect(j * squareSize, i * squareSize, squareSize, squareSize)
			}
		}

		let gameState = props.game.state
		if (gameState.lastMove) {
			const highlightedSquares =
				gameState.moveHistory.length > 0 ? [gameState.lastMove.from, gameState.lastMove.to] : []
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

		for (let [square, piece] of Object.entries(gameState.board.pieces)) {
			if (square === grabbedSquare()) {
				continue
			}
			const _promotionSelection = props.game.promotion()
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

		if (grabbedSquare() && grabbedSquareMousePos()) {
			let x = grabbedSquareMousePos()!.x
			let y = grabbedSquareMousePos()!.y
			ctx.drawImage(
				imageCache[resolvePieceImagePath(gameState.board.pieces[grabbedSquare()!]!)],
				x - squareSize / 2,
				y - squareSize / 2,
				squareSize,
				squareSize
			)
		}
		requestAnimationFrame(render)
	}

	createEffect(() => {
		if (player() && player()!.color === 'black') {
			setBoardFlipped(true)
		}
	})

	onMount(async () => {
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
					props.game.tryMakeMove(clickedSquare()!, hoveredSquare()!)
					setClickedSquare(null)
				} else if (
					hoveredSquare() &&
					gameState().board.pieces[hoveredSquare()!] &&
					(G.playForBothSides ||
						gameState().board.pieces[hoveredSquare()!]!.color === props.game.playerColor(P.player()!.id))
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
					props.game.tryMakeMove(_grabbedSquare!, square)
					setGrabbedSquare(null)
				}
			})
		})

		await Promise.all(
			Object.values(gameState().board.pieces).map(async (piece) => {
				const src = resolvePieceImagePath(piece)
				imageCache[src] = await loadImage(src)
			})
		)

		requestAnimationFrame(render)
	})

	// contextually set cursor
	createEffect(() => {
		if (grabbedSquare()) {
			canvas.style.cursor = 'grabbing'
		} else if (
			hoveredSquare() &&
			gameState().board.pieces[hoveredSquare()!] &&
			(G.playForBothSides ||
				gameState().board.pieces[hoveredSquare()!]!.color === props.game.playerColor(P.player()!.id))
		) {
			canvas.style.cursor = 'grab'
		} else {
			canvas.style.cursor = 'default'
		}
	})
	//#endregion

	// @ts-ignore
	const setPromotion = (piece: GL.PromotionPiece) =>
		props.game.setPromotion({
			status: 'selected',
			piece,
			from: props.game.promotion()!.from,
			to: props.game.promotion()!.to,
		})

	//#region game over modal
	const [isGameOverModalDisposed, setIsGameOverModalDisposed] = createSignal(false)

	onCleanup(() => {
		setIsGameOverModalDisposed(true)
	})
	;(async function handleGameEnd() {
		const outcome = await props.game.waitForGameOutcome()

		Modal.prompt(
			'Game over',
			(_props) => {
				return (
					<div>
						<GameOutcomeDisplay outcome={outcome} />
						<Button
							kind="primary"
							onclick={() => {
								_props.onCompleted(true)
								R.room()!.dispatchRoomAction({ type: 'play-again' })
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

		console.log('setting up playagain')
		await firstValueFrom(
			R.room()!
				.yClient.observeEvent('roomAction', false)
				.pipe(filter((a) => a.type === 'play-again'))
		)
		console.log('play again')

		setIsGameOverModalDisposed(true)
	})().catch((err) => console.error(err))
	//#endregion

	const gameOutcome = from(props.game.observeGameOutcome()) as Accessor<GL.GameOutcome | null>
	const drawOfferedPlayerId = from(props.game.observeDrawOffered()) as Accessor<string | null>
	const timesElapsed = from(props.game.observeClock()) as Accessor<{ [playerId: string]: number }>

	return (
		<div class={styles.boardContainer}>
			<Show when={opponent()}>
				<PlayerDisplay player={opponent()!} class={styles.opponent} clock={timesElapsed()[opponent()!.id]} />
			</Show>
			{canvas}
			<Show when={player()}>
				<PlayerDisplay player={player()!} class={styles.player} clock={timesElapsed()[player()!.id]} />
			</Show>
			<div class={styles.leftPanel}>
				<GameStateDisplay state={gameState()} outcome={gameOutcome()} />
				<Show when={props.game}>
					<Button kind="primary" onClick={() => R.room()!.dispatchRoomAction({ type: 'play-again' })}>
						Play Again
					</Button>
				</Show>
				<div class="align-center flex flex-col">
					<For each={gameState().moveHistory}>
						{(move) => (
							<pre>
								<code class="text-neutral-400">
									{move.from} {move.to}
								</code>
							</pre>
						)}
					</For>
				</div>
				<Show when={GL.inCheck(gameState())}>Check!</Show>
			</div>
			<div class={styles.rightPanel}>
				<Button kind="secondary" onclick={() => setBoardFlipped((f) => !f)} class="mb-1">
					flip
				</Button>
				<Button kind="secondary" onclick={() => props.game.offerDraw()} class="mb-1">
					offer draw
				</Button>
				<Button kind="secondary" onclick={() => props.game.resign()} class="mb-1">
					resign
				</Button>
				<Show when={drawOfferedPlayerId()}>
					<DrawOffers playerId={drawOfferedPlayerId()!} player={player()!} opponent={opponent()!} />
				</Show>
			</div>
			<Show when={props.game.promotion()?.status === 'selecting'}>
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

function DrawOffers(props: { playerId: string; player: G.PlayerWithColor; opponent: G.PlayerWithColor }) {
	const isPlayer = () => props.playerId === props.player.id
	const cancelDraw = () => R.room()!.dispatchRoomAction({ type: 'cancel-draw' })
	const acceptDraw = () => R.room()!.dispatchRoomAction({ type: 'offer-draw' })
	return (
		<Switch>
			<Match when={isPlayer()}>
				<div>You have Offered a draw</div>
				<Button onClick={cancelDraw} kind="primary">
					Cancel
				</Button>
			</Match>
			<Match when={!isPlayer()}>
				<div>
					<i>{props.opponent.name}</i> has offered a draw
				</div>
				<Button onClick={acceptDraw} kind="primary">
					Accept
				</Button>
				<Button kind={'secondary'} onClick={cancelDraw}>
					Decline
				</Button>
			</Match>
		</Switch>
	)
}

function GameStateDisplay(props: { state: GL.GameState; outcome: GL.GameOutcome | null }) {
	return (
		<span>
			{!props.outcome ? `${props.state.board.toMove} to move` : <GameOutcomeDisplay outcome={props.outcome} />}
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

function PlayerDisplay(props: { player: PlayerWithColor; class: string; clock: number }) {
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

function resolvePieceImagePath(piece: ColoredPiece) {
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
