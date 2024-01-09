import { createEffect, createSignal, Match, onCleanup, onMount, ParentProps, Show, Switch } from 'solid-js'
import toast from 'solid-toast'
import * as PC from '../systems/piece.ts'
import * as P from '../systems/player.ts'
import { Board } from './Board.tsx'
import { Choice, MultiChoiceButton } from '../MultiChoiceButton.tsx'
import * as GL from '../systems/game/gameLogic.ts'
import * as R from '../systems/room.ts'
import { tippy } from '../utils/tippy.tsx'
import { Game } from './Game.tsx'
import { until } from '@solid-primitives/promise'
import SwapSvg from '../assets/icons/swap.svg'
import * as TIP from 'tippy.js'

function CenterPanel(props: ParentProps) {
	return (
		<div class="ml-1 mr-1 grid h-[calc(100vh_-_4rem)] place-items-center">
			<div class="rounded bg-gray-800 p-[.5rem]">{props.children}</div>
		</div>
	)
}

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
				<Board gameId={room.rollbackState.activeGameId!} />
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
		navigator.clipboard.writeText(window.location.href)
	}

	return (
		<CenterPanel>
			<div class="flex flex-col space-y-1">
				<GameConfigForm />
				<div class="col-span-1 flex w-full justify-center space-x-1">
					<Game size="medium" kind="primary" class="whitespace-nowrap" onclick={copyInviteLink}>
						Copy Invite Link
					</Game>
					<Game kind="primary" size="medium">
						Share
					</Game>
					<Game kind="primary" size="medium">
						Show QR Code
					</Game>
				</div>
			</div>
		</CenterPanel>
	)
}

function GameConfigForm() {
	const room = R.room()!
	if (!room) throw new Error('room is not initialized')
	const gameConfig = () => room!.rollbackState.gameConfig

	return (
		<div class="grid grid-cols-2 grid-rows-[min-content_auto_auto] gap-3 ">
			<MultiChoiceButton
				label="Variant"
				classList={{
					grid: true,
					'grid-rows-1': true,
					'grid-cols-4': true,
					'col-span-full': true,
					'grid-rows-[min-content_5em]': true,
				}}
				choices={GL.VARIANTS.map((c) => ({ label: c, id: c }) satisfies Choice<GL.Variant>)}
				selected={gameConfig().variant}
				onChange={(v) => room!.setGameConfig({ variant: v })}
			/>
			<MultiChoiceButton
				classList={{
					grid: true,
					'grid-rows-1': true,
					'grid-cols-5': true,
					'w-full': true,
					'text-sm': true,
				}}
				label="Time Control"
				choices={GL.TIME_CONTROLS.map((tc) => ({ label: tc, id: tc }) satisfies Choice<GL.TimeControl>)}
				selected={gameConfig().timeControl}
				onChange={(v) => room!.setGameConfig({ timeControl: v })}
			/>
			<MultiChoiceButton
				label="Increment"
				classList={{
					grid: true,
					'grid-rows-1': true,
					'grid-cols-4': true,
					'text-sm': true,
				}}
				choices={GL.INCREMENTS.map((i) => ({ label: `${i}s`, id: i }) satisfies Choice<GL.Increment>)}
				selected={gameConfig().increment}
				onChange={(v) => room!.setGameConfig({ increment: v })}
			/>
			<PlayerAwareness />
		</div>
	)
}

function PlayerAwareness() {
	const room = R.room()!
	const playerColor: () => GL.Color = () => (room.rollbackState.whitePlayerId === P.playerId() ? 'white' : 'black')
	const opponentColor: () => GL.Color = () => (playerColor() === 'white' ? 'black' : 'white')

	const sub = room.action$.subscribe((action) => {
		switch (action.type) {
			case 'agree-piece-swap':
				toast(`Swapped Pieces! You are now ${playerColor()}`)
				break
			case 'decline-or-cancel-piece-swap':
				if (action.player.id === room.opponent?.id) {
					toast(`${room.opponent.name} declined piece swap`)
				} else {
					toast('Piece swap cancelled')
				}
				break
			case 'initiate-piece-swap':
				if (action.player.id === room.opponent?.id) {
				} else {
					toast('Waiting for opponent to accept piece swap')
				}
		}
	})

	onCleanup(() => {
		sub.unsubscribe()
	})

	// large margin needed for headroom for piece switch popup
	return (
		<div class="col-span-2 m-auto mt-8 grid grid-cols-[1fr_min-content_1fr] items-center">
			<PlayerConfigDisplay
				canStartGame={room.canStartGame}
				toggleReady={() => room.toggleReady()}
				player={room.player}
				color={playerColor()}
				cancelPieceSwap={() => room.declineOrCancelPieceSwap()}
			/>
			<span></span>
			<Show when={room.opponent} fallback={<OpponentPlaceholder color={opponentColor()} />}>
				<OpponentConfigDisplay
					opponent={room.opponent!}
					color={opponentColor()}
					agreePieceSwap={() => room.agreePieceSwap()}
					declinePieceSwap={() => room.declineOrCancelPieceSwap()}
				/>
			</Show>
			<PlayerColorDisplay color={playerColor()} />
			<SwapButton alreadySwapping={room.player.agreeColorSwap} initiatePieceSwap={() => room.initiatePieceSwap()} />
			<PlayerColorDisplay color={opponentColor()} />
		</div>
	)
}

