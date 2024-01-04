import { batch, createEffect, createReaction, createSignal, For, Match, onCleanup, onMount, ParentProps, Show, Switch } from 'solid-js'
import * as G from '../systems/game/game.ts'
import { setGame } from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import * as Modal from './Modal.tsx'
import styles from './Board.module.css'
import toast from 'solid-toast'
import { Button } from './Button.tsx'
import { unwrap } from 'solid-js/store'
import * as P from '../systems/player.ts'
import * as R from '../systems/room.ts'

//TODO provide some method to view the current game's config
//TODO component duplicates on reload sometimes for some reason

const BOARD_SIZE = 600
const SQUARE_SIZE = BOARD_SIZE / 8

export function Board() {
	let game = G.game()!
	if (!game || game.destroyed) {
		const gameConfig = unwrap(R.room()!.state.gameConfig)
		game = new G.Game(R.room()!, P.playerId()!, gameConfig)
		setGame(game)
	}
	onCleanup(() => {
		game.destroy()
	})

	//#region board rendering and mouse events
	const imageCache: Record<string, HTMLImageElement> = {}
	const canvas = (<canvas class={styles.board} width={BOARD_SIZE} height={BOARD_SIZE} />) as HTMLCanvasElement
	const [boardFlipped, setBoardFlipped] = createSignal(false)
	const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
	const [grabbedSquare, setGrabbedSquare] = createSignal(null as null | string)
	const [clickedSquare, setClickedSquare] = createSignal(null as null | string)
	const [grabbedSquareMousePos, setGrabbedSquareMousePos] = createSignal(null as null | { x: number; y: number })

	// TODO Lots of optimization to be done here
	//#region rendering
	function render() {
		if (game.destroyed) {
			return
		}

		const ctx = canvas.getContext('2d')!
		//#region draw board

		// fill in light squares as background
		ctx.fillStyle = '#eaaa69'
		ctx.fillRect(0, 0, canvas.width, canvas.height)

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
							<img alt={pp} src={resolvePieceImagePath({ color: game.player.color, type: pp })} />
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
	const [canShowGameOverModal, setCanShowGameOverModal] = createSignal(false)
	onCleanup(() => {
		setIsGameOverModalDisposed(true)
	})

	const trackGameOver = createReaction(async () => {
		Modal.prompt(
			(_props) => {
				return (
					<div class="flex flex-col items-center space-y-1">
						<GameOutcomeDisplay outcome={game.outcome!} />
						<div class="space-x-1">
							<NewGameButton />
							<Button size="medium" kind="secondary" onclick={() => _props.onCompleted(false)}>
								Continue
							</Button>
						</div>
					</div>
				)
			},
			false,
			isGameOverModalDisposed
		).then(() => {
			setIsGameOverModalDisposed(true)
		})
	})

	trackGameOver(canShowGameOverModal)

	let loadTime = Date.now()
	createEffect(() => {
		if (game.outcome && !isGameOverModalDisposed() && Date.now() - loadTime > 100) {
			setCanShowGameOverModal(true)
		}
	})

	//#endregion

	//#region draw offer events
	{
		const sub = game.drawEvent$.subscribe((eventType) => {
			switch (eventType) {
				case 'awaiting-response':
					toast.success(`Offered Draw. Awaiting response from ${game.opponent.name}`)
					break
				case 'declined':
					toast.success('Draw was declined')
					break
				case 'offered-by-opponent':
					toast.success(`${game.opponent.name} has offered a draw`)
					break
				case 'opponent-cancelled':
					toast.success(`${game.opponent.name} has cancelled their draw offer`)
					break
				case 'player-cancelled':
					toast.success('Draw offer cancelled')
					break
			}
		})
		onCleanup(() => {
			sub.unsubscribe()
		})
	}

	//#endregion

	return (
		<div class={styles.boardContainer}>
			<PlayerDisplay player={game.opponent} class={styles.opponent} clock={game.clock[game.opponent.color]} />
			{canvas}
			<PlayerContainer/>
			<div class={styles.leftPanel}>
				<MoveHistory/>
			</div>
			<div class={styles.moveNav}>
				<MoveNav/>
			</div>
			<div class={styles.rightPanel}>
				<Button title={'Flip Board'} kind="tertiary" size="small" onclick={() => setBoardFlipped((f) => !f)}
								class="mb-1">
					<FlipSvg/>
				</Button>
			</div>
		</div>
	)
}

function PlayerContainer() {
	const game = G.game()!

	return (
		<div class={styles.playerContainer}>
			<span>
				<Switch>
					<Match when={!game.outcome}>
						<Show when={game.drawIsOfferedBy === null}>
							<Button title="Offer Draw" size="small" kind="tertiary" onclick={() => game.offerDraw()}>
								<OfferDrawSvg />
							</Button>
							<Button title="Resign" kind="tertiary" size="small" onclick={() => game.resign()}>
								<ResignSvg />
							</Button>
						</Show>
						<Switch>
							<Match when={game.drawIsOfferedBy === game.player.color}>
								<Button kind="primary" size="small" onClick={() => game.cancelDraw()}>
									Cancel Draw
								</Button>
							</Match>
							<Match when={game.drawIsOfferedBy === game.opponent.color}>
								<Button kind="primary" size="small" onClick={() => game.offerDraw()}>
									Accept Draw
								</Button>
							</Match>
						</Switch>
					</Match>
					<Match when={game.outcome}>
						<Button size="small" kind="primary" onclick={() => game.configureNewGame()}>
							New Game
						</Button>
					</Match>
				</Switch>
			</span>
			<PlayerDisplay player={game.player} class={styles.player} clock={game.clock[game.player.color]}/>
			<div class={styles.actionsPanelLeft}>
				<Show when={game.drawIsOfferedBy}>
					<div>idk</div>
				</Show>
			</div>
		</div>
	)
}

// TODO use a "ready up" system here instead
function NewGameButton() {
	const game = G.game()!
	return (
		<Button size="medium" kind="primary" onclick={() => game.configureNewGame()}>
			New Game
		</Button>
	)
}

//TODO fix current viewed move highlight
function MoveHistory() {
	const game = G.game()!
	const _setViewedMove = setViewedMove(game)
	return (
		<div class="align-center flex h-full w-full flex-col justify-between space-y-1">
			<div>
				<Button size="small" kind={game.viewedMoveIndex() === 0 ? 'secondary' : 'tertiary'} onClick={() => _setViewedMove(-1)}>
					Start
				</Button>
				<For each={game.moveHistoryAsNotation}>
					{(move, index) => (
						<code class="text-neutral-400">
							{index()}.{' '}
							<Button
								size="small"
								kind={game.viewedMoveIndex() === index() * 2 ? 'secondary' : 'tertiary'}
								onClick={() => _setViewedMove(index() * 2)}
							>
								{move[0]}
							</Button>{' '}
							<Show when={move[1]}>
								<Button
									size="small"
									kind={game.viewedMoveIndex() === index() * 2 + 1 ? 'secondary' : 'tertiary'}
									onClick={() => _setViewedMove(index() * 2 + 1)}
								>
									{move[1]}
								</Button>
							</Show>
						</code>
					)}
				</For>
			</div>
		</div>
	)
}

const setViewedMove = (game: G.Game) => (move: number | 'live') => {
	if (move === 'live') {
		game.setViewedMove(game.rollbackState.moveHistory.length - 1)
	} else if (move >= -1 && move < game.rollbackState.moveHistory.length) {
		game.setViewedMove(move)
	}
}

function MoveNav() {
	const game = G.game()!
	const _setViewedMove = setViewedMove(game)
	return (
		<div class="flex justify-evenly">
			<Button kind="tertiary" size="small" disabled={game.viewedMoveIndex() === -1} onClick={() => _setViewedMove(-1)}>
				<FirstStepSvg />
			</Button>
			<Button
				kind="tertiary"
				size="small"
				disabled={game.viewedMoveIndex() === -1}
				onClick={() => _setViewedMove(game.viewedMoveIndex() - 1)}
			>
				<PrevStepSvg />
			</Button>
			<Button kind="tertiary" size="small" onClick={() => _setViewedMove(game.viewedMoveIndex() + 1)}>
				<NextStepSvg />
			</Button>
			<Button
				kind="tertiary"
				size="small"
				disabled={game.viewedMoveIndex() === game.rollbackState.moveHistory.length - 1}
				onClick={() => _setViewedMove('live')}
			>
				<LastStepSvg />
			</Button>
		</div>
	)
}

//#region ugly svgs

function OfferDrawSvg() {
	return (
		<svg xmlns="http://www.w3.org/2000/svg" height="16" width="20" fill="white" viewBox="0 0 640 512">
			<path d="M323.4 85.2l-96.8 78.4c-16.1 13-19.2 36.4-7 53.1c12.9 17.8 38 21.3 55.3 7.8l99.3-77.2c7-5.4 17-4.2 22.5 2.8s4.2 17-2.8 22.5l-20.9 16.2L512 316.8V128h-.7l-3.9-2.5L434.8 79c-15.3-9.8-33.2-15-51.4-15c-21.8 0-43 7.5-60 21.2zm22.8 124.4l-51.7 40.2C263 274.4 217.3 268 193.7 235.6c-22.2-30.5-16.6-73.1 12.7-96.8l83.2-67.3c-11.6-4.9-24.1-7.4-36.8-7.4C234 64 215.7 69.6 200 80l-72 48V352h28.2l91.4 83.4c19.6 17.9 49.9 16.5 67.8-3.1c5.5-6.1 9.2-13.2 11.1-20.6l17 15.6c19.5 17.9 49.9 16.6 67.8-2.9c4.5-4.9 7.8-10.6 9.9-16.5c19.4 13 45.8 10.3 62.1-7.5c17.9-19.5 16.6-49.9-2.9-67.8l-134.2-123zM16 128c-8.8 0-16 7.2-16 16V352c0 17.7 14.3 32 32 32H64c17.7 0 32-14.3 32-32V128H16zM48 320a16 16 0 1 1 0 32 16 16 0 1 1 0-32zM544 128V352c0 17.7 14.3 32 32 32h32c17.7 0 32-14.3 32-32V144c0-8.8-7.2-16-16-16H544zm32 208a16 16 0 1 1 32 0 16 16 0 1 1 -32 0z" />
		</svg>
	)
}

function ResignSvg() {
	return (
		<svg fill="white" xmlns="http://www.w3.org/2000/svg" height="16" width="14" viewBox="0 0 448 512">
			<path d="M64 32C64 14.3 49.7 0 32 0S0 14.3 0 32V64 368 480c0 17.7 14.3 32 32 32s32-14.3 32-32V352l64.3-16.1c41.1-10.3 84.6-5.5 122.5 13.4c44.2 22.1 95.5 24.8 141.7 7.4l34.7-13c12.5-4.7 20.8-16.6 20.8-30V66.1c0-23-24.2-38-44.8-27.7l-9.6 4.8c-46.3 23.2-100.8 23.2-147.1 0c-35.1-17.6-75.4-22-113.5-12.5L64 48V32z" />
		</svg>
	)
}

function FlipSvg() {
	return (
		<svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" fill="white" viewBox="0 0 512 512">
			<path d="M256 96c38.4 0 73.7 13.5 101.3 36.1l-32.6 32.6c-4.6 4.6-5.9 11.5-3.5 17.4s8.3 9.9 14.8 9.9H448c8.8 0 16-7.2 16-16V64c0-6.5-3.9-12.3-9.9-14.8s-12.9-1.1-17.4 3.5l-34 34C363.4 52.6 312.1 32 256 32c-10.9 0-21.5 .8-32 2.3V99.2c10.3-2.1 21-3.2 32-3.2zM132.1 154.7l32.6 32.6c4.6 4.6 11.5 5.9 17.4 3.5s9.9-8.3 9.9-14.8V64c0-8.8-7.2-16-16-16H64c-6.5 0-12.3 3.9-14.8 9.9s-1.1 12.9 3.5 17.4l34 34C52.6 148.6 32 199.9 32 256c0 10.9 .8 21.5 2.3 32H99.2c-2.1-10.3-3.2-21-3.2-32c0-38.4 13.5-73.7 36.1-101.3zM477.7 224H412.8c2.1 10.3 3.2 21 3.2 32c0 38.4-13.5 73.7-36.1 101.3l-32.6-32.6c-4.6-4.6-11.5-5.9-17.4-3.5s-9.9 8.3-9.9 14.8V448c0 8.8 7.2 16 16 16H448c6.5 0 12.3-3.9 14.8-9.9s1.1-12.9-3.5-17.4l-34-34C459.4 363.4 480 312.1 480 256c0-10.9-.8-21.5-2.3-32zM256 416c-38.4 0-73.7-13.5-101.3-36.1l32.6-32.6c4.6-4.6 5.9-11.5 3.5-17.4s-8.3-9.9-14.8-9.9H64c-8.8 0-16 7.2-16 16l0 112c0 6.5 3.9 12.3 9.9 14.8s12.9 1.1 17.4-3.5l34-34C148.6 459.4 199.9 480 256 480c10.9 0 21.5-.8 32-2.3V412.8c-10.3 2.1-21 3.2-32 3.2z" />
		</svg>
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

//#endregion

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
	const game = G.game()!
	const winner = props.outcome.winner ? game.getColorPlayer(props.outcome.winner) : null
	const winnerTitle = `${winner?.name} (${winner?.color})`
	switch (props.outcome.reason) {
		case 'checkmate':
			return `${winnerTitle} wins by checkmate!`
		case 'stalemate':
			return 'Draw! (Stalemate)'
		case 'insufficient-material':
			return 'Draw! Insufficient Material'
		case 'threefold-repetition':
			return 'Draw! Threefold Repetition'
		case 'draw-accepted':
			return 'Agreed to a draw'
		case 'resigned':
			return `${winnerTitle} wins by resignation`
		case 'flagged':
			return `${winnerTitle} wins on time`
	}
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
			<span class="w-7">{formattedClock()}</span> {props.player.name} <i class="text-neutral-400">({props.player.color})</i>
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
