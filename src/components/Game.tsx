import { batch, createEffect, createMemo, createReaction, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import * as R from '~/systems/room.ts'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as PC from '~/systems/piece.ts'
import * as Modal from './Modal.tsx'
import styles from './Game.module.css'
import toast from 'solid-toast'
import { Button } from './ui/button.tsx'
import FirstSvg from '~/assets/icons/first.svg'
import FlipBoardSvg from '~/assets/icons/flip-board.svg'
import LastSvg from '~/assets/icons/last.svg'
import NextSvg from '~/assets/icons/next.svg'
import OfferDrawSvg from '~/assets/icons/offer-draw.svg'
import PrevSvg from '~/assets/icons/prev.svg'
import ResignSvg from '~/assets/icons/resign.svg'
import { BOARD_COLORS } from '~/config.ts'
import { isEqual } from 'lodash'

//TODO provide some method to view the current game's config
//TODO component duplicates on reload sometimes for some reason

const imageCache: Record<string, HTMLImageElement> = {}

export function Game(props: { gameId: string }) {
	let game = new G.Game(props.gameId, R.room()!, R.room()!.player.id, R.room()!.rollbackState.gameConfig)
	G.setGame(game)

	//#region calc board sizes
	// let BOARD_SIZE = 600
	// let SQUARE_SIZE = BOARD_SIZE / 8
	const [windowSize, setWindowSize] = createSignal({ width: window.innerWidth, height: window.innerHeight })
	onMount(() => {
		window.addEventListener('resize', () => {
			setWindowSize({ width: window.innerWidth, height: window.innerHeight })
		})
	})

	const layout: () => 'column' | 'row' = () => {
		if (windowSize().width < windowSize().height) {
			return 'row'
		} else {
			return 'column'
		}
	}

	const boardSize = (): number => {
		if (windowSize().width < windowSize().height && windowSize().width > 700) {
			return windowSize().width - 80
		} else if (windowSize().width < windowSize().height && windowSize().width < 700) {
			return windowSize().width - 20
		} else {
			return windowSize().height - 170
		}
	}

	const squareSize = () => boardSize() / 8

	//#endregion

	//#region board rendering and mouse events
	const canvas = (<canvas width={boardSize()} height={boardSize()} />) as HTMLCanvasElement
	const [boardFlipped, setBoardFlipped] = createSignal(false)
	const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
	const [grabbedSquare, setGrabbedSquare] = createSignal(null as null | string)
	const [clickedSquare, setClickedSquare] = createSignal(null as null | string)
	const [grabbedSquareMousePos, setGrabbedSquareMousePos] = createSignal(null as null | { x: number; y: number })

	const activeSquare = () => grabbedSquare() || clickedSquare()

	const legalMovesForActivePiece = createMemo(() => {
		const _square = activeSquare()
		if (!_square) return []
		return game.getLegalMovesForSquare(_square)
	})

	// TODO Lots of optimization to be done here
	//#region rendering
	function render() {
		const ctx = canvas.getContext('2d')!
		//#region draw board

		// fill in light squares as background
		ctx.fillStyle = BOARD_COLORS.light
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		// fill in dark squares
		ctx.fillStyle = BOARD_COLORS.dark
		for (let i = 0; i < 8; i++) {
			for (let j = (i + 1) % 2; j < 8; j += 2) {
				ctx.fillRect(j * squareSize(), i * squareSize(), squareSize(), squareSize())
			}
		}
		//#endregion

		//#region draw last move highlight
		const highlightColor = '#aff682'
		if (game.currentBoardView.lastMove) {
			const highlightedSquares = [game.currentBoardView.lastMove.from, game.currentBoardView.lastMove.to]
			for (let square of highlightedSquares) {
				if (!square) continue
				const [x, y] = squareNotationToDisplayCoords(square, boardFlipped(), squareSize())
				ctx.fillStyle = highlightColor
				ctx.fillRect(x, y, squareSize(), squareSize())
			}
		}
		//#endregion

		//#region draw legal move highlights
		const dotColor = '#f2f2f2'
		const captureHighlightColor = '#fc3c3c'
		for (let move of legalMovesForActivePiece()) {
			// draw dot in center of move end
			const [x, y] = boardCoordsToDisplayCoords(move.to, boardFlipped(), squareSize())
			if (game.currentBoardView.board.pieces[GL.notationFromCoords(move.to)]) {
				ctx.fillStyle = captureHighlightColor
				ctx.fillRect(x, y, squareSize(), squareSize())
			} else {
				ctx.fillStyle = dotColor
				ctx.beginPath()
				ctx.arc(x + squareSize() / 2, y + squareSize() / 2, squareSize() / 10, 0, 2 * Math.PI)
				ctx.fill()
				ctx.closePath()
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
			ctx.drawImage(imageCache[PC.resolvePieceImagePath(piece)], x * squareSize(), y * squareSize(), squareSize(), squareSize())
		}
		//#endregion

		//#region draw hovered move highlight
		const moveHighlightColor = '#ffffff'
		if (
			hoveredSquare() &&
			activeSquare() &&
			legalMovesForActivePiece().some((m) => isEqual(m.to, GL.coordsFromNotation(hoveredSquare()!)))
		) {
			// draw empty square in hovered square
			const [x, y] = squareNotationToDisplayCoords(hoveredSquare()!, boardFlipped(), squareSize())
			ctx.beginPath()
			ctx.strokeStyle = moveHighlightColor
			ctx.lineWidth = 6
			ctx.rect(x + 3, y + 3, squareSize() - 6, squareSize() - 6)
			ctx.stroke()
			ctx.closePath()
		}
		//#endregion

		//#region draw clicked move highlight
		const clickedHighlightColor = '#809dfd'

		if (clickedSquare()) {
			const [x, y] = squareNotationToDisplayCoords(clickedSquare()!, boardFlipped(), squareSize())
			ctx.beginPath()
			ctx.strokeStyle = clickedHighlightColor
			ctx.lineWidth = 6
			ctx.rect(x + 3, y + 3, squareSize() - 6, squareSize() - 6)
			ctx.stroke()
			ctx.closePath()
		}

		//#endregion

		//#region draw grabbed piece
		if (grabbedSquare() && grabbedSquareMousePos()) {
			let x = grabbedSquareMousePos()!.x
			let y = grabbedSquareMousePos()!.y
			ctx.drawImage(
				imageCache[PC.resolvePieceImagePath(game.currentBoardView.board.pieces[grabbedSquare()!]!)],
				x - squareSize() / 2,
				y - squareSize() / 2,
				squareSize(),
				squareSize()
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
				const src = PC.resolvePieceImagePath(piece)
				if (imageCache[src]) return
				imageCache[src] = await PC.loadImage(src)
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
			let col = Math.floor(x / squareSize())
			let row = Math.floor(y / squareSize())
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
				}

				if (
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
		let [x, y] = squareNotationToDisplayCoords(game.promotion()!.to, boardFlipped(), squareSize())
		y += canvas.getBoundingClientRect().top + window.scrollY
		x += canvas.getBoundingClientRect().left + window.scrollX
		if (boardSize() / 2 < x) {
			x -= 180
		}

		return [x, y].map((c) => `${c}px`) as [string, string]
	}

	Modal.addModal({
		title: null,
		render: () => (
			<div class="flex w-[180px] flex-row justify-between space-x-1">
				<For each={GL.PROMOTION_PIECES}>
					{(pp) => (
						<Button
							classList={{ 'bg-neutral-200': game.player.color !== 'white' }}
							variant={game.player.color === 'white' ? 'ghost' : 'default'}
							size="icon"
							onclick={() => setPromotion(pp)}
						>
							<img alt={pp} src={PC.resolvePieceImagePath({ color: game.player.color, type: pp })} />
						</Button>
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
		console.log('disposing game over modal')
		setIsGameOverModalDisposed(true)
	})

	const trackGameOver = createReaction(async () => {
		Modal.prompt(
			(_props) => {
				return (
					<div class="flex flex-col items-center space-y-1">
						<GameOutcomeDisplay outcome={game.outcome!} />
						<div class="space-x-1">
							<Button onclick={() => game.room.configureNewGame()}>New Game</Button>
							<Button onclick={() => _props.onCompleted(false)}>Continue</Button>
						</div>
					</div>
				)
			},
			false,
			isGameOverModalDisposed
		)
			.catch((err) => {
				console.log('received error after modal prompt')
				console.trace(err)
			})
			.then(() => {
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
					toast.error('Draw was declined')
					break
				case 'offered-by-opponent':
					toast.success(`${game.opponent.name} has offered a draw`)
					break
				case 'opponent-cancelled':
					toast.error(`${game.opponent.name} has cancelled their draw offer`)
					break
				case 'player-cancelled':
					toast.error('Draw offer cancelled')
					break
			}
		})
		onCleanup(() => {
			sub.unsubscribe()
		})
	}

	//#endregion

	return (
		<div class={styles.boardPageWrapper}>
			<div class={styles.boardContainer}>
				<div class={styles.moveHistoryContainer}>
					<MoveHistory />
				</div>
				<Player class={styles.opponent} player={game.opponent} />
				<Clock class={styles.clockOpponent} clock={game.clock[game.opponent.color]} ticking={!game.isPlayerTurn} />
				<div class={`${styles.topLeftActions} flex flex-col items-start space-x-1`}>
					<Button variant="ghost" size="icon" onclick={() => setBoardFlipped((f) => !f)} class="mb-1">
						<FlipBoardSvg />
					</Button>
				</div>
				<CapturedPieces size={boardSize() / 2} layout={layout()} pieces={game.capturedPieces(game.opponent.color)} is={'opponent'} />
				<CapturedPieces size={boardSize() / 2} layout={layout()} pieces={game.capturedPieces(game.player.color)} is={'player'} />
				<div class={styles.board}>{canvas}</div>
				<ActionsPanel class={styles.bottomLeftActions} />
				<Player class={styles.player} player={game.player} />
				<Clock class={styles.clockPlayer} clock={game.clock[game.player.color]} ticking={game.isPlayerTurn} />
				<div class={styles.moveNav}>
					<MoveNav />
				</div>
			</div>
		</div>
	)
}

function Player(props: { player: G.PlayerWithColor; class: string }) {
	return (
		<div class={props.class + ' m-auto whitespace-nowrap'}>
			{props.player.name} <i class="text-neutral-400">({props.player.color})</i>
		</div>
	)
}

function Clock(props: { clock: number; class: string; ticking: boolean }) {
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
	// TODO add warning threshold for time
	// const warnThreshold = () => game.gameConfig

	return <span class={`flex justify-end text-xl ${props.class} ${!props.ticking ? 'text-neutral-400' : ''}`}>{formattedClock()}</span>
}

function ActionsPanel(props: { class: string }) {
	const game = G.game()!
	return (
		<span class={props.class}>
			<Switch>
				<Match when={!game.outcome}>
					<Show when={game.drawIsOfferedBy === null}>
						<Button title="Offer Draw" size="icon" variant="ghost" onclick={() => game.offerDraw()}>
							<OfferDrawSvg />
						</Button>
						<Button title="Resign" size="icon" variant="ghost" onclick={() => game.resign()}>
							<ResignSvg />
						</Button>
					</Show>
					<Switch>
						<Match when={game.drawIsOfferedBy === game.player.color}>
							<Button onClick={() => game.cancelDraw()}>Cancel Draw</Button>
						</Match>
						<Match when={game.drawIsOfferedBy === game.opponent.color}>
							<Button onClick={() => game.offerDraw()}>Accept Draw</Button>
						</Match>
					</Switch>
				</Match>
				<Match when={game.outcome}>
					<Button size="sm" onclick={() => game.room.configureNewGame()}>
						New Game
					</Button>
				</Match>
			</Switch>
		</span>
	)
}

//TODO fix current viewed move highlight
function MoveHistory() {
	const game = G.game()!
	const _setViewedMove = setViewedMove(game)
	return (
		<div class={styles.moveHistory}>
			<div class={styles.moveHistoryEntry}>
				<pre class="mr-1">
					<code> 0.</code>
				</pre>
				<div>
					<Button size="sm" variant={game.viewedMoveIndex() === -1 ? 'secondary' : 'ghost'} onClick={() => _setViewedMove(-1)}>
						Start
					</Button>
				</div>
			</div>
			<For each={game.moveHistoryAsNotation}>
				{(move, index) => {
					const viewingFirstMove = () => game.viewedMoveIndex() === index() * 2
					const viewingSecondMove = () => game.viewedMoveIndex() === index() * 2 + 1
					return (
						<>
							<div
								classList={{
									[styles.moveHistoryEntry]: true,
									[styles.singleMove]: index() + 1 === game.moveHistoryAsNotation.length && game.rollbackState.moveHistory.length % 2 === 1,
								}}
							>
								<pre class="mr-1">
									<code>{(index() + 1).toString().padStart(2, ' ')}.</code>
								</pre>
								<div>
									<Button
										class="p-[.25rem"
										classList={{
											'font-light': !viewingFirstMove(),
										}}
										size="sm"
										variant={viewingFirstMove() ? 'secondary' : 'ghost'}
										onClick={() => _setViewedMove(index() * 2)}
									>
										{move[0]}
									</Button>{' '}
									<Show when={move[1]}>
										<Button
											size="sm"
											classList={{
												'font-light': viewingSecondMove(),
											}}
											variant={viewingSecondMove() ? 'secondary' : 'ghost'}
											onClick={() => _setViewedMove(index() * 2 + 1)}
										>
											{move[1]}
										</Button>
									</Show>
								</div>
							</div>
						</>
					)
				}}
			</For>
		</div>
	)
}

function CapturedPieces(props: { pieces: GL.ColoredPiece[]; is: 'player' | 'opponent'; size: number; layout: 'column' | 'row' }) {
	return (
		<div
			class={`${styles.capturedPieces} ${styles[props.is]}`}
			// style={{ [props.layout === 'row' ? 'width' : 'height']: `${props.size - 20}px` }}
		>
			<For each={props.pieces}>
				{(piece) => (
					<img class={styles.capturedPiece} src={PC.resolvePieceImagePath(piece)} alt={piece.type} title={`${piece.color} ${piece.type}`} />
				)}
			</For>
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
			<Button size="icon" variant="ghost" disabled={game.viewedMoveIndex() === -1} onClick={() => _setViewedMove(-1)}>
				<FirstSvg />
			</Button>
			<Button
				class="text-blue-600"
				variant="ghost"
				size="icon"
				disabled={game.viewedMoveIndex() === -1}
				onClick={() => _setViewedMove(game.viewedMoveIndex() - 1)}
			>
				<PrevSvg />
			</Button>
			<Button
				disabled={game.viewedMoveIndex() === game.rollbackState.moveHistory.length - 1}
				variant="ghost"
				size="icon"
				onClick={() => _setViewedMove(game.viewedMoveIndex() + 1)}
			>
				<NextSvg />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				disabled={game.viewedMoveIndex() === game.rollbackState.moveHistory.length - 1}
				onClick={() => _setViewedMove('live')}
			>
				<LastSvg />
			</Button>
		</div>
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
