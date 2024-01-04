import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js'
import * as P from '../systems/player.ts'
import { useNavigate, useParams } from '@solidjs/router'
import { ConnectionStatus } from '../utils/yjs.ts'
import { Board } from './Board.tsx'
import { AppContainer } from './AppContainer.tsx'
import { Choice, MultiChoiceButton } from '../MultiChoiceButton.tsx'
import * as G from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import * as R from '../systems/room.ts'
import { Button } from './Button.tsx'
import { until } from '@solid-primitives/promise'

export function RoomGuard() {
	const params = useParams()
	const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>(R.room() ? 'connected' : 'disconnected')
	const navigate = useNavigate()

	createEffect(async () => {
		if ((!R.room() || R.room()!.roomId !== params.id) && P.playerId() && P.playerName()) {
			setConnectionStatus('connecting')
			console.log('connecting to room', params.id)
			const room = await R.connectToRoom(params.id, { id: P.playerId()!, name: P.playerName()! }, () => navigate('/'))
			R.setRoom(room)
			setConnectionStatus('connected')
		}
	})

	createEffect(() => {
		console.log('connection status', connectionStatus())
	})

	onCleanup(() => {
		R.room()?.destroy()
	})

	return (
		<AppContainer>
			<div class="grid h-[calc(100vh_-_4rem)] place-items-center">
				<div class="rounded bg-gray-900 p-[.5rem]">
					<Switch>
						<Match when={!P.playerName()}>
							<NickForm />
						</Match>
						<Match when={!R.room() || connectionStatus() === 'connecting'}>
							<div>loading...</div>
						</Match>
						<Match when={connectionStatus() === 'disconnected'}>
							<div>disconnected</div>
						</Match>
						<Match when={connectionStatus() === 'connected'}>
							<Room />
						</Match>
					</Switch>
				</div>
			</div>
		</AppContainer>
	)
}

function Room() {
	const room = R.room()
	if (!room) throw new Error('room is not initialized')

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
		<div class="grid grid-cols-[60%_auto] gap-2">
			<GameConfigForm />
			<div class="row-span-2">
				<ChatBox />
			</div>
			<div class="col-span-1 flex w-full justify-center">
				<Button kind="primary" class="whitespace-nowrap" onclick={copyInviteLink}>
					Copy Invite Link
				</Button>
				<Show when={room!.sharedStore.isLeader()}>
					<Button
						kind="primary"
						disabled={!room.canStartGame}
						class="ml-1 w-full rounded"
						onClick={async () => {
							// change this to a "set ready" pattern
							if (!room.canStartGame) return
							room.startGame()
						}}
					>
						{!room.canStartGame ? '(Waiting for opponent to connect...)' : 'Start'}
					</Button>
				</Show>
			</div>
		</div>
	)
}

function GameConfigForm() {
	const room = R.room()
	if (!room) throw new Error('room is not initialized')
	const gameConfig = () => room!.rollbackState.gameConfig

	return (
		<div>
			<div class="grid grid-cols-2 grid-rows-[min-content_auto_min-content] gap-3 ">
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
			</div>
		</div>
	)
}

function ChatBox() {
	const room = R.room()
	if (!room) throw new Error('room is not initialized')
	const messages = () => room!.chatMessages
	const [message, setMessage] = createSignal('')
	const sendMessage = (e: SubmitEvent) => {
		e.preventDefault()
		const _message = message().trim()
		if (!_message) return
		room!.sendMessage(_message.trim(), false)
		setMessage('')
	}

	let chatFeed: HTMLDivElement = null as unknown as HTMLDivElement
	createEffect(
		on(messages, () => {
			chatFeed.scrollTop = chatFeed.scrollHeight
		})
	)

	return (
		<div class="flex h-full flex-col">
			<div ref={chatFeed} class="mb-2 flex h-48 grow flex-col overflow-y-scroll">
				<For each={messages()}>{(message) => <ChatMessage message={message} />}</For>
			</div>
			<form onSubmit={sendMessage} class="flex h-9 w-full">
				<input
					class="mr-1 w-max grow rounded border-[1px] border-solid border-gray-300 bg-inherit p-1"
					type="text"
					value={message()}
					onInput={(e) => setMessage(e.target.value)}
				/>
				<Button kind="primary" type="submit">
					Send
				</Button>
			</form>
		</div>
	)
}

function ChatMessage(props: { message: R.ChatMessage }) {
	return (
		<div>
			<Show when={props.message.sender && props.message.type === 'player'}>
				<b>{props.message.sender}:</b>{' '}
			</Show>
			<Switch>
				<Match when={props.message.sender}>{props.message.text}</Match>
				<Match when={props.message.type === 'system'}>
					<i>{props.message.text}</i>
				</Match>
			</Switch>
		</div>
	)
}

function NickForm() {
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
	)
}
