import { useColorMode } from '@kobalte/core'
import { createMediaQuery } from '@solid-primitives/media'
import { until } from '@solid-primitives/promise'
import { makeResizeObserver } from '@solid-primitives/resize-observer'
import { ReactiveSet } from '@solid-primitives/set'
import { Subscription, filter, first, from as rxFrom, skip } from 'rxjs'
import {
	For,
	JSX,
	Match,
	ParentProps,
	Show,
	Switch,
	createContext,
	createEffect,
	createMemo,
	createRenderEffect,
	createSignal,
	observable,
	on,
	onCleanup,
	onMount,
	useContext,
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
import { cn } from '~/lib/utils.ts'
import * as Audio from '~/systems/audio.ts'
import * as BV from '~/systems/boardView.ts'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as Pieces from '~/systems/piece.tsx'
import * as P from '~/systems/player.ts'
import { trackAndUnwrap } from '~/utils/solid.ts'

import styles from './Game.module.css'
import { Button } from './ui/button.tsx'
import * as Modal from './utils/Modal.tsx'

const GameContext = createContext(null as unknown as { game: G.Game; boardView: BV.BoardView })

export default function GameWrapper(props: { game: G.Game }) {
	const boardCtx = new BV.BoardView(props.game)
	//@ts-expect-error
	window.game = props.game
	//@ts-expect-error
	window.boardCtx = boardCtx
	return (
		<GameContext.Provider value={{ boardView: boardCtx, game: props.game }}>
			<Game />
		</GameContext.Provider>
	)
}

export function Game() {
	const S = useContext(GameContext)
	//#region calc board sizes
	// eslint-disable-next-line prefer-const
	let boardContainerRef = null as unknown as HTMLDivElement

	// eslint-disable-next-line prefer-const
	let boardRef = null as unknown as HTMLDivElement

	{
		const isPortrait = createMediaQuery('(max-aspect-ratio: 7/6')
		const { observe, unobserve } = makeResizeObserver(handleObserverCallback)
		onMount(() => {
			observe(boardRef)
		})
		onCleanup(() => {
			boardRef && unobserve(boardRef)
		})
		function handleObserverCallback(_: ResizeObserverEntry[]) {
			const navbarElt = document.getElementById('navbar')
			if (!navbarElt) throw new Error('Unable to locate navar at id #navbar')

			const baseOffset = 30
			let minHeight = isPortrait() ? window.innerHeight - navbarElt.clientHeight - 150 : window.innerHeight - 80
			let minWidth = isPortrait() ? window.innerWidth : window.innerWidth - navbarElt.clientWidth - 450
			minHeight -= baseOffset
			minWidth -= baseOffset
			const size = Math.min(minWidth, minHeight)
			S.boardView.state.set({ boardSize: size, squareSize: size / 8 })
		}
	}
	//#endregion

	//#region draw offer events
	{
		let sub: Subscription | undefined
		function onEvent(event: G.GameEvent) {
			switch (event.type) {
				case 'draw-offered':
					if (event.playerId === S.game.bottomPlayer.id) {
						toast('Draw offered')
					} else {
						toast(`${S.game.topPlayer.name} offered a draw`)
						Audio.playSound('drawOffered')
						Audio.vibrate()
					}
					break
				case 'draw-canceled':
					if (event.playerId === S.game.bottomPlayer.id) {
						toast('Draw cancelled')
					} else {
						toast(`${S.game.topPlayer.name} cancelled their draw offer`)
						Audio.vibrate()
					}
					break
				case 'draw-declined':
					if (event.playerId === S.game.bottomPlayer.id) {
						toast('Draw declined')
					} else {
						toast(`${S.game.topPlayer.name} declined draw offer`)
						Audio.vibrate()
					}
					break
				// draw being accepted is dealt with in the end game screen
			}
		}
		createEffect(
			on(
				() => S.game,
				() => {
					sub?.unsubscribe()
					sub = S.game.gameContext.event$.subscribe(onEvent)
				}
			)
		)

		onCleanup(() => {
			sub?.unsubscribe()
		})
	}
	//#endregion

	//#region warn with sound effect on low time
	{
		const sub = rxFrom(
			observable(
				() =>
					[
						checkPastWarnThreshold(S.game.gameConfig.timeControl, S.game.clock[S.game.bottomPlayer.color]),
						S.game.isClientPlayerParticipating,
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

	//#region game outcome sound effects
	{
		let sub: Subscription | undefined
		function onEvent(event: GL.GameOutcome | undefined) {
			if (!event) return
			if (event.winner === S.game.bottomPlayer.color) {
				Audio.playSound('winner')
				Audio.vibrate()
			} else {
				Audio.playSound('loser')
				Audio.vibrate()
			}
		}
		createEffect(
			on(
				() => S.game,
				() => {
					sub?.unsubscribe()
					sub = S.game.outcome$.subscribe(onEvent)
				}
			)
		)
		onCleanup(() => {
			sub?.unsubscribe()
		})
	}
	//#endregion

	//#region handle move navigation
	async function handleMoveNavigation(moveIndex: number | 'live') {
		if (S.game.gameConfig.variant === 'fog-of-war') throw new Error('move history navigation not supported for fog of war games')
		moveIndex = moveIndex === 'live' ? S.game.state.moveHistory.length - 1 : moveIndex
		const boardIndex = moveIndex + 1
		if (boardIndex < 0 || boardIndex >= S.game.state.boardHistory.length) throw new Error('invalid move index')
		await S.boardView.updateBoardAnimated(boardIndex)
		const move = S.game.state.moveHistory[moveIndex]
		// TODO time this better
		move && Audio.playSoundEffectForMove(move, false, true)
	}

	const moveNavProps = () => {
		return {
			isLive: S.boardView.state.s.boardIndex === S.game.state.boardHistory.length - 1,
			viewedMoveIndex: S.boardView.state.s.boardIndex - 1,
			setViewedMoveIndex: handleMoveNavigation,
		}
	}

	//#endregion
	const hideHistory = () => S.game.gameConfig.variant === 'fog-of-war'

	return (
		<div
			ref={boardContainerRef}
			class={cn(
				styles.boardContainer,
				'w-full h-full rounded-lg border bg-card p-2 text-card-foreground shadow-sm gap-[0.25rem]',
				hideHistory() ? styles.hideHistory : styles.showHistory
			)}
		>
			<Show when={!hideHistory()}>
				<MoveHistory {...moveNavProps()} />
			</Show>
			<div class={`${styles.topLeftActions} flex items-start space-x-1`}>
				<Button variant="ghost" size="icon" onclick={() => S.boardView.state.set('boardFlipped', (flipped) => !flipped)} class="mb-1">
					<Svgs.Flip />
				</Button>
				<Show when={S.game.gameConfig.variant !== 'regular'}>
					<VariantInfoDialog variant={S.game.gameConfig.variant}>
						<Button variant="ghost" size="icon" class="mb-1">
							<Svgs.Help />
						</Button>
					</VariantInfoDialog>
				</Show>
			</div>
			<Player class={styles.topPlayer} player={S.game.topPlayer} />
			<Clock
				class={styles.clockTopPlayer}
				clock={S.game.clock[S.game.topPlayer.color]}
				ticking={S.game.isPlayerTurn(S.game.topPlayer.color) && S.game.clock[S.game.topPlayer.color] > 0}
				timeControl={S.game.gameConfig.timeControl}
				color={S.game.topPlayer.color}
			/>
			<CapturedPieces class={styles.capturedPiecesContainer} />
			<Board ref={boardRef} />
			<Show when={S.game.isClientPlayerParticipating} fallback={<div class={styles.bottomLeftActions} />}>
				<ActionsPanel class={styles.bottomLeftActions} placingDuck={S.game.isPlacingDuck} />
			</Show>
			<Player class={styles.bottomPlayer} player={S.game.bottomPlayer} />
			<Clock
				class={styles.clockBottomPlayer}
				clock={S.game.clock[S.game.bottomPlayer.color]}
				ticking={S.game.isPlayerTurn(S.game.bottomPlayer.color) && S.game.clock[S.game.bottomPlayer.color] > 0}
				timeControl={S.game.gameConfig.timeControl}
				color={S.game.bottomPlayer.color}
			/>
			<Show when={!hideHistory()}>
				<div class={cn(styles.moveNav, 'self-center justify-self-center min-w-0 wc:self-start')}>
					<MoveNav {...moveNavProps()} />
				</div>
			</Show>
			<GameOutcomeDialog />
		</div>
	)
}

//#region subcomponents
function GameOutcomeDialog() {
	const S = useContext(GameContext)
	const [open, setOpen] = createSignal(false)
	const [showedOutcome, setShowedOutcome] = createSignal(false)
	createEffect(() => {
		if (S.game.outcome && !open() && !showedOutcome()) {
			setOpen(true)
			setShowedOutcome(true)
		}
	})
	return (
		<Dialog open={open()} onOpenChange={setOpen}>
			<DialogContent class="w-min">
				<DialogHeader>
					<DialogTitle>{showGameOutcome(S.game.outcome!)[0]}</DialogTitle>
				</DialogHeader>
				<DialogFooter>
					<DialogDescription>{showGameOutcome(S.game.outcome!)[1]}</DialogDescription>
					<div class="flex justify-center space-x-1">
						<Button onclick={() => S.game.gameContext.backToPregame()}>New Game</Button>
						<Button variant="secondary" onclick={() => setOpen(false)}>
							Continue
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function Player(props: { player: G.PlayerWithColor; class: string }) {
	const S = useContext(GameContext)
	const { colorMode } = useColorMode()
	const isPlayerTurn = () => S.game.isPlayerTurn(props.player.color)
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
			<Show when={S.game.bottomPlayer.color === props.player.color} fallback={title}>
				<HoverCard placement="bottom" open={S.game.isPlacingDuck}>
					<HoverCardTrigger>{title}</HoverCardTrigger>
					<HoverCardContent class="bg-destructive border-destructive p-1 w-max text-sm">
						<span class="text-balance text-destructive-foreground">{`${P.settings.usingTouch ? 'Tap' : 'Click'} square to place duck`}</span>
					</HoverCardContent>
				</HoverCard>
			</Show>
		</div>
	)
}

//#region board

export function Board(props: { ref: HTMLDivElement }) {
	const S = useContext(GameContext)
	const bs = S.boardView.state.s
	// eslint-disable-next-line prefer-const
	let boardRef = null as unknown as HTMLDivElement

	//#region board updates sound effects for incoming moves
	{
		async function onEvent(event: G.GameEvent) {
			if (event.type === 'committed-in-progress-move' && event.playerId !== S.game.bottomPlayer.id) {
				if (!S.boardView.viewingLiveBoard) return
				S.boardView.visualizeMove(S.game.inProgressMove!)
				// TODO we need to play the appropriate sound effect here instead of a generic one
				Audio.playSound('moveOpponent')
			}
			// TODO this is a bug because this move may have happened in a different client
			if (event.type !== 'make-move' || event.playerId === P.playerId()) return
			// to get around moveHistory not being updated by the time the event is dispatched Sadge
			const move = await until(() => S.game.state.moveHistory[event.moveIndex])
			await S.boardView.snapBackToLive()
			const isVisible = S.game.gameConfig.variant !== 'fog-of-war' || S.boardView.visibleSquares().has(move.to)
			if (!move) return
			Audio.playSoundEffectForMove(move, false, isVisible)
			Audio.vibrate()
		}
		let sub: Subscription | undefined
		createEffect(() => {
			sub?.unsubscribe()
			sub = S.game.gameContext.sharedStore.event$.subscribe(onEvent)
		})
		onCleanup(() => {
			sub?.unsubscribe()
		})
	}
	//#endregion

	//#region handle board rollbacks

	{
		let sub: Subscription | undefined
		createEffect(() => {
			sub?.unsubscribe()
			sub = S.game.gameContext.sharedStore.rollback$.subscribe(async (rolledBack) => {
				const events = rolledBack.map((t) => t.events).flat()
				if (events.some((e) => e.type === 'make-move')) {
					S.boardView.updateBoardStatic(S.game.state.boardHistory.length - 1)
				}
			})
		})
		onCleanup(() => {
			sub?.unsubscribe()
		})
	}
	//#endregion

	//#region mouse events
	// TODO change move type
	async function makeMove(move?: GL.InProgressMove, animate: boolean = false) {
		S.game.inProgressMoveLocal.set(move)
		const validationRes = await S.game.validateInProgressMove()
		if (validationRes.code === 'invalid') {
			console.warn('Invalid move')
			return
		}
		if (validationRes.code === 'placing-duck') {
			S.game.commitInProgressMove()
			S.boardView.visualizeMove(S.game.inProgressMoveLocal.get()!, animate)
		}
		if (validationRes.code === 'ambiguous') {
			const ambiguity = S.game.currentMoveAmbiguity!
			if (ambiguity.type === 'promotion') {
				S.game.commitInProgressMove()
				S.boardView.visualizeMove(S.game.inProgressMoveLocal.get()!, animate)
			}
			return
		}

		if (validationRes.code === 'valid') {
			await S.game.makePlayerMove()
			const boardIndex = S.game.state.boardHistory.length - 1
			animate ? await S.boardView.updateBoardAnimated(boardIndex) : S.boardView.updateBoardStatic(boardIndex)
			Audio.playSoundEffectForMove(S.game.state.moveHistory[S.game.state.moveHistory.length - 1], true, true)
			return
		}

		throw new Error('unknown code ' + validationRes.code)
	}

	onMount(() => {
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
		boardRef.addEventListener('mousemove', (e) => mouseMoveListener(e.clientX, e.clientY))
		boardRef.addEventListener('touchmove', (e) => {
			if (e.targetTouches.length === 0) return
			const touch = e.targetTouches[0]
			const touchingPiece = mouseMoveListener(touch.clientX + touchOffsetX(), touch.clientY + touchOffsetY())
			if (touchingPiece) {
				e.preventDefault()
			}
		})

		function mouseMoveListener(clientX: number, clientY: number) {
			if (!S.game.isClientPlayerParticipating || !bs.activeSquare) return false
			const rect = boardRef.getBoundingClientRect()
			const x = clientX - rect.left
			const y = clientY - rect.top
			// TODO check if mouse has left board for a certain period and reset grabbed piece
			S.boardView.mousePos.set({ x, y })
			const update = {} as Partial<BV.BoardViewState>
			if (S.boardView.state.s.grabbingActivePiece && !S.boardView.state.s.mouseMovedAfterGrab) {
				S.boardView.state.set({ mouseMovedAfterGrab: true })
			}
			return true
		}

		boardRef.addEventListener('mousedown', (e) => {
			e.button === 0 && handlePrimaryPress(e.clientX, e.clientY)
		})

		boardRef.addEventListener('contextmenu', (e) => {
			e.preventDefault()
			handleSecondaryPress()
		})

		boardRef.addEventListener('touchstart', (e) => {
			if (e.targetTouches.length === 0) return
			const touch = e.targetTouches[0]
			handlePrimaryPress(touch.clientX, touch.clientY)
		})

		function handlePrimaryPress(clientX: number, clientY: number) {
			if (!S.game.isClientPlayerParticipating || !S.boardView.viewingLiveBoard) return
			const rect = boardRef.getBoundingClientRect()
			const clickCoords = { x: clientX - rect.left, y: clientY - rect.top }
			const mouseSquare = S.boardView.getSquareFromDisplayCoords(clickCoords)
			if (S.game.isPlacingDuck) {
				S.game.setDuck(mouseSquare)
				return
			}

			if (S.boardView.state.s.activeSquare) {
				if (S.boardView.isLegalForActive(mouseSquare)) {
					makeMove({ from: S.boardView.state.s.activeSquare, to: mouseSquare }, true)
					return
				}

				if (S.boardView.squareContainsPlayerPiece(mouseSquare)) {
					S.boardView.mousePos.set(clickCoords)
					S.boardView.state.set({ activeSquare: mouseSquare, grabbingActivePiece: true, mouseMovedAfterGrab: false })
					return
				}

				S.boardView.state.set({ activeSquare: null, mouseMovedAfterGrab: false })
				return
			}

			if (S.boardView.squareContainsPlayerPiece(mouseSquare)) {
				S.boardView.mousePos.set(clickCoords)
				S.boardView.state.set({ activeSquare: mouseSquare, grabbingActivePiece: true, mouseMovedAfterGrab: false })
				return
			} else {
				S.boardView.state.set({ activeSquare: null, mouseMovedAfterGrab: false })
			}
		}

		function handleSecondaryPress() {
			if (!S.game.isClientPlayerParticipating || !S.boardView.viewingLiveBoard) return
			// TODO draw arrows
			S.boardView.state.set({ activeSquare: null, grabbingActivePiece: false, mouseMovedAfterGrab: false })
		}

		boardRef.addEventListener('mouseup', (e) => {
			if (e.button === 0) handlePrimaryRelease(e.clientX, e.clientY)
		})
		boardRef.addEventListener('touchend', (e) => {
			if (e.changedTouches.length === 0) return
			const touch = e.changedTouches[0]
			handlePrimaryRelease(touch.clientX + touchOffsetX(), touch.clientY + touchOffsetY())
		})

		function handlePrimaryRelease(clientX: number, clientY: number) {
			if (!S.game.isClientPlayerParticipating || !S.boardView.viewingLiveBoard) return
			const rect = boardRef.getBoundingClientRect()
			const square = S.boardView.getSquareFromDisplayCoords({ x: clientX - rect.left, y: clientY - rect.top })

			if (S.boardView.state.s.grabbingActivePiece && S.boardView.isLegalForActive(square)) {
				makeMove({ from: S.boardView.state.s.activeSquare!, to: square })
			} else if (S.boardView.state.s.grabbingActivePiece) {
				S.boardView.state.set({ grabbingActivePiece: false, mouseMovedAfterGrab: false })
			}
		}
	})
	const promoteModalPosition = () => {
		if (!S.game.currentMoveAmbiguity) return undefined
		let { x, y } = S.boardView.squareNotationToDisplayCoords(S.game.inProgressMove!.to)
		y += boardRef.getBoundingClientRect().top + window.scrollY
		x += boardRef.getBoundingClientRect().left + window.scrollX
		if (S.boardView.state.s.boardSize / 2 < x) {
			x -= 180
		}

		return [`${x}px`, `${y}px`] as [string, string]
	}

	Modal.addModal({
		title: null,
		render: () => (
			<Switch>
				<Match when={S.game.currentMoveAmbiguity?.type === 'promotion'}>
					<div class="flex w-[180px] flex-row justify-between space-x-1">
						<For each={GL.PROMOTION_PIECES}>
							{(pp) => {
								const Piece = Pieces.getPieceSvg({ type: pp, color: S.game.bottomPlayer.color })
								return (
									<Button
										classList={{ 'bg-neutral-200': S.game.bottomPlayer.color !== 'white' }}
										variant={S.game.bottomPlayer.color === 'white' ? 'ghost' : 'default'}
										size="icon"
										onclick={() => {
											if (S.game.currentMoveAmbiguity?.type !== 'promotion') return
											S.game.selectPromotion(pp)
										}}
									>
										<Piece />
									</Button>
								)
							}}
						</For>
					</div>
				</Match>
				<Match when={S.game.currentMoveAmbiguity?.type === 'castle'}>
					<div class="flex flex-col items-center">
						<h3>Castle?</h3>
						<div class="flex space-between space-x-1">
							<Button
								onclick={() => {
									if (S.game.currentMoveAmbiguity?.type !== 'castle')
										throw new Error("This shouldn't happen, if it does that's interesting at least")
									S.game.selectIsCastling(true)
								}}
							>
								Yes
							</Button>
							<Button
								onclick={() => {
									if (S.game.currentMoveAmbiguity?.type !== 'castle')
										throw new Error("This shouldn't happen, if it does that's interesting at least")
									S.game.selectIsCastling(false)
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
		visible: () => !!S.game.currentMoveAmbiguity,
		closeOnEscape: false,
		closeOnOutsideClick: false,
		setVisible: () => {},
	})
	//#endregion
	const occupiedSquares = new ReactiveSet()
	createRenderEffect(() => {
		Object.keys(trackAndUnwrap(bs.board.pieces)).forEach((square) => {
			occupiedSquares.add(square)
		})
	})

	return (
		<div class={`w-full h-full ${styles.board}`} ref={props.ref}>
			<div ref={boardRef} class="bg-board-brown relative mx-auto" style={{ width: `${bs.boardSize}px`, height: `${bs.boardSize}px` }}>
				<Show when={S.boardView.moveOnBoard()}>
					<div
						class={cn(GRID_ALIGNED_CLASSES, `bg-green-300`)}
						style={boardPositionStyles(S.boardView.squareNotationToDisplayCoords(S.boardView.moveOnBoard()!.from))}
					/>
					<div
						class={cn(GRID_ALIGNED_CLASSES, `bg-green-300`)}
						style={boardPositionStyles(S.boardView.squareNotationToDisplayCoords(S.boardView.moveOnBoard()!.to))}
					/>
				</Show>
				<Show when={bs.activeSquare}>
					<HighlightOutlineSvg
						class={cn(GRID_ALIGNED_CLASSES)}
						stroke="rgb(96 165 250)"
						style={boardPositionStyles(S.boardView.squareNotationToDisplayCoords(bs.activeSquare!))}
					/>
				</Show>
				<For each={S.boardView.squareWarnings()}>
					{(square) => (
						<div
							class={cn(GRID_ALIGNED_CLASSES, `bg-red-400`)}
							style={boardPositionStyles(S.boardView.squareNotationToDisplayCoords(square))}
						/>
					)}
				</For>
				<Show when={S.boardView.hoveredSquare()}>
					<HighlightOutlineSvg
						class={cn(GRID_ALIGNED_CLASSES)}
						style={boardPositionStyles(S.boardView.squareNotationToDisplayCoords(S.boardView.hoveredSquare()!))}
						stroke="white"
					/>
				</Show>
				<Show when={P.settings.showAvailablemoves}>
					<For each={S.boardView.legalMovesForActiveSquare()}>
						{(square) => (
							<div
								class={cn(GRID_ALIGNED_CLASSES, 'grid place-items-center')}
								style={boardPositionStyles(S.boardView.squareNotationToDisplayCoords(square))}
							>
								<span class="w-[12%] h-[12%] bg-zinc-50 rounded-full" />
							</div>
						)}
					</For>
				</Show>
				<For each={GL.ALL_SQUARES}>
					{(square) => {
						const res = createMemo(() => S.boardView.getPieceDisplayDetails(square)!)
						return (
							<Show when={occupiedSquares.has(square) && res()}>
								<Piece pieceGrabbed={false} position={res().coords} piece={bs.board.pieces[square]} />
							</Show>
						)
					}}
				</For>
				<Show when={bs.activeSquare && S.boardView.state.s.grabbingActivePiece}>
					<GrabbedPiece />
				</Show>
			</div>
		</div>
	)
}

function GrabbedPiece() {
	const S = useContext(GameContext)
	const s = S.boardView.state.s
	if (!s.activeSquare || !S.boardView.mousePos.get()) throw new Error('Mouse position should be set')

	return (
		<Piece
			pieceGrabbed={true}
			piece={s.board.pieces[s.activeSquare!]}
			position={{ x: S.boardView.mousePos.get()!.x - s.squareSize / 2, y: S.boardView.mousePos.get()!.y - s.squareSize / 2 }}
		/>
	)
}

function HighlightOutlineSvg(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
	return (
		<svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
			<rect x="0" y="0" width="100" height="100" stroke-width="8" fill="none" />
		</svg>
	)
}

type PieceProps = {
	position: BV.DisplayCoords
	piece: GL.ColoredPiece
	pieceGrabbed: boolean
}

const GRID_ALIGNED_CLASSES = 'absolute top-0 left-0 w-[12.5%] h-[12.5%] will-change-transform'
function Piece(props: PieceProps) {
	return (
		<div
			class={cn(
				GRID_ALIGNED_CLASSES,
				'h-[12.5%] w-[12.5%] z-5 will-change-transform',
				`${styles.piece} ${styles[Pieces.getPieceKey(props.piece)]}`,
				props.pieceGrabbed ? 'cursor-grabbing' : 'cursor-grab'
			)}
			style={{ ...boardPositionStyles(props.position), 'background-image': `url(${Pieces.getPieceSrc(props.piece)})` }}
		/>
	)
}

function boardPositionStyles(position: BV.DisplayCoords) {
	return { transform: `translate(${position.x}px, ${position.y}px)` }
}

//#endregion

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
	const S = useContext(GameContext)
	return (
		<span class={props.class}>
			<Switch>
				<Match when={!S.game.outcome}>
					<DrawHoverCard>
						<span>
							<Show when={!S.game.gameConfig.bot}>
								<Button
									disabled={!!S.game.drawIsOfferedBy}
									title="Offer Draw"
									size="icon"
									variant="ghost"
									onclick={() => S.game.offerOrAcceptDraw()}
								>
									<Svgs.OfferDraw />
								</Button>
							</Show>
							<ResignButton />
						</span>
					</DrawHoverCard>
				</Match>
				<Match when={S.game.outcome}>
					<Button size="sm" onclick={() => S.game.gameContext.backToPregame()}>
						New Game
					</Button>
				</Match>
			</Switch>
		</span>
	)
}

function ResignButton() {
	const S = useContext(GameContext)
	const [open, setOpen] = createSignal(false)

	return (
		<Dialog open={open()} onOpenChange={setOpen}>
			<DialogTrigger>
				<Button disabled={!!S.game.drawIsOfferedBy} title="Resign" size="icon" variant="ghost">
					<Svgs.Resign />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Confirm Resignation</DialogTitle>
				</DialogHeader>
				<DialogFooter>
					<DialogDescription>Are you sure you want to resign?</DialogDescription>
					<div class="flex space-x-1">
						<Button variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button onClick={() => S.game.resign()}>Resign</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function DrawHoverCard(props: ParentProps) {
	const S = useContext(GameContext)
	return (
		<HoverCard placement="bottom" open={!!S.game.drawIsOfferedBy}>
			<HoverCardTrigger>{props.children}</HoverCardTrigger>
			<HoverCardContent class="w-max p-[0.25rem]">
				<Show when={S.game.drawIsOfferedBy === S.game.bottomPlayer.color}>
					<Button size="sm" onClick={() => S.game.declineOrCancelDraw()}>
						Cancel Draw
					</Button>
				</Show>
				<Show when={S.game.drawIsOfferedBy === S.game.topPlayer.color}>
					<div class="flex space-x-1">
						<Button size="sm" onClick={() => S.game.offerOrAcceptDraw()}>
							Accept Draw
						</Button>
						<Button size="sm" onClick={() => S.game.declineOrCancelDraw()}>
							Decline Draw
						</Button>
					</div>
				</Show>
			</HoverCardContent>
		</HoverCard>
	)
}

function MoveHistory(props: MoveNavProps) {
	const S = useContext(GameContext)
	const itemClass = 'grid grid-cols-[min-content_1fr_1fr] gap-1 text-xs items-center'

	return (
		<div class={`${styles.moveHistoryContainer} grid grid-cols-2 h-max max-h-full gap-x-4 min-w-96 gap-y-1 p-1 overflow-y-auto`}>
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
			<For each={GL.getMoveHistoryAsNotation(S.game.state.moveHistory)}>
				{(moves, index) => {
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
								<span class="font-mono">{moves[0]}</span>
							</Button>{' '}
							<Show when={moves[1]}>
								<Button
									size="sm"
									class="p-[.25rem] font-light"
									variant={viewingSecondMove() ? 'default' : 'ghost'}
									onClick={() => props.setViewedMoveIndex(index() * 2 + 1)}
								>
									{moves[1]}
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
export function CapturedPieces(props: { class: string }) {
	const S = useContext(GameContext)
	return (
		<div class={cn(props.class, 'flex flex-col wc:flex-row justify-between space-y-1 wc:space-y-0 wc:space-x-1')}>
			<CapturedPiecesForColor pieces={S.game.capturedPieces(S.game.bottomPlayer.color)} capturedBy={'top-player'} />
			<CapturedPiecesForColor pieces={S.game.capturedPieces(S.game.topPlayer.color)} capturedBy={'bottom-player'} />
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

//#region helpers
function showGameOutcome(outcome: GL.GameOutcome): [string, string] {
	const S = useContext(GameContext)
	const winner = outcome.winner ? S.game.players.find((p) => p.color === outcome.winner)! : null
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
