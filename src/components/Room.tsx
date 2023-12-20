import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js'
import * as Y from 'yjs'
import * as P from '../systems/player.ts'
import { useParams } from '@solidjs/router'
import * as R from '../systems/room.ts'
import { yArrayToStore, yMapToSignal, yMapToStore } from '../utils/yjs.ts'
import { Board } from './Board.tsx'
import { AppContainer } from './AppContainer.tsx'
import { Choice, MultiChoiceButton } from '../MultiChoiceButton.tsx'
import * as G from '../systems/game/game.ts'
import { unwrap } from 'solid-js/store'
import { Button } from './Button.tsx'

export function RoomGuard() {
	const params = useParams()
	const [connectionStatus, connect] = R.useRoomConnection(params.id)
	const [roomStatus, setRoomStatus] = createSignal<R.RoomStatus>('pregame')

	createEffect(() => {
		if (P.player().name) {
			connect()
		}
	})

	return (
		<AppContainer>
			<div class="grid h-[calc(100vh_-_4rem)] place-items-center">
				<div class="rounded bg-gray-900 p-2">
					<Switch>
						<Match when={!P.player().name}>
							<NickForm />
						</Match>
						<Match when={connectionStatus() === 'connecting'}>
							<div>loading...</div>
						</Match>
						<Match when={connectionStatus() === 'disconnected'}>
							<div>disconnected</div>
						</Match>
						<Match when={R.room()}>
							<Room />
						</Match>
					</Switch>
				</div>
			</div>
		</AppContainer>
	)
}

function Room() {
	G.setupGame()
	const [roomStatus] = yMapToSignal<R.RoomStatus>(
		R.room()!.details,
		'status',
		'pregame'
	)
	return (
		<Switch>
			<Match when={roomStatus() === 'pregame' && P.player().name != null}>
				<Lobby />
			</Match>
			<Match when={roomStatus() === 'in-progress'}>
				<Board />
			</Match>
			<Match when={roomStatus() === 'postgame'}>
				<div>Game over</div>
			</Match>
			<Match when={true}>
				<div>idk</div>
			</Match>
		</Switch>
	)
}

function Lobby() {
	const copyInviteLink = () => {
		navigator.clipboard.writeText(window.location.href)
	}
	const [host] = yMapToSignal<string>(R.room()!.details, 'host', P.player().id)
	const [players] = yMapToStore(R.room()!.players)
	createEffect(() => {
		console.table(unwrap(players.map((e) => e[1])))
	})
	const canStart = () => players.length >= 2
	return (
		<div class="grid grid-cols-[60%_auto] gap-2">
			<div class="col-span-full grid place-items-center">
				<Button kind="primary" onclick={copyInviteLink}>
					Copy Invite Link
				</Button>
			</div>
			<GameConfigForm />
			<div class="row-span-2">
				<ChatBox />
			</div>
			<Show when={host() === P.player().id}>
				<div class="col-span-1 flex w-full justify-center">
					<Button
						kind="primary"
						disabled={!canStart()}
						class="w-1/2 rounded"
						onClick={R.startGame}
					>
						Start
					</Button>
				</div>
			</Show>
		</div>
	)
}

function GameConfigForm() {
	const [variant] = yMapToSignal<G.Variant>(
		R.room()!.gameConfig as Y.Map<G.Variant>,
		'variant',
		'regular'
	)
	const [timeControl] = yMapToSignal<G.TimeControl>(
		R.room()!.gameConfig as Y.Map<G.TimeControl>,
		'timeControl',
		'5m'
	)
	const [increment] = yMapToSignal<G.Increment>(
		R.room()!.gameConfig as Y.Map<G.Increment>,
		'increment',
		'0'
	)
	const setConfigValue = (key: string) => (value: string) => {
		R.room()!.gameConfig!.set(key, value)
	}

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
					choices={G.VARIANTS.map(
						(c) => ({ label: c, id: c }) satisfies Choice<G.Variant>
					)}
					selected={variant() || 'regular'}
					onChange={setConfigValue('variant')}
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
					choices={G.TIME_CONTROLS.map(
						(tc) => ({ label: tc, id: tc }) satisfies Choice<G.TimeControl>
					)}
					selected={timeControl()}
					onChange={setConfigValue('timeControl')}
				/>
				<MultiChoiceButton
					label="Increment"
					classList={{
						grid: true,
						'grid-rows-1': true,
						'grid-cols-4': true,
						'text-sm': true,
					}}
					choices={G.INCREMENTS.map(
						(i) => ({ label: `${i}s`, id: i }) satisfies Choice<G.Increment>
					)}
					selected={increment()}
					onChange={setConfigValue('increment')}
				/>
			</div>
		</div>
	)
}

function ChatBox() {
	const messages = yArrayToStore<R.ChatMessage>(R.room()!.chat)
	const [message, setMessage] = createSignal('')
	const sendMessage = (e: SubmitEvent) => {
		e.preventDefault()
		R.sendMessage(message(), false)
		setMessage('')
	}
	let messagesRendered = 0
	let chatFeed: HTMLDivElement = null as unknown as HTMLDivElement
	createEffect(() => {
		if (messages.length > messagesRendered) {
			chatFeed.scrollTop = chatFeed.scrollHeight
			messagesRendered = message.length
		}
	})

	return (
		<div class="flex h-full flex-col">
			<div
				ref={chatFeed}
				class="mb-2 flex h-48 grow flex-col overflow-y-scroll"
			>
				<For each={messages}>
					{(message) => <ChatMessage message={message} />}
				</For>
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
			<Show when={props.message.sender}>
				<b>{props.message.sender}:</b>{' '}
			</Show>
			<Switch>
				<Match when={props.message.sender}>{props.message.text}</Match>
				<Match when={!props.message.sender}>
					<i>{props.message.text}</i>
				</Match>
			</Switch>
		</div>
	)
}

function NickForm() {
	const [displayName, setDisplayName] = createSignal<string>(
		P.player().name || ''
	)
	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		P.setPlayer({ ...P.player(), name: displayName() })
	}
	return (
		<form onSubmit={onSubmit}>
			<div>Set your Display Name</div>
			<input
				type="text"
				class="bg-gray-800 p-1 text-white"
				value={displayName()}
				required={true}
				pattern={'[a-zA-Z0-9]+'}
				onInput={(e) => setDisplayName(e.target.value.trim())}
			/>
			<input type="submit" value="Submit" />
		</form>
	)
}
