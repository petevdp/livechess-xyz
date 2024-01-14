import {
	batch,
	createEffect,
	createMemo,
	createReaction,
	createSignal,
	For,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
	untrack,
} from 'solid-js'
import * as R from '~/systems/room.ts'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as PC from '~/systems/piece.ts'
import * as Modal from './utils/Modal.tsx'
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
import { cn } from '~/lib/utils.ts'
import moveSelfSound from '~/assets/audio/move-self.mp3'
import moveOpponentSound from '~/assets/audio/move-opponent.mp3'
import captureSound from '~/assets/audio/capture.mp3'
import checkSound from '~/assets/audio/move-check.mp3'
import promoteSound from '~/assets/audio/promote.mp3'
import castleSound from '~/assets/audio/castle.mp3'
import lowTimeSound from '~/assets/audio/low-time.mp3'
import { Dialog, DialogContent, DialogDescription, DialogHeader } from '~/components/ui/dialog.tsx'

//TODO provide some method to view the current game's config
//TODO component duplicates on reload sometimes for some reason
// TODO fix horizontal scrolling on large viewport

const imageCache: Record<string, HTMLImageElement> = {}

export function Game(props: { gameId: string }) {
	let game = new G.Game(props.gameId, R.room()!, R.room()!.rollbackState.gameConfig)
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
		} else if (windowSize().width < windowSize().height && windowSize().width <= 700) {
			return windowSize().width - 30
		} else {
			return windowSize().height - 170
		}
	}

	const squareSize = () => boardSize() / 8

	//#endregion

	//#region board rendering and mouse events
	const canvas = (<canvas width={boardSize()} height={boardSize()} />) as HTMLCanvasElement

	//#region board and interaction state
	const [boardFlipped, setBoardFlipped] = createSignal(false)
	const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
	const [activePieceSquare, setActivePieceSquare] = createSignal(null as null | string)
	const [grabbingPieceSquare, setGrabbingPieceSquare] = createSignal(false)
	const [currentMousePos, setCurrentMousePos] = createSignal({ x: 0, y: 0 } as { x: number; y: number } | null)
	const [grabbedMousePos, setGrabbedMousePos] = createSignal(null as null | { x: number; y: number })
	//#endregion

	const legalMovesForActivePiece = createMemo(() => {
		const _square = activePieceSquare()
		if (!_square) return []
		return game.getLegalMovesForSquare(_square)
	})

	// TODO Lots of optimization to be done here
	//#region rendering
	function render() {
		const ctx = canvas.getContext('2d')!
		//#region draw board
		const shouldHideNonVisible = game.gameConfig.variant === 'fog-of-war' && !game.outcome

		// fill in light squares as background
		ctx.fillStyle = shouldHideNonVisible ? BOARD_COLORS.lightFog : BOARD_COLORS.light
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		if (shouldHideNonVisible) {
			ctx.fillStyle = BOARD_COLORS.light
			for (let square of game.currentBoardView.visibleSquares) {
				let { x, y } = GL.coordsFromNotation(square)
				if ((x + y) % 2 === 0) continue
				;[x, y] = boardCoordsToDisplayCoords({ x, y }, boardFlipped(), squareSize())
				ctx.fillRect(x, y, squareSize(), squareSize())
			}
		}

		// fill in dark squares
		for (let i = 0; i < 8; i++) {
			for (let j = i % 2; j < 8; j += 2) {
				let visible =
					!shouldHideNonVisible ||
					game.currentBoardView.visibleSquares.has(
						GL.notationFromCoords({
							x: j,
							y: i,
						})
					)

				const [x, y] = boardCoordsToDisplayCoords({ x: j, y: i }, boardFlipped(), squareSize())

				ctx.fillStyle = visible ? BOARD_COLORS.dark : BOARD_COLORS.darkFog
				ctx.fillRect(x, y, squareSize(), squareSize())
			}
		}

		//#endregion

		//#region draw last move highlight
		const highlightColor = '#aff682'
		if (game.currentBoardView.lastMove && !shouldHideNonVisible) {
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
			const piece = game.currentBoardView.board.pieces[GL.notationFromCoords(move.to)]
			// we need to check if the piece is our color we visually move pieces in the current board view while we're placing a duck and promoting
			if (piece && piece.type !== 'duck' && piece.color !== game.bottomPlayer.color) {
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
			if (
				(grabbedMousePos() && activePieceSquare() === square) ||
				(shouldHideNonVisible ? !game.currentBoardView.visibleSquares.has(square) : false)
			) {
				continue
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
			activePieceSquare() &&
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

		if (activePieceSquare()) {
			const [x, y] = squareNotationToDisplayCoords(activePieceSquare()!, boardFlipped(), squareSize())
			ctx.beginPath()
			ctx.strokeStyle = clickedHighlightColor
			ctx.lineWidth = 6
			ctx.rect(x + 3, y + 3, squareSize() - 6, squareSize() - 6)
			ctx.stroke()
			ctx.closePath()
		}

		//#endregion

		//#region draw grabbed piece
		if (grabbedMousePos()) {
			let x = grabbedMousePos()!.x
			let y = grabbedMousePos()!.y
			ctx.drawImage(
				imageCache[PC.resolvePieceImagePath(game.currentBoardView.board.pieces[activePieceSquare()!]!)],
				x - squareSize() / 2,
				y - squareSize() / 2,
				squareSize(),
				squareSize()
			)
		}

		if (game.placingDuck() && currentMousePos()) {
			const { x, y } = currentMousePos()!
			ctx.drawImage(imageCache[PC.resolvePieceImagePath(GL.DUCK)], x - squareSize() / 2, y - squareSize() / 2, squareSize(), squareSize())
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
		let duckPath = PC.resolvePieceImagePath(GL.DUCK)
		imageCache[duckPath] = await PC.loadImage(duckPath)
		requestAnimationFrame(render)
	})

	createEffect(() => {
		if (game.bottomPlayer.color === 'black') {
			setBoardFlipped(true)
		} else {
			setBoardFlipped(false)
		}
	})

	// contextually set cursor style
	createEffect(() => {
		if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) {
			if (canvas.style.cursor !== 'default') canvas.style.cursor = 'default'
			return
		}
		if (grabbingPieceSquare()) {
			canvas.style.cursor = 'grabbing'
		} else if (
			hoveredSquare() &&
			game.currentBoardView.board.pieces[hoveredSquare()!] &&
			game.currentBoardView.board.pieces[hoveredSquare()!]!.color === game.bottomPlayer.color
		) {
			canvas.style.cursor = 'grab'
		} else {
			canvas.style.cursor = 'default'
		}
	})

	//#endregion

	//#region mouse events
	function isLegalForActive(square: string) {
		return legalMovesForActivePiece().some((m) => GL.notationFromCoords(m.to) === square)
	}

	function squareContainsPlayerPiece(square: string) {
		return game.currentBoardView.board.pieces[square]?.color === game.bottomPlayer.color
	}

	onMount(() => {
		function getSquareFromDisplayCoords(x: number, y: number) {
			let col = Math.floor(x / squareSize())
			let row = Math.floor(y / squareSize())
			if (boardFlipped()) {
				col = 7 - col
				row = 7 - row
			}

			return String.fromCharCode('a'.charCodeAt(0) + col) + (8 - row)
		}

		canvas.addEventListener('mousemove', (e) => {
			if (!game.isClientPlayerParticipating) return
			batch(() => {
				const rect = canvas.getBoundingClientRect()
				const x = e.clientX - rect.left
				const y = e.clientY - rect.top
				// check if mouse is over a square with a piece
				setHoveredSquare(getSquareFromDisplayCoords(x, y))
				if (grabbingPieceSquare() || grabbingPieceSquare()) {
					setGrabbedMousePos({ x, y })
				}
				setCurrentMousePos({ x, y })
			})
		})

		canvas.addEventListener('mousedown', (e) => {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			const rect = canvas.getBoundingClientRect()
			const [x, y] = [e.clientX - rect.left, e.clientY - rect.top]
			const mouseSquare = getSquareFromDisplayCoords(x, y)
			if (game.placingDuck()) {
				game.currentDuckPlacement = mouseSquare
				game.tryMakeMove()
				return
			}

			if (activePieceSquare()) {
				if (isLegalForActive(mouseSquare)) {
					batch(() => {
						game.tryMakeMove({ from: activePieceSquare()!, to: mouseSquare })
						setActivePieceSquare(null)
						setGrabbingPieceSquare(true)
					})
					return
				}

				if (squareContainsPlayerPiece(mouseSquare)) {
					setActivePieceSquare(mouseSquare)
					setGrabbingPieceSquare(true)
					return
				}

				setActivePieceSquare(null)
				return
			}

			if (squareContainsPlayerPiece(mouseSquare)) {
				batch(() => {
					// we're not setting grabbedSquareMousePos here becase we don't want to visually move the piece until the mouse moves
					setActivePieceSquare(mouseSquare)
					setGrabbingPieceSquare(true)
				})
				return
			} else {
				setActivePieceSquare(null)
			}
		})

		canvas.addEventListener('mouseup', (e) => {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			const rect = canvas.getBoundingClientRect()
			const square = getSquareFromDisplayCoords(e.clientX - rect.left, e.clientY - rect.top)
			const _activePiece = activePieceSquare()

			if (_activePiece && _activePiece !== square) {
				if (grabbingPieceSquare() && isLegalForActive(square)) {
					game.tryMakeMove({ from: _activePiece!, to: square })
					setActivePieceSquare(null)
				}
			}
			setGrabbingPieceSquare(false)
			setGrabbedMousePos(null)
		})
	})

	//#endregion

	//#endregion

	//#region promotion

	const promoteModalPosition = () => {
		if (!game.choosingPromotion) return undefined
		let [x, y] = squareNotationToDisplayCoords(game.currentMove!.to, boardFlipped(), squareSize())
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
							classList={{ 'bg-neutral-200': game.topPlayer.color !== 'white' }}
							variant={game.topPlayer.color === 'white' ? 'ghost' : 'default'}
							size="icon"
							onclick={() => {
								game.currentPromotion = pp
								game.tryMakeMove()
							}}
						>
							<img alt={pp} src={PC.resolvePieceImagePath({ color: game.topPlayer.color, type: pp })} />
						</Button>
					)}
				</For>
			</div>
		),
		position: promoteModalPosition,
		visible: () => game.choosingPromotion(),
		closeOnEscape: false,
		closeOnOutsideClick: false,
		setVisible: () => {},
	})
	//#endregion

	//#region draw offer events
	{
		const sub = game.drawEvent$.subscribe((event) => {
			if (event.participant.id === game.room.player.id) {
				switch (event.type) {
					case 'draw-offered':
						toast('Draw offered')
						break
					case 'draw-canceled':
						toast('Draw cancelled')
						break
					case 'draw-declined':
						toast('Draw declined')
						break
				}
				return
			}
			switch (event.type) {
				case 'draw-offered':
					toast(`${event.participant.name} offered a draw`)
					break
				case 'draw-canceled':
					toast(`${event.participant.name} cancelled their draw offer`)
					break
				case 'draw-declined':
					toast(`${event.participant.name} declined draw offer`)
					break
			}
		})
		onCleanup(() => {
			sub.unsubscribe()
		})
	}

	//#endregion

	//#region sound effects
	let initAudio = false
	createEffect(() => {
		if (!initAudio) {
			initAudio = true
			return
		}
		const move = game.currentBoardView.lastMove
		if (!move) return
		untrack(() => {
			if (game.currentBoardView.inCheck) {
				audio.check.play()
				return
			}
			if (move.promotion) {
				audio.promote.play()
				return
			}
			if (move.castle) {
				audio.castle.play()
				return
			}
			if (move.capture) {
				audio.capture.play()
				return
			}
			if (game.currentBoardView.board.toMove === game.bottomPlayer.color) {
				audio.movePlayer.play()
				return
			}
			audio.moveOpponent.play()
		})
	})
	const warnReaction = createReaction(() => {
		audio.lowTime.play()
	})

	const [pastWarnThreshold, setPastWarnThreshold] = createSignal(false)
	let initWarn = false
	createEffect(() => {
		if (!initWarn) {
			initWarn = true
			return
		}
		if (game.isClientPlayerParticipating && checkPastWarnThreshold(game.gameConfig.timeControl, game.clock[game.bottomPlayer.color])) {
			setPastWarnThreshold(true)
		}
	})
	warnReaction(pastWarnThreshold)
	//#endregion

	return (
		<div class={styles.boardPageWrapper}>
			<div class={styles.boardContainer}>
				<div class={styles.moveHistoryContainer}>
					<MoveHistory />
				</div>
				<Player class={styles.topPlayer} player={game.bottomPlayer} />
				<Clock
					class={styles.clockTopPlayer}
					clock={game.clock[game.bottomPlayer.color]}
					ticking={game.isPlayerTurn(game.topPlayer.color) && game.clock[game.bottomPlayer.color] > 0}
					timeControl={game.gameConfig.timeControl}
					color={game.bottomPlayer.color}
				/>
				<div class={`${styles.topLeftActions} flex flex-col items-start space-x-1`}>
					<Button variant="ghost" size="icon" onclick={() => setBoardFlipped((f) => !f)} class="mb-1">
						<FlipBoardSvg />
					</Button>
				</div>
				<CapturedPieces
					size={boardSize() / 2}
					layout={layout()}
					pieces={game.capturedPieces(game.bottomPlayer.color)}
					capturedBy={'top-player'}
				/>
				<CapturedPieces
					size={boardSize() / 2}
					layout={layout()}
					pieces={game.capturedPieces(game.topPlayer.color)}
					capturedBy={'bottom-player'}
				/>
				<div class={styles.board}>{canvas}</div>
				<Show when={game.isClientPlayerParticipating} fallback={<div class={styles.bottomLeftActions} />}>
					<ActionsPanel class={styles.bottomLeftActions} placingDuck={game.placingDuck()} />
				</Show>
				<Player class={styles.bottomPlayer} player={game.bottomPlayer} />
				<Clock
					class={styles.clockBottomPlayer}
					clock={game.clock[game.bottomPlayer.color]}
					ticking={game.isPlayerTurn(game.bottomPlayer.color) && game.clock[game.bottomPlayer.color] > 0}
					timeControl={game.gameConfig.timeControl}
					color={game.bottomPlayer.color}
				/>
				<div class={styles.moveNav}>
					<MoveNav />
				</div>
			</div>
			<GameOutcomeDialog />
		</div>
	)
}

