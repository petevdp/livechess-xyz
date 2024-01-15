import { isEqual } from 'lodash'
import {
	For,
	Match,
	Show,
	Switch,
	batch,
	createEffect,
	createMemo,
	createReaction,
	createSignal,
	onCleanup,
	onMount,
	untrack,
} from 'solid-js'
import toast from 'solid-toast'

import FirstSvg from '~/assets/icons/first.svg'
import FlipBoardSvg from '~/assets/icons/flip-board.svg'
import LastSvg from '~/assets/icons/last.svg'
import NextSvg from '~/assets/icons/next.svg'
import OfferDrawSvg from '~/assets/icons/offer-draw.svg'
import PrevSvg from '~/assets/icons/prev.svg'
import ResignSvg from '~/assets/icons/resign.svg'
import { Dialog, DialogContent, DialogDescription, DialogHeader } from '~/components/ui/dialog.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '~/components/ui/hover-card.tsx'
import { BOARD_COLORS } from '~/config.ts'
import { cn } from '~/lib/utils.ts'
import * as Audio from '~/systems/audio.ts'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as Pieces from '~/systems/piece.tsx'
import * as P from '~/systems/player.ts'
import * as R from '~/systems/room.ts'

import styles from './Game.module.css'
import { Button } from './ui/button.tsx'
import * as Modal from './utils/Modal.tsx'


//TODO provide some method to view the current game's config
//TODO component duplicates on reload sometimes for some reason
// TODO fix horizontal scrolling on large viewport

