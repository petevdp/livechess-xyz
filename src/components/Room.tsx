import QRCode from 'qrcode'
import { Match, ParentProps, Show, Suspense, Switch, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import toast from 'solid-toast'

import { ScreenFittingContent } from '~/components/AppContainer.tsx'
import Game from '~/components/Game.tsx'
import { Spinner } from '~/components/Spinner.tsx'
import * as Svgs from '~/components/Svgs.tsx'
import { VariantInfoDialog } from '~/components/VariantInfoDialog.tsx'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '~/components/ui/alert-dialog.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '~/components/ui/hover-card.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip.tsx'
import { Choice, MultiChoiceButton } from '~/components/utils/MultiChoiceButton.tsx'
import * as Audio from '~/systems/audio.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import { getPieceSvg } from '~/systems/piece.tsx'
import * as P from '~/systems/player.ts'
import * as R from '~/systems/room.ts'
import {cn} from "~/lib/utils.ts";

export function Room() {
	const room = R.room()!
	if (!room) throw new Error('room is not initialized')

	//#region toast basic room events
	const sub = room.event$.subscribe((action) => {
		switch (action.type) {
			case 'player-connected':
				if (action.player!.id === P.playerId()) {
					toast('Connected to room')
				} else {
					toast(`${action.player!.name} connected`)
				}
				break
			case 'player-disconnected':
				if (action.player!.id === P.playerId()) {
					toast('Disconnected from room')
				} else {
					toast(`${action.player!.name} disconnected`)
				}
				break
			case 'player-reconnected':
				if (action.player!.id === P.playerId()) {
					toast('Reconnected to room')
				} else {
					toast(`${action.player!.name} reconnected`)
				}
				break
			case 'new-game':
				Audio.playSound('gameStart')
				Audio.vibrate()
				break
		}
	})
	//#endregion

	onCleanup(() => {
		sub.unsubscribe()
	})
	const [dismissedMultipleClientsWarning, setDismissedMultipleClientsWarning] = createSignal(true)
	onMount(() => {
		if (room.playerHasMultipleClients && !P.settings.dismissMultipleClientsWarning) {
			setDismissedMultipleClientsWarning(false)
		}
	})

	return (
		<>
			<Switch>
				<Match when={room.state.status === 'pregame'}>
					<Lobby />
				</Match>
				<Match when={room.rollbackState.activeGameId}>
					<Suspense
						fallback={
							<ScreenFittingContent class="grid place-items-center">
								<Spinner />
							</ScreenFittingContent>
						}
					>
						<Game gameId={room.rollbackState.activeGameId!} />
					</Suspense>
				</Match>
			</Switch>
			<AlertDialog open={!dismissedMultipleClientsWarning()}>
				<AlertDialogContent>
					<AlertDialogTitle>Warning</AlertDialogTitle>
					<AlertDialogDescription>
						You are connecting to the same room from a second browser tab.
						<br /> If you want to test this app yourself, open an incognito window instead.
					</AlertDialogDescription>
					<Button
						onClick={() => {
							setDismissedMultipleClientsWarning(true)
							P.settings.dismissMultipleClientsWarning = true
						}}
					>
						Dismiss
					</Button>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

function Lobby() {
	const room = R.room()!
	if (!room) throw new Error('room is not initialized')

	const copyInviteLink = () => {
		toast('Copied invite link to clipboard')
		navigator.clipboard.writeText(window.location.href).then(() => {})
	}

	return (
		<ScreenFittingContent class="grid place-items-center p-2">
			<Card class="w-[95vw] p-1 sm:w-auto">
				<CardHeader>
					<CardTitle class="text-center">Configure Game</CardTitle>
				</CardHeader>
				<CardContent class="p-1">
					<GameConfigForm />
				</CardContent>
				<CardFooter class="flex justify-center space-x-1">
					<QrCodeDialog />
					<Button onclick={copyInviteLink}>Copy Invite Link</Button>
				</CardFooter>
			</Card>
		</ScreenFittingContent>
	)
}

function QrCodeDialog() {
	const [dataUrl] = createResource(() => QRCode.toDataURL(window.location.href, { scale: 12 }))
	return (
		<Dialog>
			<DialogTrigger as={Button}>Show QR Code</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Scan to Join LiveChess Room</DialogTitle>
					<img alt="QR Code for Room" class="aspect-square" src={dataUrl()!} />
				</DialogHeader>
			</DialogContent>
		</Dialog>
	)
}

function GameConfigForm() {
	const room = R.room()!
	if (!room) throw new Error('room is not initialized')
	const gameConfig = () => room!.rollbackState.gameConfig
	const QuestionMark = () => <span class={`p-1 leading-[24px] text-md text-primary underline cursor-pointer`}>?</span>
	const helpCardLabel = (
		<div class="flex justify-center items-center text-inherit">
			<VariantInfoDialog variant={room.rollbackState.gameConfig.variant}>
				<label>
					Variant <QuestionMark />
				</label>
			</VariantInfoDialog>
		</div>
	)

	const timeControlLabel = (
		<div class="flex justify-center items-center text-inherit">
			<Popover>
				<PopoverTrigger>
					<label>
						Time Control <QuestionMark />
					</label>
				</PopoverTrigger>
				<PopoverContent>
					<div class="flex flex-col space-y-1">
						<span>Each player gets the set amount of time at the start of the game.</span>
						<span>When you run out of time, you lose.</span>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)

	const incrementLabel = (
		<div class="flex justify-center items-center text-inherit">
			<Popover>
				<PopoverTrigger>
					<label>
						Increment <QuestionMark />
					</label>
				</PopoverTrigger>
				<PopoverContent>
					<div class="flex flex-col space-y-1">
						<span>Each time you make a move, you gain the set amount of time.</span>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)

	return (
		<div class="flex flex-col gap-y-1">
			<MultiChoiceButton
				label={helpCardLabel}
				listClass="grid grid-cols-2 md:grid-cols-4 text-sm space-x-0 gap-1"
				choices={GL.VARIANTS.map((c) => ({ label: c, id: c }) satisfies Choice<GL.Variant>)}
				selected={gameConfig().variant}
				onChange={(v) => room!.setGameConfig({ variant: v })}
				disabled={!room.isPlayerParticipating || room.leftPlayer?.isReadyForGame}
			/>
			<MultiChoiceButton
				label={timeControlLabel}
				listClass="grid grid-rows-1 grid-cols-3 w-full tex-sm space-x-0 gap-1"
				choices={GL.TIME_CONTROLS.map((tc) => ({ label: tc, id: tc }) satisfies Choice<GL.TimeControl>)}
				selected={gameConfig().timeControl}
				onChange={(v): void => {
					if (v === 'unlimited') {
						room!.setGameConfig({ increment: '0', timeControl: v })
					} else {
						room!.setGameConfig({ timeControl: v })
					}
				}}
				disabled={!room.isPlayerParticipating || room.leftPlayer?.isReadyForGame}
			/>
			<MultiChoiceButton
				label={incrementLabel}
				listClass="grid  grid-cols-4 text-sm"
				choices={GL.INCREMENTS.map((i) => ({ label: `${i}s`, id: i }) satisfies Choice<GL.Increment>)}
				selected={gameConfig().increment}
				onChange={(v) => {
					if (gameConfig().timeControl === 'unlimited') return
					room!.setGameConfig({ increment: v })
				}}
				disabled={!room.isPlayerParticipating || room.leftPlayer?.isReadyForGame || gameConfig().timeControl === 'unlimited'}
			/>
			<PlayerAwareness />
		</div>
	)
}

// when this client's player is participating
function PlayerAwareness() {
	const room = R.room()!
	const leftPlayerColor: () => GL.Color = () => room.leftPlayer?.color || 'white'
	const rightPlayerColor: () => GL.Color = () => GL.oppositeColor(leftPlayerColor())

	const sub = room.event$.subscribe((action) => {
		switch (action.type) {
			case 'agree-piece-swap':
				if (action.player!.id === room.leftPlayer?.id) {
					toast(`Swapped Pieces! You are now ${leftPlayerColor()}`)
				}
				break
			case 'decline-or-cancel-piece-swap':
				if (action.player!.id === room.rightPlayer?.id) {
					toast(`${room.rightPlayer.name} declined piece swap`)
				} else {
					toast('Piece swap cancelled')
				}
				break
			case 'initiate-piece-swap':
				if (action.player!.id !== room.rightPlayer?.id) {
					const waitingPlayer = action.player!.id === room.leftPlayer?.id ? room.rightPlayer : room.leftPlayer
					toast(`Waiting for ${waitingPlayer!.name} to accept piece swap`)
				}
		}
	})

	onCleanup(() => {
		sub.unsubscribe()
	})

	// large margin needed for headroom for piece switch popup
	return (
		<div class="col-span-2 m-auto mt-8 grid grid-cols-[1fr_min-content_1fr] items-center gap-2">
			<Switch>
				<Match when={room.leftPlayer?.id === room.player.id}>
					<PlayerConfigDisplay
						canStartGame={room.canStartGame}
						toggleReady={() => room.toggleReady()}
						player={room.leftPlayer!}
						color={room.playerColor(room.player.id)!}
						cancelPieceSwap={() => room.declineOrCancelPieceSwap()}
					/>
				</Match>
				<Match when={room.leftPlayer}>
					<OpponentConfigDisplay
						opponent={room.leftPlayer!}
						color={leftPlayerColor()!}
						agreePieceSwap={() => room.initiateOrAgreePieceSwap()}
						declinePieceSwap={() => room.declineOrCancelPieceSwap()}
					/>
				</Match>
				<Match when={true}>
					<OpponentPlaceholder color={leftPlayerColor()!} />
				</Match>
			</Switch>
			<span />
			<Show when={room.rightPlayer} fallback={<OpponentPlaceholder color={rightPlayerColor()} />}>
				<OpponentConfigDisplay
					opponent={room.rightPlayer!}
					color={rightPlayerColor()}
					agreePieceSwap={() => room.initiateOrAgreePieceSwap()}
					declinePieceSwap={() => room.declineOrCancelPieceSwap()}
				/>
			</Show>
			<PlayerColorDisplay color={leftPlayerColor()} />
			<SwapButton
				disabled={
					!room.isPlayerParticipating ||
					room.leftPlayer?.agreePieceSwap ||
					room.rightPlayer?.agreePieceSwap ||
					room.leftPlayer?.isReadyForGame
				}
				alreadySwapping={room.leftPlayer?.agreePieceSwap || false}
				initiatePieceSwap={() => room.initiateOrAgreePieceSwap()}
			/>
			<PlayerColorDisplay color={rightPlayerColor()} />
		</div>
	)
}

const WhiteKingSvg = getPieceSvg({ type: 'king', color: 'white' })
const BlackKingSvg = getPieceSvg({ type: 'king', color: 'black' })

function PlayerColorDisplay(props: { color: GL.Color }) {
	return (
		<div class={cn("ml-auto mr-auto flex w-[5rem] items-center justify-center rounded-full", "dark:bg-foreground" )}>
			{props.color === 'white' ? <WhiteKingSvg class="w-full h-full" /> : <BlackKingSvg class="w-full h-full" />}
		</div>
	)
}

function SwapButton(props: { initiatePieceSwap: () => void; alreadySwapping: boolean; disabled?: boolean }) {
	const requestSwap = () => {
		if (props.alreadySwapping || props.disabled) return
		props.initiatePieceSwap()
	}

	return (
		<div class="m-auto ml-auto mr-auto flex flex-col items-center justify-end">
			<div class="flex flex-col justify-center">
				<Tooltip>
					<TooltipTrigger>
						<Button disabled={props.disabled} onclick={requestSwap} size="icon" variant="ghost">
							<Svgs.Swap />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Ask to Swap Pieces</TooltipContent>
				</Tooltip>
			</div>
		</div>
	)
}

function PlayerConfigDisplay(props: {
	player: R.GameParticipant
	color: GL.Color
	toggleReady: () => void
	cancelPieceSwap: () => void
	canStartGame: boolean
}) {
	return (
		<PlayerDisplayContainer color={props.color}>
			<span class="whitespace-nowrap text-xs">{props.player.name} (You)</span>
			<Show when={!props.player.isReadyForGame}>
				<Button size="sm" class="whitespace-nowrap" onclick={() => props.toggleReady()}>
					{props.canStartGame ? 'Start Game' : 'Ready Up!'}
				</Button>
			</Show>
			<Show when={props.player.isReadyForGame}>
				<div class="flex flex-row items-center space-x-1">
					<span>Ready!</span>
					<Button size="sm" variant="secondary" onclick={() => props.toggleReady()}>
						Unready
					</Button>
				</div>
			</Show>
		</PlayerDisplayContainer>
	)
}

function OpponentConfigDisplay(props: {
	opponent: R.GameParticipant
	color: GL.Color
	agreePieceSwap: () => void
	declinePieceSwap: () => void
}) {
	return (
		<PlayerDisplayContainer color={props.color}>
			{/*<span ref={ref}>{props.opponent.name}</span>*/}
			<HoverCard open={props.opponent.agreePieceSwap}>
				<HoverCardTrigger>
					<span>{props.opponent.name}</span>
				</HoverCardTrigger>
				<HoverCardContent>
					<div class="flex flex-col space-y-1">
						<span class="text-xs">{props.opponent.name} wants to swap colors</span>
						<div class="space-x-1">
							<Button
								size="sm"
								onClick={() => {
									props.agreePieceSwap()
								}}
							>
								Accept
							</Button>
							<Button
								size="sm"
								onclick={() => {
									props.declinePieceSwap()
								}}
								variant="secondary"
							>
								Decline
							</Button>
						</div>
					</div>
				</HoverCardContent>
			</HoverCard>
			<Show when={props.opponent.isReadyForGame} fallback={<div>Not Ready</div>}>
				<div>Ready</div>
			</Show>
		</PlayerDisplayContainer>
	)
}

function PlayerDisplayContainer(props: ParentProps<{ color: GL.Color }>) {
	return (
		<div class="ml-auto mr-auto flex h-min w-[5rem] flex-col items-center">
			<div class="2 flex flex-col items-center justify-center rounded border-solid border-gray-700 text-center">{props.children}</div>
		</div>
	)
}

function OpponentPlaceholder(props: { color: GL.Color }) {
	return <PlayerDisplayContainer color={props.color}>Waiting for Player...</PlayerDisplayContainer>
}
