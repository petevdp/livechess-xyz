import { createResource, Match, onCleanup, ParentProps, Show, Switch } from 'solid-js'
import toast from 'solid-toast'
import * as PC from '~/systems/piece.ts'
import * as P from '~/systems/player.ts'
import QRCode from 'qrcode'
import { Game } from './Game.tsx'
import * as GL from '~/systems/game/gameLogic.ts'
import * as R from '~/systems/room.ts'
import SwapSvg from '~/assets/icons/swap.svg'
import { ScreenFittingContent } from '~/components/AppContainer.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Choice, MultiChoiceButton } from '~/components/utils/MultiChoiceButton.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '~/components/ui/hover-card.tsx'

export function Room() {
	const room = R.room()!
	if (!room) throw new Error('room is not initialized')

	//#region toast basic room events
	const sub = room.action$.subscribe((action) => {
		console.log({ action })
		switch (action.type) {
			case 'player-connected':
				if (action.player.id === P.playerId()) {
					toast('Connected to room')
				} else {
					toast(`${action.player.name} connected`)
				}
				break
			case 'player-disconnected':
				if (action.player.id === P.playerId()) {
					toast('Disconnected from room')
				} else {
					toast(`${action.player.name} disconnected`)
				}
				break
			case 'player-reconnected':
				if (action.player.id === P.playerId()) {
					toast('Reconnected to room')
				} else {
					toast(`${action.player.name} reconnected`)
				}
				break
		}
	})
	//#endregion

	onCleanup(() => {
		sub.unsubscribe()
	})

	return (
		<Switch>
			<Match when={room.state.status === 'pregame'}>
				<Lobby />
			</Match>
			<Match when={room.rollbackState.activeGameId}>
				<Game gameId={room.rollbackState.activeGameId!} />
			</Match>
			<Match when={true}>
				<div>idk</div>
			</Match>
		</Switch>
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

	return (
		<div class="flex flex-col gap-y-1">
			<MultiChoiceButton
				label="Variant"
				listClass="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 text-sm space-x-0 gap-1"
				choices={GL.VARIANTS.map((c) => ({ label: c, id: c }) satisfies Choice<GL.Variant>)}
				selected={gameConfig().variant}
				onChange={(v) => room!.setGameConfig({ variant: v })}
			/>
			<MultiChoiceButton
				listClass="grid grid-rows-1 grid-cols-3 md:grid-cols-5 w-full tex-sm space-x-0 gap-1"
				label="Time Control"
				choices={GL.TIME_CONTROLS.map((tc) => ({ label: tc, id: tc }) satisfies Choice<GL.TimeControl>)}
				selected={gameConfig().timeControl}
				onChange={(v) => room!.setGameConfig({ timeControl: v })}
			/>
			<MultiChoiceButton
				label="Increment"
				listClass="grid  grid-cols-4 text-sm"
				choices={GL.INCREMENTS.map((i) => ({ label: `${i}s`, id: i }) satisfies Choice<GL.Increment>)}
				selected={gameConfig().increment}
				onChange={(v) => room!.setGameConfig({ increment: v })}
			/>
			<PlayerAwareness />
		</div>
	)
}

// when this client's player is participating
function PlayerAwareness() {
	const room = R.room()!
	const leftPlayerColor: () => GL.Color | null = () => (room.leftPlayer?.id ? room.playerColor(room.leftPlayer.id) : null)
	const rightPlayer: () => GL.Color = () => (leftPlayerColor() === 'white' ? 'black' : 'white')

	const sub = room.action$.subscribe((action) => {
		switch (action.type) {
			case 'agree-piece-swap':
				if (action.player.id === room.leftPlayer?.id) {
					toast(`Swapped Pieces! You are now ${leftPlayerColor()}`)
				}
				break
			case 'decline-or-cancel-piece-swap':
				if (action.player.id === room.rightPlayer?.id) {
					toast(`${room.rightPlayer.name} declined piece swap`)
				} else {
					toast('Piece swap cancelled')
				}
				break
			case 'initiate-piece-swap':
				if (action.player.id === room.rightPlayer?.id) {
				} else {
					const waitingPlayer = action.player.id === room.leftPlayer?.id ? room.rightPlayer : room.leftPlayer
					toast(`Waiting for ${waitingPlayer!.name} to accept piece swap`)
				}
		}
	})

	onCleanup(() => {
		sub.unsubscribe()
	})

	// large margin needed for headroom for piece switch popup
	return (
		<div class="col-span-2 m-auto mt-8 grid grid-cols-[1fr_min-content_1fr] items-center">
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
						agreePieceSwap={() => room.agreePieceSwap()}
						declinePieceSwap={() => room.declineOrCancelPieceSwap()}
					/>
				</Match>
				<Match when={true}>
					<OpponentPlaceholder color={leftPlayerColor()!} />
				</Match>
			</Switch>
			<span></span>
			<Show when={room.rightPlayer} fallback={<OpponentPlaceholder color={rightPlayer()} />}>
				<OpponentConfigDisplay
					opponent={room.rightPlayer!}
					color={rightPlayer()}
					agreePieceSwap={() => room.agreePieceSwap()}
					declinePieceSwap={() => room.declineOrCancelPieceSwap()}
				/>
			</Show>
			<PlayerColorDisplay color={leftPlayerColor() || 'white'} />
			<SwapButton disabled={room.leftPlayer?.id !== room.player.id} alreadySwapping={room.leftPlayer?.agreeColorSwap || false} initiatePieceSwap={() => room.initiatePieceSwap()} />
			<PlayerColorDisplay color={rightPlayer() || 'black'} />
		</div>
	)
}

function PlayerColorDisplay(props: { color: GL.Color }) {
	return (
		<div class="ml-auto mr-auto flex w-[5rem] items-center justify-center">
			<img alt={`${props.color} king`} src={PC.resolvePieceImagePath({ type: 'king', color: props.color })} />
		</div>
	)
}

function SwapButton(props: { initiatePieceSwap: () => void; alreadySwapping: boolean; disabled: boolean }) {
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
							<SwapSvg />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Swap Pieces</TooltipContent>
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
			<HoverCard open={props.opponent.agreeColorSwap}>
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
