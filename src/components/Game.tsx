import { useColorMode } from '@kobalte/core'
import { createMediaQuery } from '@solid-primitives/media'
import { isEqual } from 'lodash-es'
import { filter, first, from as rxFrom, skip } from 'rxjs'
import {
	For,
	Match,
	ParentProps,
	Show,
	Switch,
	batch,
	createEffect,
	createMemo,
	createSignal,
	observable,
	onCleanup,
	onMount,
	untrack,
} from 'solid-js'
import toast from 'solid-toast'

import * as Svgs from '~/components/Svgs.tsx'
import { VariantInfoDialog } from '~/components/VariantInfoDialog.tsx'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '~/components/ui/dialog.tsx'
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

//TODO component duplicates on reload sometimes for some reason

export default function Game(props: { gameId: string }) {
	const game = new G.Game(props.gameId, R.room()!, R.room()!.rollbackState.gameConfig)
	G.setGame(game)

	//#region calc board sizes
	// let BOARD_SIZE = 600
	// let SQUARE_SIZE = BOARD_SIZE / 8

	// eslint-disable-next-line prefer-const
	let boardRef = null as unknown as HTMLDivElement

	const [windowSize, setWindowSize] = createSignal({
		width: window.innerWidth,
		height: window.innerHeight,
	})

	window.addEventListener('resize', () => {
		setWindowSize({ width: window.innerWidth, height: window.innerHeight })
	})

	let isPortrait: () => boolean
	let isSmallPortrait: () => boolean
	{
		const _isPortrait = createMediaQuery('(max-aspect-ratio: 7/6)')
		const _isSmallPortrait = createMediaQuery('(max-width: 700px)')
		isPortrait = createMemo(() => _isPortrait())
		isSmallPortrait = createMemo(() => _isSmallPortrait())
	}

	const boardSizeCss = (): number => {
		if (isSmallPortrait()) {
			return Math.min(windowSize().width - 30, windowSize().height - 160)
		} else if (isPortrait()) {
			return Math.min(windowSize().width - 80, windowSize().height - 160)
		} else {
			return windowSize().height - 170
		}
	}

	const boardSize = () => {
		return Math.floor(boardSizeCss() * window.devicePixelRatio)
	}

	createEffect(() => {
		Pieces.setSquareSize(boardSizeCss() / 8)
	})
	const squareSize = Pieces.squareSize

	//#endregion

	//#region board rendering and mouse events

	const canvasProps = () => {
		return {
			class: 'object-contain',
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
	const [currentMousePos, setCurrentMousePos] = createSignal({ x: 0, y: 0 } as { x: number; y: number } | null)
	const [grabbedMousePos, setGrabbedMousePos] = createSignal(null as null | { x: number; y: number })
	//#endregion

	const legalMovesForActivePiece = createMemo(() => {
		const _square = activePieceSquare()
		if (!_square) return []
		return game.getLegalMovesForSquare(_square)
	})

	//#region canvas rendering

	//#region board rendering updates
	createEffect(async () => {
		if (!Pieces.initialized()) return
		// handle all reactivity here, so we know renderBoard itself will run fast
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
		// consolidating signals for board view
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
			currentMousePos: P.settings.usingTouch ? null : currentMousePos(),
			context: grabbedPieceCanvas.getContext('2d')!,
			placingDuck: game.placingDuck(),
			touchScreen: P.settings.usingTouch,
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
		batch(() => {
			const resPromise = game.tryMakeMove(move)
			setActivePieceSquare(null)
			setGrabbingPieceSquare(false)
			setGrabbedMousePos(null)
			resPromise.then((res) => {
				if (res.type === 'accepted') {
					untrack(() => {
						Audio.playSoundEffectForMove(res.move, true, true)
					})
				}
			})
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

		const touchOffsetX = () => {
			switch (P.settings.touchOffsetDirection) {
				case 'left':
					return -20
				case 'right':
					return 20
				case 'none':
					return 0
			}
		}
		const touchOffsetY = () => (P.settings.touchOffsetDirection !== 'none' ? -Math.abs(touchOffsetX()) : 0)
		grabbedPieceCanvas.addEventListener('mousemove', (e) => moveListener(e.clientX, e.clientY))
		grabbedPieceCanvas.addEventListener('touchmove', (e) => {
			if (e.targetTouches.length === 0) return
			const touch = e.targetTouches[0]
			const touchingPiece = moveListener(touch.clientX + touchOffsetX(), touch.clientY + touchOffsetY())
			if (touchingPiece) {
				e.preventDefault()
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

		grabbedPieceCanvas.addEventListener('mousedown', (e) => {
			e.button === 0 && handlePrimaryPress(e.clientX, e.clientY)
		})

		grabbedPieceCanvas.addEventListener('contextmenu', (e) => {
			e.preventDefault()
			handleSecondaryPress()
		})

		grabbedPieceCanvas.addEventListener('touchstart', (e) => {
			if (e.targetTouches.length === 0) return
			const touch = e.targetTouches[0]
			handlePrimaryPress(touch.clientX, touch.clientY)
		})

		function handlePrimaryPress(clientX: number, clientY: number) {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			const rect = grabbedPieceCanvas.getBoundingClientRect()
			const [x, y] = [clientX - rect.left, clientY - rect.top]
			const mouseSquare = getSquareFromDisplayCoords(x, y)
			batch(() => {
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
						// we're not setting grabbedSquareMousePos here because we don't want to visually move the piece until the mouse moves
						setActivePieceSquare(mouseSquare)
						setGrabbingPieceSquare(true)
					})
					return
				} else {
					setActivePieceSquare(null)
				}
			})
		}

		function handleSecondaryPress() {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			// TODO draw arrows
			if (grabbingPieceSquare()) {
				batch(() => {
					setGrabbingPieceSquare(false)
					setGrabbedMousePos(null)
				})
			} else {
				batch(() => {
					setActivePieceSquare(null)
				})
			}
		}

		grabbedPieceCanvas.addEventListener('mouseup', (e) => {
			if (e.button === 0) handlePrimaryRelease(e.clientX, e.clientY)
		})
		grabbedPieceCanvas.addEventListener('touchend', (e) => {
			if (e.changedTouches.length === 0) return
			const touch = e.changedTouches[0]
			handlePrimaryRelease(touch.clientX + touchOffsetX(), touch.clientY + touchOffsetY())
		})

		function handlePrimaryRelease(clientX: number, clientY: number) {
			if (!game.isClientPlayerParticipating || !game.viewingLiveBoard) return
			const rect = grabbedPieceCanvas.getBoundingClientRect()
			const square = getSquareFromDisplayCoords(clientX - rect.left, clientY - rect.top)
			const _activePiece = activePieceSquare()

			batch(() => {
				if (_activePiece && _activePiece !== square) {
					if (grabbingPieceSquare() && isLegalForActive(square)) {
						makeMove({ from: _activePiece!, to: square })
						setActivePieceSquare(null)
					}
				}
				setGrabbingPieceSquare(false)
				setGrabbedMousePos(null)
			})
		}
	})

	//#endregion

	//#endregion

	//#region promotion

	const promoteModalPosition = () => {
		if (!game.currentMoveAmbiguity) return undefined
		let [x, y] = squareNotationToDisplayCoords(game.currentMove()!.to, boardFlipped(), squareSize())
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
			<Switch>
				<Match when={game.currentMoveAmbiguity?.type === 'promotion'}>
					<div class="flex w-[180px] flex-row justify-between space-x-1">
						<For each={GL.PROMOTION_PIECES}>
							{(pp) => {
								const Piece = Pieces.getPieceSvg({ type: pp, color: game.bottomPlayer.color })
								return (
									<Button
										classList={{ 'bg-neutral-200': game.bottomPlayer.color !== 'white' }}
										variant={game.bottomPlayer.color === 'white' ? 'ghost' : 'default'}
										size="icon"
										onclick={() => {
											if (game.currentMoveAmbiguity?.type !== 'promotion') return
											game.setCurrentDisambiguation({
												type: 'promotion',
												piece: pp as GL.PromotionPiece,
											})
											makeMove()
										}}
									>
										<Piece />
									</Button>
								)
							}}
						</For>
					</div>
				</Match>
				<Match when={game.currentMoveAmbiguity?.type === 'castle'}>
					<div class="flex flex-col items-center">
						<h3>Castle?</h3>
						<div class="flex space-between space-x-1">
							<Button
								onclick={() => {
									if (game.currentMoveAmbiguity?.type !== 'castle') return
									game.setCurrentDisambiguation({ type: 'castle', castling: true })
									void game.tryMakeMove()
								}}
							>
								Yes
							</Button>
							<Button
								onclick={() => {
									if (game.currentMoveAmbiguity?.type !== 'castle') return
									game.setCurrentDisambiguation({ type: 'castle', castling: false })
									void game.tryMakeMove()
								}}
							>
								No
							</Button>
						</div>
					</div>
				</Match>
			</Switch>
		),
		position: promoteModalPosition,
		visible: () => !!game.currentMoveAmbiguity,
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
					Audio.playSound('drawOffered')
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
	{
		const sub = rxFrom(
			observable(
				() =>
					[
						checkPastWarnThreshold(game.gameConfig.timeControl, game.clock[game.bottomPlayer.color]),
						game.isClientPlayerParticipating,
					] as const
			)
		)
			.pipe(
				skip(1),
				filter(([pastWarnThreshold, isPlayerParticipating]) => !!pastWarnThreshold && isPlayerParticipating),
				first()
			)
			.subscribe(() => {
				Audio.playSound('lowTime')
			})

		onCleanup(() => {
			sub.unsubscribe()
		})
	}

	//#endregion

	//#region sound effects for incoming moves
	{
		const sub = game.moveEvent$.subscribe(async (event) => {
			if (game.viewingLiveBoard && game.isClientPlayerParticipating) return
			const moveIsFromOpponent = event.moveIndex % 2 === (game.bottomPlayer.color === 'white' ? 1 : 0)
			if (moveIsFromOpponent) {
				const move = game.state.moveHistory[event.moveIndex]
				const isVisible = game.gameConfig.variant !== 'fog-of-war' || game.currentBoardView.visibleSquares.has(move.to)
				Audio.playSoundEffectForMove(move, false, isVisible)
			}
		})

		onCleanup(() => {
			sub.unsubscribe()
		})
	}
	//#endregion

	//#region game outcome sound effects
	{
		const sub = game.outcome$.subscribe((event) => {
			if (!event) return
			if (event.winner === game.bottomPlayer.color) {
				Audio.playSound('winner')
			} else {
				Audio.playSound('loser')
			}
		})
		onCleanup(() => {
			sub.unsubscribe()
		})
	}
	//#endregion

	//#region handle move navigation
	function handleMoveNavigation(moveIndex: number | 'live') {
		if (game.gameConfig.variant === 'fog-of-war') throw new Error('move history navigation not supported for fog of war games')
		const move = game.state.moveHistory[moveIndex === 'live' ? game.state.moveHistory.length - 1 : moveIndex]
		move && Audio.playSoundEffectForMove(move, false, true)
		game.setViewedMove(moveIndex)
	}

	const moveNavProps = () => {
		return {
			isLive: game.viewingLiveBoard,
			viewedMoveIndex: game.viewedMoveIndex(),
			setViewedMoveIndex: handleMoveNavigation,
		}
	}

	//#endregion
	const hideHistory = () => game.gameConfig.variant === 'fog-of-war'

	return (
		<div class={styles.boardPageWrapper}>
			<div
				ref={boardRef}
				class={cn(
					styles.boardContainer,
					'rounded-lg border bg-card p-2 text-card-foreground shadow-sm max-w-max max-h-full gap-[0.25rem]',
					hideHistory() ? styles.hideHistory : styles.showHistory
				)}
			>
				<Show when={!hideHistory()}>
					<MoveHistory {...moveNavProps()} />
				</Show>
				<div class={`${styles.topLeftActions} flex items-start space-x-1`}>
					<Button variant="ghost" size="icon" onclick={() => setBoardFlipped((f) => !f)} class="mb-1">
						<Svgs.Flip />
					</Button>
					<Show when={game.gameConfig.variant !== 'regular'}>
						<VariantInfoDialog variant={game.gameConfig.variant}>
							<Button variant="ghost" size="icon" class="mb-1">
								<Svgs.Help />
							</Button>
						</VariantInfoDialog>
					</Show>
				</div>
				<Player class={styles.topPlayer} player={game.topPlayer} />
				<Clock
					class={styles.clockTopPlayer}
					clock={game.clock[game.topPlayer.color]}
					ticking={game.isPlayerTurn(game.topPlayer.color) && game.clock[game.topPlayer.color] > 0}
					timeControl={game.gameConfig.timeControl}
					color={game.topPlayer.color}
				/>
				<CapturedPieces />
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
				<Show when={!hideHistory()}>
					<div class={cn(styles.moveNav, 'self-center justify-self-center min-w-0 wc:self-start')}>
						<MoveNav {...moveNavProps()} />
					</div>
				</Show>
			</div>
			<GameOutcomeDialog />
		</div>
	)
}

//#region subcomponents
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
	const { colorMode } = useColorMode()
	const isPlayerTurn = () => game.isPlayerTurn(props.player.color)
	const font = () => {
		if (isPlayerTurn() && colorMode() === 'light') {
			return 'text-neutral-900'
		}
		if (isPlayerTurn() && colorMode() === 'dark') {
			return 'text-neutral-100'
		}
		if (!isPlayerTurn() && colorMode() === 'light') {
			return 'text-neutral-500'
		}
		if (!isPlayerTurn() && colorMode() === 'dark') {
			return 'text-neutral-400'
		}
	}
	const title = (
		<>
			<span class={font()}>{props.player.name}</span>
			<i class={`${font()} font-light`}>({props.player.color})</i>
		</>
	)
	return (
		<div class={props.class + ' m-auto whitespace-nowrap'}>
			<Show when={game.bottomPlayer.color === props.player.color} fallback={title}>
				<HoverCard placement="bottom" open={game.placingDuck()}>
					<HoverCardTrigger>{title}</HoverCardTrigger>
					<HoverCardContent class="bg-destructive border-destructive p-1 w-max text-sm flex space-x-2 items-center justify-between">
						<span class="text-balance text-destructive-foreground">{`${P.settings.usingTouch ? 'Tap' : 'Click'} square to place duck`}</span>
						<Button
							class="text-xs text-destructive-foreground whitespace-nowrap bg-black"
							variant="secondary"
							size="sm"
							onclick={() => {
								game.setPlacingDuck(false)
								game.currentDuckPlacement = null
								game.setBoardWithCurrentMove(null)
								game.setCurrentMove(null)
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
		<Show when={props.timeControl !== 'unlimited'} fallback={<span class={props.class} />}>
			<div class={cn('flex items-center justify-end space-x-3 text-xl', props.class)}>
				<span
					class="mt-[0.4em] font-mono"
					classList={{
						'text-red-500': checkPastWarnThreshold(props.timeControl, props.clock),
						'animate-pulse': props.ticking && checkPastWarnThreshold(props.timeControl, props.clock),
						'text-neutral-400': !props.ticking,
					}}
				>{`${formattedClock()}`}</span>
			</div>
		</Show>
	)
}

function ActionsPanel(props: { class: string; placingDuck: boolean }) {
	const game = G.game()!
	return (
		<span class={props.class}>
			<Switch>
				<Match when={!game.outcome}>
					<DrawHoverCard>
						<span>
							<Button
								disabled={!!game.drawIsOfferedBy}
								title="Offer Draw"
								size="icon"
								variant="ghost"
								onclick={() => game.offerOrAcceptDraw()}
							>
								<Svgs.OfferDraw />
							</Button>
							<ResignButton />
						</span>
					</DrawHoverCard>
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

function ResignButton() {
	const game = G.game()!
	const [open, setOpen] = createSignal(false)

	return (
		<Dialog open={open()} onOpenChange={setOpen}>
			<DialogTrigger>
				<Button disabled={!!game.drawIsOfferedBy} title="Resign" size="icon" variant="ghost">
					<Svgs.Resign />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogTitle>Confirm Resignation</DialogTitle>
				<DialogDescription>Are you sure you want to resign?</DialogDescription>
				<DialogFooter>
					<Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
					<Button onClick={() => game.resign()}>Resign</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function DrawHoverCard(props: ParentProps) {
	const game = G.game()!
	return (
		<HoverCard placement="bottom" open={!!game.drawIsOfferedBy}>
			<HoverCardTrigger>{props.children}</HoverCardTrigger>
			<HoverCardContent class="w-max p-[0.25rem]">
				<Show when={game.drawIsOfferedBy === game.bottomPlayer.color}>
					<Button size="sm" onClick={() => game.cancelDraw()}>
						Cancel Draw
					</Button>
				</Show>
				<Show when={game.drawIsOfferedBy === game.topPlayer.color}>
					<div class="flex space-x-1">
						<Button size="sm" onClick={() => game.offerOrAcceptDraw()}>
							Accept Draw
						</Button>
						<Button size="sm" onClick={() => game.declineDraw()}>
							Decline Draw
						</Button>
					</div>
				</Show>
			</HoverCardContent>
		</HoverCard>
	)
}

function MoveHistory(props: MoveNavProps) {
	const itemClass = 'grid grid-cols-[min-content_1fr_1fr] gap-1 text-xs items-center'
	const game = G.game()!
	return (
		<div class={`${styles.moveHistoryContainer} grid grid-cols-2 h-max max-h-full gap-x-4 gap-y-1 p-1 overflow-y-auto`}>
			<div class={itemClass}>
				<span class="font-mono font-bold">00.</span>
				<Button
					class="p-[.25rem] font-light"
					size="sm"
					variant={props.viewedMoveIndex === -1 ? 'default' : 'ghost'}
					onClick={() => props.setViewedMoveIndex(-1)}
				>
					Start
				</Button>
			</div>
			<For each={game.moveHistoryAsNotation}>
				{(move, index) => {
					const viewingFirstMove = () => props.viewedMoveIndex === index() * 2
					const viewingSecondMove = () => props.viewedMoveIndex === index() * 2 + 1
					return (
						<div class={itemClass}>
							<span class="font-mono font-bold">{(index() + 1).toString().padStart(2, '0')}.</span>
							<Button
								class="p-[.25rem] font-light"
								size="sm"
								variant={viewingFirstMove() ? 'default' : 'ghost'}
								onClick={() => props.setViewedMoveIndex(index() * 2)}
							>
								{move[0]}
							</Button>{' '}
							<Show when={move[1]}>
								<Button
									size="sm"
									class="p-[.25rem] font-light"
									variant={viewingSecondMove() ? 'default' : 'ghost'}
									onClick={() => props.setViewedMoveIndex(index() * 2 + 1)}
								>
									{move[1]}
								</Button>
							</Show>
						</div>
					)
				}}
			</For>
		</div>
	)
}

type MoveNavProps = {
	isLive: boolean
	viewedMoveIndex: number
	setViewedMoveIndex: (moveIndex: number | 'live') => void
}

function MoveNav(props: MoveNavProps) {
	return (
		<div class="flex justify-evenly">
			<Button size="icon" variant="ghost" disabled={props.viewedMoveIndex === -1} onClick={() => props.setViewedMoveIndex(-1)}>
				<Svgs.First />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				disabled={props.viewedMoveIndex === -1}
				onClick={() => props.setViewedMoveIndex(props.viewedMoveIndex - 1)}
			>
				<Svgs.Prev />
			</Button>
			<Button disabled={props.isLive} variant="ghost" size="icon" onClick={() => props.setViewedMoveIndex(props.viewedMoveIndex + 1)}>
				<Svgs.Next />
			</Button>
			<Button variant="ghost" size="icon" disabled={props.isLive} onClick={() => props.setViewedMoveIndex('live')}>
				<Svgs.Last />
			</Button>
		</div>
	)
}

//#region captured pieces
export function CapturedPieces() {
	const game = G.game()!
	return (
		<div class={cn(styles.capturedPiecesContainer, 'flex flex-col wc:flex-row justify-between space-y-1 wc:space-y-0 wc:space-x-1')}>
			<CapturedPiecesForColor pieces={game.capturedPieces(game.bottomPlayer.color)} capturedBy={'top-player'} />
			<CapturedPiecesForColor pieces={game.capturedPieces(game.topPlayer.color)} capturedBy={'bottom-player'} />
		</div>
	)
}

function CapturedPiecesForColor(props: { pieces: GL.ColoredPiece[]; capturedBy: 'bottom-player' | 'top-player' }) {
	const hierarchy = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']
	const capturedByStyles = () => (props.capturedBy === 'bottom-player' ? 'flex-col-reverse wc:flex-row-reverse' : 'flex-col wc:flex-row')

	const sortedPieces = () =>
		[...props.pieces].sort((a, b) => {
			const aIndex = hierarchy.indexOf(a.type)
			const bIndex = hierarchy.indexOf(b.type)
			if (aIndex === -1 || bIndex === -1) return 0
			return bIndex - aIndex
		})

	return (
		<div class={cn(`rounded flex flex-grow min-w-[30px] min-h-[30px] flex-wrap bg-gray-400`, capturedByStyles())}>
			<For each={sortedPieces()}>
				{(piece) => {
					const Piece = Pieces.getPieceSvg(piece)
					return <Piece class="max-w-[30px] max-h-[30px]" />
				}}
			</For>
		</div>
	)
}

//#endregion

//#endregion

//#region canvas rendering

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

type RenderPiecesArgs = {
	context: CanvasRenderingContext2D
	shouldHideNonVisible: boolean
	squareSize: number
	boardFlipped: boolean
	boardView: G.BoardView
	grabbedMousePos: {
		x: number
		y: number
	} | null
	activePieceSquare: string | null
}

function renderPieces(args: RenderPiecesArgs) {
	const ctx = args.context
	for (const [square, piece] of Object.entries(args.boardView.board.pieces)) {
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
	for (const move of args.legalMovesForActivePiece) {
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

function renderGrabbedPiece(args: RenderGrabbedPieceArgs) {
	const ctx = args.context

	const size = args.touchScreen ? args.squareSize * 1.5 : args.squareSize
	if (args.grabbedMousePos) {
		const x = args.grabbedMousePos!.x
		const y = args.grabbedMousePos!.y
		ctx.drawImage(Pieces.getCachedPiece(args.boardView.board.pieces[args.activePieceSquare!]!), x - size / 2, y - size / 2, size, size)
	}

	if (args.placingDuck && args.currentMousePos) {
		const { x, y } = args.currentMousePos!
		const size = args.touchScreen ? args.squareSize * 1.5 : args.squareSize
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

//#endregion helpers

//#region check if user is using touch screen

//#endregion
