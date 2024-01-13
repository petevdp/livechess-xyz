import { useNavigate, useParams } from '@solidjs/router'
import { createEffect, createSignal, getOwner, Match, onMount, Show, Switch } from 'solid-js'
import * as R from '~/systems/room.ts'
import * as P from '~/systems/player.ts'
import { AppContainer, ScreenFittingContent } from './AppContainer.tsx'
import { Room } from './Room.tsx'
import { until } from '@solid-primitives/promise'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import { Input } from '~/components/ui/input.tsx'
import { Checkbox } from '~/components/ui/checkbox.tsx'
import { Label } from '~/components/ui/label.tsx'
import { Button } from '~/components/ui/button.tsx'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'
type PlayerFormState =
	| { state: 'hidden' }
	| { state: 'visible'; props: PlayerFormProps }
	| {
			state: 'submitted'
			payload: { name: string; isSpectating: boolean }
	  }

export function RoomGuard() {
	const params = useParams()
	const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>(R.room() ? 'connected' : 'disconnected')
	const navigate = useNavigate()
	const owner = getOwner()!
	const [playerFormState, setPlayerFormState] = createSignal<PlayerFormState>({ state: 'hidden' })

	async function initPlayer(numPlayers: number): Promise<{player: P.Player; isSpectating: boolean}> {
		setPlayerFormState({
			state: 'visible',
			props: {
				numPlayers,
				submitPlayer: (name, isSpectating) => {
					setPlayerFormState({ state: 'submitted', payload: { name, isSpectating } })
				},
			},
		})
		await until(() => playerFormState().state === 'submitted' && !!P.playerId())
		const state = playerFormState()!
		if (state.state === 'submitted') {
			const player =  { id: P.playerId()!, name: state.payload.name }
			return {player, isSpectating: state.payload.isSpectating}
		}
		// impossible
		throw new Error('player form state is not submitted')
	}

	createEffect(() => {
		if ((!R.room() || R.room()!.roomId !== params.id) && P.playerId()) {
			setConnectionStatus('connecting')
			console.log('connecting to room', params.id)
			// TODO need some sort of retry mechanism here
			R.connectToRoom(params.id, P.playerId()!, initPlayer, owner, () => navigate('/')).then(() => {
				setConnectionStatus('connected')
			})
		}
	})

	createEffect(() => {
		console.log('connection status', connectionStatus())
	})

	return (
		<AppContainer>
			<Switch>
				<Match when={playerFormState().state === 'visible'}>
					{/* @ts-ignore fuck it */}
					<PlayerForm {...playerFormState().props} />
				</Match>
				<Match when={!R.room() || connectionStatus() === 'connecting'}>
					{/* TODO add spinner */}
					<div>loading...</div>
				</Match>
				<Match when={connectionStatus() === 'disconnected'}>
					<div>disconnected</div>
				</Match>
				<Match when={connectionStatus() === 'connected'}>
					<Room />
				</Match>
			</Switch>
		</AppContainer>
	)
}

type PlayerFormProps = {
	numPlayers: number
	submitPlayer: (name: string, isSpectating: boolean) => void
}

export function PlayerForm(props: PlayerFormProps) {
	const [displayName, setDisplayName] = createSignal<string>(P.playerName() || '')
	const [isSpectating, setIsSpectating] = createSignal(props.numPlayers >= 2)
	const [submitted, setSubmitted] = createSignal(false)
	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		if (submitted()) return
		setSubmitted(true)
		P.setPlayerName(displayName())
		props.submitPlayer(displayName(), props.numPlayers >= 2 || isSpectating())
	}

	return (
		<ScreenFittingContent class="grid place-items-center p-2">
			<Card>
				<CardHeader>
					<CardTitle class="text-center">Set your Display Name</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={onSubmit} class="flex flex-col space-y-1">
						<Input
							type="text"
							value={displayName()}
							disabled={submitted()}
							required={true}
							pattern={'[a-zA-Z0-9 ]+'}
							onchange={(e) => setDisplayName(e.target.value.trim())}
						/>
						<Show when={props.numPlayers < 2}>
							<div class="flex space-x-1">
								<Checkbox id="spectating-checkbox" checked={isSpectating()} onChange={() => setIsSpectating((is) => !is)} />
								<Label for="spectating-checkbox">Spectate</Label>
							</div>
						</Show>

						<Button type="submit" value="Submit">
							Submit
						</Button>
					</form>
				</CardContent>
			</Card>
		</ScreenFittingContent>
	)
}
