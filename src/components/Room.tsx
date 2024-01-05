import { createEffect, createSignal, Match, onCleanup, onMount, ParentProps, Show, Switch } from 'solid-js'
import toast from 'solid-toast'
import * as PC from '../systems/piece.ts'
import * as P from '../systems/player.ts'
import { Board } from './Board.tsx'
import { Choice, MultiChoiceButton } from '../MultiChoiceButton.tsx'
import * as G from '../systems/game/game.ts'
import { setupGameSystem } from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import * as R from '../systems/room.ts'
import { tippy } from '../utils/tippy.tsx'
import { Button } from './Button.tsx'
import { until } from '@solid-primitives/promise'
import SwapSvg from '../assets/icons/swap.svg'
import * as TIP from 'tippy.js'
import { createIdSync } from '../utils/ids.ts'

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
	setupGameSystem()

	return (
		<Switch>
			<Match when={room.state.status === 'pregame'}>
				<Lobby />
			</Match>
			<Match when={['playing', 'postgame'].includes(room.state.status) && G.game() && !G.game()!.destroyed}>
				<Board />
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
					<Button size="medium" kind="primary" class="whitespace-nowrap" onclick={copyInviteLink}>
						Copy Invite Link
					</Button>
					<Button kind="primary" size="medium">
						Share
					</Button>
					<Button kind="primary" size="medium">
						Show QR Code
					</Button>
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
			case 'cancel-piece-swap':
				if (action.origin.id === room.player.id) {
					toast('Cancelled piece swap')
				} else {
					toast(`Opponent cancelled piece swap`)
				}
				break
			case 'prompt-piece-swap':
				if (action.origin.id === room.opponent.id) {
					toast(`${room.opponent.name} wants to swap pieces`)
				} else {
					toast('Waiting for opponent to accept piece swap')
				}
		}
	})

	onCleanup(() => {
		sub.unsubscribe()
	})

	return (
		<div class="col-span-2 m-auto grid grid-cols-[1fr_min-content_1fr] items-center">
			<PlayerConfigDisplay toggleReady={() => room.toggleReady()} player={room.player} color={playerColor()} />
			<span></span>
			<Show when={room.opponent} fallback={<OpponentPlaceholder color={opponentColor()} />}>
				<OpponentConfigDisplay opponent={room.opponent} color={opponentColor()} confirmColorSwap={() => room.agreeColorSwap()} />
			</Show>
			<PlayerColorDisplay color={playerColor()} />
			<SwapButton alreadySwapping={room.player.agreeColorSwap} swapPlayer={() => room.agreeColorSwap()} />
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

function SwapButton(props: { swapPlayer: () => void; alreadySwapping: boolean }) {
	const requestSwap = () => {
		if (props.alreadySwapping) return
		props.swapPlayer()
	}

	return (
		<div class="m-auto ml-auto mr-auto flex flex-col items-center justify-end">
			<div class="flex flex-col justify-center">
				<Button
					disabled={props.alreadySwapping}
					title="Swap Pieces"
					kind="tertiary"
					size="small"
					class="rounded-full bg-gray-800 p-1"
					onClick={requestSwap}
				>
					<SwapSvg />
				</Button>
			</div>
		</div>
	)
}

function PlayerConfigDisplay(props: { player: R.RoomParticipant; color: GL.Color; toggleReady: () => void }) {
	return (
		<PlayerDisplayContainer color={props.color}>
			<span class="whitespace-nowrap text-xs">{props.player.name} (You)</span>
			<Show when={!props.player.isReadyForGame}>
				<Button size="medium" kind="primary" onclick={() => props.toggleReady()}>
					Ready Up!
				</Button>
			</Show>
			<Show when={props.player.isReadyForGame}>
				<span>Ready!</span>{' '}
				<Button kind={'secondary'} size="small" onClick={() => props.toggleReady()}>
					Unready
				</Button>
			</Show>
		</PlayerDisplayContainer>
	)
}

function OpponentConfigDisplay(props: { opponent: R.RoomParticipant; color: GL.Color; confirmColorSwap: () => void }) {
	let ref = null as unknown as HTMLSpanElement
	const [tip, setTip] = createSignal<TIP.Instance | null>(null)

	onMount(() => {
		const buttonId = createIdSync(4)

		const modalContent = (
			<div class="space-x-1">
				<span class="text-xs">{props.opponent.name} wants to swap colors</span>
				<Button id={buttonId} onClick={props.confirmColorSwap} size="small" kind="primary">
					Accept
				</Button>
			</div>
		) as HTMLDivElement

		async function clickListener() {
			await props.confirmColorSwap()
			tip()!.hide()
		}

		const runOnCleanup: (() => void)[] = []
		onCleanup(() => {
			runOnCleanup.forEach((f) => f())
		})

		setTip(
			tippy(ref, {
				theme: 'material',
				allowHTML: true,
				content: modalContent.innerHTML,
				hideOnClick: false,
				placement: props.color === 'white' ? 'left' : 'right',
				trigger: 'manual',
				interactive: true,
				showOnCreate: false,
				appendTo: document.body,
				onShown: () => {
					const button = document.getElementById(buttonId) as HTMLButtonElement
					console.log('adding event listener')
					button.addEventListener('click', clickListener)
					runOnCleanup.push(() => button.removeEventListener('click', clickListener))
				},
			})
		)
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