function GameOutcomeDialog() {
	const game = G.game()!
	const [open, setOpen] = createSignal(false)
	const [showedOutcome, setShowedOutcome] = createSignal(false)
	createEffect(() => {
		if (game.outcome && !open() && !showedOutcome()) {
			setOpen(true)
			setShowedOutcome(true)
		}
	})
	return (
		<Dialog open={open()}>
			<DialogContent class="w-max">
				<DialogHeader>
					<span class="mt-1">{showGameOutcome(game.outcome!)[0]}</span>
				</DialogHeader>
				<DialogDescription>{showGameOutcome(game.outcome!)[1]}</DialogDescription>
				<div class="flex justify-center space-x-1">
					<Button onclick={() => game.room.configureNewGame()}>New Game</Button>
					<Button variant="secondary" onclick={() => setOpen(false)}>
						Continue
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

function Player(props: { player: G.PlayerWithColor; class: string }) {
	return (
		<div class={props.class + ' m-auto whitespace-nowrap'}>
			{props.player.name} <i class="text-neutral-400">({props.player.color})</i>
		</div>
	)
}

function Clock(props: { clock: number; class: string; ticking: boolean; timeControl: GL.TimeControl; color: GL.Color }) {
	const formattedClock = () => {
		// clock is in ms
		const minutes = Math.floor(props.clock / 1000 / 60)
		const seconds = Math.floor((props.clock / 1000) % 60)
		if (minutes === 0) {
			const tenths = Math.floor((props.clock / 100) % 10)
			const hundredths = Math.floor((props.clock / 10) % 10)
			return `${seconds}.${tenths}${hundredths}`.padStart(5, '0')
		}
		return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`.padStart(5, '0')
	}

	return (
		<div class={cn('flex items-center justify-end space-x-3 text-xl', props.class)}>
			<Show when={props.ticking}>
				<div class="hidden font-light md:block">{props.color} to move</div>
			</Show>
			<span
				class="mt-[0.4em] font-mono"
				classList={{
					'text-red-500': checkPastWarnThreshold(props.timeControl, props.clock),
					'animate-pulse': props.ticking && checkPastWarnThreshold(props.timeControl, props.clock),
					'text-neutral-400': !props.ticking,
				}}
			>{`${formattedClock()}`}</span>
		</div>
	)
}

function ActionsPanel(props: { class: string; placingDuck: boolean }) {
	const game = G.game()!
	return (
		<span class={props.class}>
			<Switch>
				<Match when={props.placingDuck}>
					<div class="flex space-x-2 rounded bg-destructive p-0.5 text-white">
						<span class="break-words text-xs">{`${usingTouch() ? 'Tap' : 'Click'} square to place duck`}</span>
						<Button
							variant="link"
							size="sm"
							onclick={() => {
								game.setPlacingDuck(false)
								game.currentDuckPlacement = null
								game.setBoardWithCurrentMove(null)
								game.currentMove = null
							}}
						>
							Cancel
						</Button>
					</div>
				</Match>
				<Match when={!game.outcome}>
					<Show when={game.drawIsOfferedBy === null}>
						<Button title="Offer Draw" size="icon" variant="ghost" onclick={() => game.offerOrAcceptDraw()}>
							<OfferDrawSvg />
						</Button>
						<Button title="Resign" size="icon" variant="ghost" onclick={() => game.resign()}>
							<ResignSvg />
						</Button>
					</Show>
					<Switch>
						<Match when={game.drawIsOfferedBy === game.bottomPlayer.color}>
							<Button size="sm" onClick={() => game.cancelDraw()}>
								Cancel Draw
							</Button>
						</Match>
						<Match when={game.drawIsOfferedBy === game.topPlayer.color}>
							<div class="flex space-x-1">
								{/* TODO when we're at a small viewport, we should probably render this somewhere else */}
								<Button size="sm" onClick={() => game.offerOrAcceptDraw()}>
									Accept Draw
								</Button>
								<Button size="sm" onClick={() => game.declineDraw()}>
									Decline Draw
								</Button>
							</div>
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
									[styles.singleMove]: index() + 1 === game.moveHistoryAsNotation.length && game.state.moveHistory.length % 2 === 1,
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

function CapturedPieces(props: {
	pieces: GL.ColoredPiece[]
	capturedBy: 'bottom-player' | 'top-player'
	size: number
	layout: 'column' | 'row'
}) {
	return (
		<div class={`${styles.capturedPieces} ${styles[props.capturedBy]}`}>
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
		game.setViewedMove(game.state.moveHistory.length - 1)
	} else if (move >= -1 && move < game.state.moveHistory.length) {
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
				disabled={game.viewedMoveIndex() === game.state.moveHistory.length - 1}
				variant="ghost"
				size="icon"
				onClick={() => _setViewedMove(game.viewedMoveIndex() + 1)}
			>
				<NextSvg />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				disabled={game.viewedMoveIndex() === game.state.moveHistory.length - 1}
				onClick={() => _setViewedMove('live')}
			>
				<LastSvg />
			</Button>
		</div>
	)
}

function showGameOutcome(outcome: GL.GameOutcome): [string, string] {
	const game = G.game()!
	const winner = outcome.winner ? game.getColorPlayer(outcome.winner) : null
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

const audio = {
	movePlayer: new Audio(moveSelfSound),
	moveOpponent: new Audio(moveOpponentSound),
	capture: new Audio(captureSound),
	check: new Audio(checkSound),
	promote: new Audio(promoteSound),
	castle: new Audio(castleSound),
	lowTime: new Audio(lowTimeSound),
}

//#region check if user is using touch screen
// we're doing it this way so we can differentiate users that are using their touch screen
const [usingTouch, setUsingTouch] = createSignal(false)

function touchListener() {
	setUsingTouch(true)
	document.removeEventListener('touchstart', touchListener)
}

document.addEventListener('touchstart', touchListener)

//#endregion
