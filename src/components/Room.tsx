import {
	createEffect,
	createSignal,
	For,
	from,
	Match,
	on,
	onMount,
	Show,
	Switch,
} from 'solid-js'
import * as P from '../systems/player.ts'
import { useParams } from '@solidjs/router'
import * as R from '../systems/room.ts'
import { ConnectionStatus } from '../utils/yjs.ts'
import { Board } from './Board.tsx'
import { AppContainer } from './AppContainer.tsx'
import { Choice, MultiChoiceButton } from '../MultiChoiceButton.tsx'
import * as G from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import { Increment } from '../systems/game/gameLogic.ts'
import { Button } from './Button.tsx'
import { scan, Subscription } from 'rxjs'
import { until } from '@solid-primitives/promise'

export function RoomGuard() {
	const params = useParams()

	const [connectionStatus, setConnectionStatus] =
		createSignal<ConnectionStatus>('disconnected')
	let sub = new Subscription()
	createEffect(() => {
		if (!R.room() || R.room()!.roomId !== params.id) {
			R.connectToRoom(params.id).then((status) => {
				if (status === 'disconnected') {
					alert('Failed to connect to room')
					return
				}
			})
		}

		if (R.room()) {
			sub.add(
				R.room()!.yClient.connectionStatus$.subscribe(setConnectionStatus)
			)
			setConnectionStatus(R.room()!.yClient.connectionStatus)
		} else {
			sub.unsubscribe()
			sub = new Subscription()
		}
	})

	return (
		<AppContainer>
			<div class="grid h-[calc(100vh_-_4rem)] place-items-center">
				<div class="rounded bg-gray-900 p-2">
					<Switch>
						<Match when={!P.player()?.name}>
							<NickForm />
						</Match>
						<Match when={!R.room() || connectionStatus() === 'connecting'}>
							<div>loading...</div>
						</Match>
						<Match when={connectionStatus() === 'disconnected'}>
							<div>disconnected</div>
						</Match>
						<Match when={connectionStatus() === 'connected' && R.room()!}>
							<Room />
						</Match>
					</Switch>
				</div>
			</div>
		</AppContainer>
	)
}

function Room() {
	const roomStatus = from(R.room()!.observeRoomStatus())

	return (
		<Switch>
			<Match when={roomStatus() === 'pregame' && P.player()!.name != null}>
				<Lobby />
			</Match>
			<Match when={!G.game() && roomStatus() === 'in-progress'}>
				// TODO: fix whatever this is
				<div>IDK</div>
			</Match>
			<Match
				when={
					G.game() &&
					(roomStatus() === 'in-progress' || roomStatus() === 'postgame')
				}
			>
				<Board game={G.game()!} />
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

	const host = from(R.room()!.observeHost())
	const canStart = from(R.room()!.observeCanStart())
	return (
		<div class="grid grid-cols-[60%_auto] gap-2">
			<GameConfigForm />
			<div class="row-span-2">
				<ChatBox />
			</div>
			<div class="col-span-1 flex w-full justify-center">
				<Button
					kind="primary"
					class="whitespace-nowrap"
					onclick={copyInviteLink}
				>
					Copy Invite Link
				</Button>
				<Show when={P.player() && host() && host()!.id === P.player()!.id}>
					<Button
						kind="primary"
						disabled={!canStart()}
						class="ml-1 w-full rounded"
						onClick={async () => {
							const players = await R.room()!.players

							const playerColors = {
								[players[0].id]: 'white',
								[players[1].id]: 'black',
							} as const

							await R.room()!.dispatchRoomAction({
								type: 'new-game',
								playerColors,
								gameConfig: await R.room()!.gameConfig(),
							})
						}}
					>
						{!canStart() ? '(Waiting for opponent to connect...)' : 'Start'}
					</Button>
				</Show>
			</div>
		</div>
	)
}

function GameConfigForm() {
	const gameConfig = from(R.room()!.yClient.observeValue('gameConfig', true))

	const variant = () => gameConfig()?.variant || 'regular'
	const timeControl = () => gameConfig()?.timeControl || '5m'
	const increment = () => gameConfig()?.increment || '0'

	const updateGameConfig = (config: Partial<GL.GameConfig>) => {
		R.room()!.yClient.setValue('gameConfig', { ...gameConfig()!, ...config })
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
					choices={GL.VARIANTS.map(
						(c) => ({ label: c, id: c }) satisfies Choice<GL.Variant>
					)}
					selected={variant() || 'regular'}
					onChange={(v) => updateGameConfig({ variant: v })}
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
					choices={GL.TIME_CONTROLS.map(
						(tc) => ({ label: tc, id: tc }) satisfies Choice<GL.TimeControl>
					)}
					selected={timeControl()}
					onChange={(v) => updateGameConfig({ timeControl: v })}
				/>
				<MultiChoiceButton
					label="Increment"
					classList={{
						grid: true,
						'grid-rows-1': true,
						'grid-cols-4': true,
						'text-sm': true,
					}}
					choices={GL.INCREMENTS.map(
						(i) => ({ label: `${i}s`, id: i }) satisfies Choice<Increment>
					)}
					selected={increment()}
					onChange={(v) => updateGameConfig({ increment: v })}
				/>
			</div>
		</div>
	)
}

function ChatBox() {
	// individual messages are not mutated
	const messages = from(
		R.room()!
			.yClient.observeEvent('chatMessage', true)
			.pipe(scan((acc, m) => [...acc, m], [] as R.ChatMessage[]))
	)
	const [message, setMessage] = createSignal('')
	const sendMessage = (e: SubmitEvent) => {
		e.preventDefault()
		const _message = message().trim()
		if (!_message) return
		R.room()!.sendMessage(_message.trim(), false)
		setMessage('')
	}

	let chatFeed: HTMLDivElement = null as unknown as HTMLDivElement
	createEffect(
		on(messages, (messages) => {
			console.log({ messages })
			chatFeed.scrollTop = chatFeed.scrollHeight
		})
	)

	return (
		<div class="flex h-full flex-col">
			<div
				ref={chatFeed}
				class="mb-2 flex h-48 grow flex-col overflow-y-scroll"
			>
				<For each={messages()}>
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
		await until(() => P.player() != null)
		setDisplayName(P.player()!.name || '')
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