function PlayerColorDisplay(props: { color: GL.Color }) {
	return (
		<div class="ml-auto mr-auto flex w-40 items-center justify-center">
			<img alt={`${props.color} king`} src={PC.resolvePieceImagePath({ type: 'king', color: props.color })} />
		</div>
	)
}

function SwapButton(props: { initiatePieceSwap: () => void; alreadySwapping: boolean }) {
	const requestSwap = () => {
		if (props.alreadySwapping) return
		props.initiatePieceSwap()
	}

	return (
		<div class="m-auto ml-auto mr-auto flex flex-col items-center justify-end">
			<div class="flex flex-col justify-center">
				<Game
					disabled={props.alreadySwapping}
					title="Swap Pieces"
					kind="tertiary"
					size="small"
					class="rounded-full bg-gray-800 p-1"
					onClick={requestSwap}
				>
					<SwapSvg />
				</Game>
			</div>
		</div>
	)
}

function PlayerConfigDisplay(props: {
	player: R.RoomParticipant
	color: GL.Color
	toggleReady: () => void
	cancelPieceSwap: () => void
	canStartGame: boolean
}) {
	const [tip, setTip] = createSignal<TIP.Instance | null>(null)
	let playerNameRef = null as unknown as HTMLSpanElement
	const cancelSwapModalContent = (
		<div class="space-x-1">
			<span class="text-xs">Asking Opponent for piece swap</span>
			<Game
				onclick={() => {
					tip()?.hide()
					props.cancelPieceSwap()
				}}
				size="small"
				kind="secondary"
			>
				Decline
			</Game>
		</div>
	) as HTMLDivElement

	onMount(() => {
		setTip(
			tippy(playerNameRef, {
				theme: 'material',
				allowHTML: true,
				content: cancelSwapModalContent,
				hideOnClick: false,
				placement: 'top',
				trigger: 'manual',
				interactive: true,
				showOnCreate: false,
				appendTo: document.body,
			})
		)
	})
	return (
		<PlayerDisplayContainer color={props.color}>
			<span ref={playerNameRef} class="whitespace-nowrap text-xs">
				{props.player.name} (You)
			</span>
			<Show when={!props.player.isReadyForGame}>
				<Game size="medium" kind="primary" onclick={() => props.toggleReady()}>
					{props.canStartGame ? 'Start Game!' : 'Ready Up!'}
				</Game>
			</Show>
			<Show when={props.player.isReadyForGame}>
				<span>Ready!</span>{' '}
				<Game kind={'secondary'} size="small" onClick={() => props.toggleReady()}>
					Unready
				</Game>
			</Show>
		</PlayerDisplayContainer>
	)
}

function OpponentConfigDisplay(props: {
	opponent: R.RoomParticipant
	color: GL.Color
	agreePieceSwap: () => void
	declinePieceSwap: () => void
}) {
	let ref = null as unknown as HTMLSpanElement
	const [tip, setTip] = createSignal<TIP.Instance | null>(null)

	const changeColorModalContent = (
		<div class="space-x-1">
			<span class="text-xs">{props.opponent.name} wants to swap colors</span>
			<Game
				onClick={() => {
					tip()?.hide()
					props.agreePieceSwap()
				}}
				size="small"
				kind="primary"
			>
				Accept
			</Game>
			<Game
				onclick={() => {
					tip()?.hide()
					props.declinePieceSwap()
				}}
				size="small"
				kind="secondary"
			>
				Decline
			</Game>
		</div>
	) as HTMLDivElement

	onMount(() => {
		setTip(
			tippy(ref, {
				theme: 'material',
				allowHTML: true,
				content: changeColorModalContent,
				hideOnClick: false,
				placement: 'top',
				trigger: 'manual',
				interactive: true,
				showOnCreate: false,
				appendTo: document.body,
			})
		)
	})

	onCleanup(() => {
		tip()?.hide()
	})

	createEffect(() => {
		const _tip = tip()
		if (!_tip) {
		} else if (props.opponent.agreeColorSwap) _tip.show()
		else _tip.hide()
	})

	return (
		<PlayerDisplayContainer color={props.color}>
			<span ref={ref}>{props.opponent.name}</span>
			<Show when={props.opponent.isReadyForGame} fallback={<div>Not Ready</div>}>
				<div>Ready</div>
			</Show>
		</PlayerDisplayContainer>
	)
}

function PlayerDisplayContainer(props: ParentProps<{ color: GL.Color }>) {
	return (
		<div class="ml-auto mr-auto flex h-min w-40 flex-col items-center">
			<div class="2 flex flex-col items-center justify-center rounded border-solid border-gray-700 text-center">{props.children}</div>
		</div>
	)
}

function OpponentPlaceholder(props: { color: GL.Color }) {
	return <PlayerDisplayContainer color={props.color}>Waiting for Opponent...</PlayerDisplayContainer>
}

export function NickForm() {
	const [displayName, setDisplayName] = createSignal<string>('')
	const [initialized, setInitialized] = createSignal(false)
	onMount(async () => {
		await until(() => P.playerId())
		setDisplayName(P.playerName() || '')
		setInitialized(true)
	})
	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		P.setPlayerName(displayName())
	}

	return (
		<CenterPanel>
			<form onSubmit={onSubmit}>
				<div>Set your Display Name</div>
				<input
					type="text"
					class="bg-gray-800 p-1 text-white"
					value={displayName()}
					disabled={!initialized()}
					required={true}
					pattern={'[a-zA-Z0-9]+'}
					onInput={(e) => setDisplayName(e.target.value.trim())}
				/>
				<input type="submit" value="Submit" />
			</form>
		</CenterPanel>
	)
}