export function Game(props: { gameId: string }) {
	let game = new G.Game(props.gameId, R.room()!, R.room()!.rollbackState.gameConfig)
	G.setGame(game)

	//#region calc board sizes
	// let BOARD_SIZE = 600
	// let SQUARE_SIZE = BOARD_SIZE / 8
	const [windowSize, setWindowSize] = createSignal({
		width: window.innerWidth,
		height: window.innerHeight,
	})
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

	const boardSizeCss = (): number => {
		if (windowSize().width < windowSize().height && windowSize().width > 700) {
			return windowSize().width - 80
		} else if (windowSize().width < windowSize().height && windowSize().width <= 700) {
			return windowSize().width - 30
		} else {
			return windowSize().height - 170
		}
	}

	const boardSize = () => {
		let adjusted = Math.floor(boardSizeCss() * window.devicePixelRatio)
		adjusted -= adjusted % 8
		return adjusted
	}

	createEffect(() => {
		Pieces.setSquareSize(boardSizeCss() / 8)
	})
	const squareSize = Pieces.squareSize

	//#endregion

	//#region board rendering and mouse events

	const canvasProps = () => {
		return {
			style: { width: `${boardSizeCss()}px`, height: `${boardSizeCss()}px` },
			width: boardSize(),
			height: boardSize(),
		}
	}

	function scaleAndReset(context: CanvasRenderingContext2D) {
		context.clearRect(0, 0, boardSizeCss(), boardSizeCss())
		context.setTransform(1, 0, 0, 1, 0, 0)
		context.scale(devicePixelRatio, devicePixelRatio)
	}

	const boardCanvas = (<canvas {...canvasProps()} />) as HTMLCanvasElement
	const highlightsCanvas = (<canvas {...canvasProps()} />) as HTMLCanvasElement
	const piecesCanvas = (<canvas {...canvasProps()} />) as HTMLCanvasElement
	const grabbedPieceCanvas = (<canvas {...canvasProps()} />) as HTMLCanvasElement

	//#region board and interaction state
	const [boardFlipped, setBoardFlipped] = createSignal(false)
	const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
	const [activePieceSquare, setActivePieceSquare] = createSignal(null as null | string)
	const [grabbingPieceSquare, setGrabbingPieceSquare] = createSignal(false)
	const [currentMousePos, setCurrentMousePos] = createSignal({ x: 0, y: 0 } as {
		x: number
		y: number
	} | null)
	const [grabbedMousePos, setGrabbedMousePos] = createSignal(null as null | { x: number; y: number })
	//#endregion

	const legalMovesForActivePiece = createMemo(() => {
		const _square = activePieceSquare()
		if (!_square) return []
		return game.getLegalMovesForSquare(_square)
	})

	//#region rendering

	//#region render board
	createEffect(async () => {
		if (!Pieces.initialized()) return
		// handle all reactivity here so we know renderBoard itself will run fast
		const args: RenderBoardArgs = {
			squareSize: squareSize(),
			boardFlipped: boardFlipped(),
			shouldHideNonVisible: game.gameConfig.variant === 'fog-of-war' && !game.outcome,
			visibleSquares: game.currentBoardView.visibleSquares,
			context: boardCanvas.getContext('2d')!,
		}
		Pieces.pieceChangedEpoch()
		scaleAndReset(args.context)

		untrack(() => {
			args.context.clearRect(0, 0, boardSize(), boardSize())
			renderBoard(args)
		})
	})

	//#endregion

	function getBoardView() {
		// consolidating signals for boardview
		return {
			board: game.currentBoardView.board,
			lastMove: game.currentBoardView.lastMove,
			visibleSquares: game.currentBoardView.visibleSquares,
			inCheck: game.currentBoardView.inCheck,
		}
	}

	//#region render highlights
	createEffect(() => {
		const args: RenderHighlightsArgs = {
			squareSize: squareSize(),
			boardFlipped: boardFlipped(),
			shouldHideNonVisible: game.gameConfig.variant === 'fog-of-war' && !game.outcome,
			boardView: getBoardView(),
			legalMovesForActivePiece: legalMovesForActivePiece(),
			playerColor: game.bottomPlayer.color,
			activePieceSquare: activePieceSquare(),
			hoveredSquare: hoveredSquare(),
			context: highlightsCanvas.getContext('2d')!,
		}
		scaleAndReset(args.context)
		Pieces.pieceChangedEpoch()

		untrack(() => {
			args.context.clearRect(0, 0, boardSize(), boardSize())
			renderHighlights(args)
		})
	})
	//#endregion

	//#region render pieces
	createEffect(() => {
		const args: RenderPiecesArgs = {
			squareSize: squareSize(),
			boardFlipped: boardFlipped(),
			shouldHideNonVisible: game.gameConfig.variant === 'fog-of-war' && !game.outcome,
			boardView: getBoardView(),
			grabbedMousePos: grabbedMousePos(),
			activePieceSquare: activePieceSquare(),
			context: piecesCanvas.getContext('2d')!,
		}
		Pieces.pieceChangedEpoch()
		scaleAndReset(args.context)
		untrack(() => {
			renderPieces(args)
		})
	})
	//#endregion

	//#region render grabbed piece
	createEffect(() => {
		const args: RenderGrabbedPieceArgs = {
			squareSize: squareSize(),
			boardView: getBoardView(),
			grabbedMousePos: grabbedMousePos(),
			activePieceSquare: activePieceSquare(),
			currentMousePos: usingTouch() ? null : currentMousePos(),
			context: grabbedPieceCanvas.getContext('2d')!,
			placingDuck: game.placingDuck(),
			touchScreen: usingTouch(),
		}
		Pieces.pieceChangedEpoch()

		scaleAndReset(args.context)
		untrack(() => {
			args.context.clearRect(0, 0, boardSize(), boardSize())
			renderGrabbedPiece(args)
		})
	})
	//#endregion

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
			if (grabbedPieceCanvas.style.cursor !== 'default') grabbedPieceCanvas.style.cursor = 'default'
			return
		}
		if (grabbingPieceSquare()) {
			grabbedPieceCanvas.style.cursor = 'grabbing'
		} else if (
			hoveredSquare() &&
			game.currentBoardView.board.pieces[hoveredSquare()!] &&
			game.currentBoardView.board.pieces[hoveredSquare()!]!.color === game.bottomPlayer.color
		) {
			grabbedPieceCanvas.style.cursor = 'grab'
		} else {
			grabbedPieceCanvas.style.cursor = 'default'
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

	function makeMove(move?: GL.SelectedMove) {
		batch(async () => {
			const resPromise = game.tryMakeMove(move)
			setActivePieceSquare(null)
			setGrabbingPieceSquare(false)
			setGrabbedMousePos(null)
			const res = await resPromise
			if (res.type !== 'invalid') {
				Audio.playSoundEffectForMove(res.move, true, true)
			}
		})
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

		const touchOffsetX = () => (P.settings.touchOffsetDirection === 'left' ? -20 : 20)
		const touchOffsetY = () => -Math.abs(touchOffsetX())
		grabbedPieceCanvas.addEventListener('mousemove', (e) => moveListener(e.clientX, e.clientY))
		grabbedPieceCanvas.addEventListener('touchmove', (e) => {
			for (let touch of e.targetTouches) {
				const touchingPiece = moveListener(touch.clientX + touchOffsetX(), touch.clientY + touchOffsetY())
				if (touchingPiece) {
					e.preventDefault()
				}
				break
			}
		})

		function moveListener(clientX: number, clientY: number) {
			let modified = false
			if (!game.isClientPlayerParticipating) return modified
			batch(() => {
				const rect = grabbedPieceCanvas.getBoundingClientRect()
				const x = clientX - rect.left
				const y = clientY - rect.top
				// check if mouse is over a square with a piece
				setHoveredSquare(getSquareFromDisplayCoords(x, y))
				if (grabbingPieceSquare() || grabbingPieceSquare()) {
					setGrabbedMousePos({ x, y })
					modified = true
				}
				setCurrentMousePos({ x, y })
			})
			return modified
		}

		grabbedPieceCanvas.addEventListener('mousedown', (e) => mouseDownListener(e.clientX, e.clientY))
		grabbedPieceCanvas.addEventListener('touchstart', (e) => {
			for (let touch of e.targetTouches) {
				mouseDownListener(touch.clientX, touch.clientY)
				break
			}
		})

		function mouseDownListener(clientX: number, clientY: number) {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			const rect = grabbedPieceCanvas.getBoundingClientRect()
			const [x, y] = [clientX - rect.left, clientY - rect.top]
			const mouseSquare = getSquareFromDisplayCoords(x, y)
			if (game.placingDuck()) {
				game.currentDuckPlacement = mouseSquare
				makeMove()
				return
			}

			if (activePieceSquare()) {
				if (isLegalForActive(mouseSquare)) {
					makeMove({ from: activePieceSquare()!, to: mouseSquare })
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
		}

		grabbedPieceCanvas.addEventListener('mouseup', (e) => mouseUpListener(e.clientX, e.clientY))
		grabbedPieceCanvas.addEventListener('touchend', (e) => {
			for (let touch of e.changedTouches) {
				mouseUpListener(touch.clientX + touchOffsetX(), touch.clientY + touchOffsetY())
				break
			}
		})

		function mouseUpListener(clientX: number, clientY: number) {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			const rect = grabbedPieceCanvas.getBoundingClientRect()
			const square = getSquareFromDisplayCoords(clientX - rect.left, clientY - rect.top)
			const _activePiece = activePieceSquare()

			if (_activePiece && _activePiece !== square) {
				if (grabbingPieceSquare() && isLegalForActive(square)) {
					makeMove({ from: _activePiece!, to: square })
					setActivePieceSquare(null)
				}
			}
			setGrabbingPieceSquare(false)
			setGrabbedMousePos(null)
		}
	})

	//#endregion

	//#endregion

	//#region promotion

	const promoteModalPosition = () => {
		if (!game.choosingPromotion) return undefined
		let [x, y] = squareNotationToDisplayCoords(game.currentMove!.to, boardFlipped(), squareSize())
		y += boardCanvas.getBoundingClientRect().top + window.scrollY
		x += boardCanvas.getBoundingClientRect().left + window.scrollX
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
							classList={{ 'bg-neutral-200': game.bottomPlayer.color !== 'white' }}
							variant={game.bottomPlayer.color === 'white' ? 'ghost' : 'default'}
							size="icon"
							onclick={() => {
								game.currentPromotion = pp
								makeMove()
							}}
						>
							<img alt={pp} src={Pieces.getPieceSrc({ type: pp, color: game.bottomPlayer.color })} />
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

	//#region warn with sound effect on low time
	let initAudio = false
	// this code is horrific, please fix it
	createEffect(() => {
		if (!initAudio) {
			initAudio = true
			return
		}
		const move = game.currentBoardView.lastMove
		if (!move) return
	})
	const warnReaction = createReaction(() => {
		Audio.playSound('lowTime')
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

	//#region sound effects for incoming moves
	createEffect(() => {
		if (game.viewingLiveBoard && game.isClientPlayerParticipating && game.board.toMove !== game.bottomPlayer.color) return
		if (game.currentBoardView.lastMove) {
			const isVisible =
				game.gameConfig.variant !== 'fog-of-war' || game.currentBoardView.visibleSquares.has(game.currentBoardView.lastMove.to)
			Audio.playSoundEffectForMove(game.currentBoardView.lastMove, false, isVisible)
		}
	})
	//#endregion

	//#region game outcome sound effects
	{
		let init = false
		createEffect(() => {
			if (!game.outcome || !game.isClientPlayerParticipating) {
				if (!init) {
					init = true
				}
				return
			}

			if (game.outcome.winner === game.bottomPlayer.color) {
				if (!init) {
					init = true
					return
				}
				Audio.playSound('winner')
			} else {
				if (!init) {
					init = true
					return
				}
				Audio.playSound('loser')
			}
		})
	}
	//#endregion

	return (
		<div class={styles.boardPageWrapper}>
			<div class={styles.boardContainer}>
				<div class={styles.moveHistoryContainer}>
					<MoveHistory />
				</div>
				<Player class={styles.topPlayer} player={game.topPlayer}/>
				<Clock
					class={styles.clockTopPlayer}
					clock={game.clock[game.topPlayer.color]}
					ticking={game.isPlayerTurn(game.topPlayer.color) && game.clock[game.topPlayer.color] > 0}
					timeControl={game.gameConfig.timeControl}
					color={game.topPlayer.color}
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
				<div class={styles.board}>
					<span>{boardCanvas}</span>
					<span class="absolute -translate-y-full">{highlightsCanvas}</span>
					<span class="absolute -translate-y-full">{piecesCanvas}</span>
					<span class="absolute -translate-y-full">{grabbedPieceCanvas}</span>
				</div>
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
	const game = G.game()!
	const title = (
		<>
			{props.player.name} <i class="text-neutral-400">({props.player.color})</i>
		</>
	)
	return (
		<div class={props.class + ' m-auto whitespace-nowrap'}>
			<Show when={game.bottomPlayer.color === props.player.color} fallback={title}>
				<HoverCard placement="bottom" open={game.placingDuck()}>
					<HoverCardTrigger>{title}</HoverCardTrigger>
					<HoverCardContent class="bg-destructive p-1 text-sm flex items-center justify-between">
						<span class="text-balance">{`${usingTouch() ? 'Tap' : 'Click'} to place duck`}</span>
						<Button
							class="text-xs whitespace-nowrap bg-black"
							variant="secondary"
							size="sm"
							onclick={() => {
								game.setPlacingDuck(false)
								game.currentDuckPlacement = null
								game.setBoardWithCurrentMove(null)
								game.currentMove = null
							}}
						>
							Change Move
						</Button>
					</HoverCardContent>
				</HoverCard>
			</Show>
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
					<img class={styles.capturedPiece} src={Pieces.getPieceSrc(piece)} alt={piece.type}
							 title={`${piece.color} ${piece.type}`}/>
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

type RenderBoardArgs = {
	context: CanvasRenderingContext2D
	shouldHideNonVisible: boolean
	squareSize: number
	boardFlipped: boolean
	visibleSquares: Set<string>
}

function renderBoard(args: RenderBoardArgs) {
	const ctx = args.context
	// fill in light squares as background
	ctx.fillStyle = args.shouldHideNonVisible ? BOARD_COLORS.lightFog : BOARD_COLORS.light
	ctx.fillRect(0, 0, args.squareSize * 8, args.squareSize * 8)

	if (args.shouldHideNonVisible) {
		ctx.fillStyle = BOARD_COLORS.light
		for (let square of args.visibleSquares) {
			let { x, y } = GL.coordsFromNotation(square)
			if ((x + y) % 2 === 0) continue
			;[x, y] = boardCoordsToDisplayCoords({ x, y }, args.boardFlipped, args.squareSize)
			ctx.fillRect(x, y, args.squareSize, args.squareSize)
		}
	}

	// fill in dark squares
	for (let i = 0; i < 8; i++) {
		for (let j = i % 2; j < 8; j += 2) {
			let visible =
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

type RenderPiecesArgs = {
	context: CanvasRenderingContext2D
	shouldHideNonVisible: boolean
	squareSize: number
	boardFlipped: boolean
	boardView: G.BoardView
	grabbedMousePos: { x: number; y: number } | null
	activePieceSquare: string | null
}

function renderPieces(args: RenderPiecesArgs) {
	const ctx = args.context
	for (let [square, piece] of Object.entries(args.boardView.board.pieces)) {
		if (
			(args.grabbedMousePos && args.activePieceSquare === square) ||
			(args.shouldHideNonVisible ? !args.boardView.visibleSquares.has(square) : false)
		) {
			continue
		}

		let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
		let y = 8 - parseInt(square[1])
		if (args.boardFlipped) {
			x = 7 - x
			y = 7 - y
		}
		ctx.drawImage(Pieces.getCachedPiece(piece), x * args.squareSize, y * args.squareSize, args.squareSize, args.squareSize)
	}
}

type RenderHighlightsArgs = {
	context: CanvasRenderingContext2D
	boardView: G.BoardView
	shouldHideNonVisible: boolean
	squareSize: number
	boardFlipped: boolean
	legalMovesForActivePiece: GL.CandidateMove[]
	playerColor: GL.Color
	hoveredSquare: string | null
	activePieceSquare: string | null
}

function renderHighlights(args: RenderHighlightsArgs) {
	const ctx = args.context
	//#region draw last move highlight
	const highlightColor = '#aff682'
	if (args.boardView.lastMove && !args.shouldHideNonVisible) {
		const highlightedSquares = [args.boardView.lastMove.from, args.boardView.lastMove.to]
		for (let square of highlightedSquares) {
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
	for (let move of args.legalMovesForActivePiece) {
		// draw dot in center of move end
		const [x, y] = boardCoordsToDisplayCoords(move.to, args.boardFlipped, args.squareSize)
		const piece = args.boardView.board.pieces[GL.notationFromCoords(move.to)]
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
		args.activePieceSquare &&
		args.legalMovesForActivePiece.some((m) => isEqual(m.to, GL.coordsFromNotation(args.hoveredSquare!)))
	) {
		// draw empty square in hovered square
		renderHighlightRect(moveHighlightColor, args.hoveredSquare!)
	}
	//#endregion

	//#region draw clicked move highlight
	const clickedHighlightColor = '#809dfd'

	if (args.activePieceSquare) {
		renderHighlightRect(clickedHighlightColor, args.activePieceSquare)
	}

	//#endregion
}

type RenderGrabbedPieceArgs = {
	context: CanvasRenderingContext2D
	grabbedMousePos: { x: number; y: number } | null
	boardView: G.BoardView
	squareSize: number
	activePieceSquare: string | null
	placingDuck: boolean
	currentMousePos: { x: number; y: number } | null
	touchScreen: boolean
}

function renderGrabbedPiece(args: RenderGrabbedPieceArgs) {
	const ctx = args.context

	const size = args.touchScreen ? args.squareSize * 1.5 : args.squareSize
	if (args.grabbedMousePos) {
		let x = args.grabbedMousePos!.x
		let y = args.grabbedMousePos!.y
		ctx.drawImage(Pieces.getCachedPiece(args.boardView.board.pieces[args.activePieceSquare!]!), x - size / 2, y - size / 2, size, size)
	}

	if (args.placingDuck && args.currentMousePos) {
		const { x, y } = args.currentMousePos!
		const size = args.touchScreen ? args.squareSize * 1.5 : args.squareSize
		ctx.drawImage(Pieces.getCachedPiece(GL.DUCK), x - size / 2, y - size / 2, size, size)
	}
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

//#region check if user is using touch screen
// we're doing it this way so we can differentiate users that are using their touch screen
const [usingTouch, setUsingTouch] = createSignal(false)

function touchListener() {
	setUsingTouch(true)
	document.removeEventListener('touchstart', touchListener)
}

document.addEventListener('touchstart', touchListener)

//#endregion

// adapted from: https://www.npmjs.com/package/intrinsic-scale
function getObjectFitSize(
	contains: boolean /* true = contain, false = cover */,
	containerWidth: number,
	containerHeight: number,
	width: number,
	height: number
) {
	let doRatio = width / height
	let cRatio = containerWidth / containerHeight
	let targetWidth = 0
	let targetHeight = 0
	let test = contains ? doRatio > cRatio : doRatio < cRatio

	if (test) {
		targetWidth = containerWidth
		targetHeight = targetWidth / doRatio
	} else {
		targetHeight = containerHeight
		targetWidth = targetHeight * doRatio
	}

	return {
		width: targetWidth,
		height: targetHeight,
		x: (containerWidth - targetWidth) / 2,
		y: (containerHeight - targetHeight) / 2,
	}
}
