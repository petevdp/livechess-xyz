import { until } from '@solid-primitives/promise'
import { useNavigate, useParams } from '@solidjs/router'
import { Match, Show, Switch, createEffect, createSignal, getOwner } from 'solid-js'
import toast from 'solid-toast'

import { Spinner } from '~/components/Spinner.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import { Checkbox } from '~/components/ui/checkbox.tsx'
import { Input } from '~/components/ui/input.tsx'
import { Label } from '~/components/ui/label.tsx'
import * as P from '~/systems/player.ts'
import * as R from '~/systems/room.ts'

import { AppContainer, ScreenFittingContent } from './AppContainer.tsx'
import { Room } from './Room.tsx'


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
	const [playerFormState, setPlayerFormState] = createSignal<PlayerFormState>({
		state: 'hidden',
	})

	async function initPlayer(numPlayers: number): Promise<{ player: P.Player; isSpectating: boolean }> {
		setPlayerFormState({
			state: 'visible',
			props: {
				numPlayers,
				submitPlayer: (name, isSpectating) => {
					setPlayerFormState({
						state: 'submitted',
						payload: { name, isSpectating },
					})
				},
			},
		})
		await until(() => playerFormState().state === 'submitted' && !!P.playerId())
		const state = playerFormState()!
		if (state.state === 'submitted') {
			const player = { id: P.playerId()!, name: state.payload.name }
			return { player, isSpectating: state.payload.isSpectating }
		}
		// impossible
		throw new Error('player form state is not submitted')
	}

	createEffect(() => {
		if ((!R.room() || R.room()!.roomId !== params.id) && P.playerId()) {
			setConnectionStatus('connecting')
			console.log('connecting to room', params.id)
			R.connectToRoom(params.id, P.playerId()!, initPlayer, owner, () => {
				toast('connection aborted, please try again')
				navigate('/')
			})
				.catch(() => {
					setConnectionStatus('disconnected')
					toast('connection failed, please try again')
					navigate('/')
				})
				.then(() => {
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
					<ScreenFittingContent class="grid place-items-center">
						<Spinner/>
					</ScreenFittingContent>
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
	const [displayName, setDisplayName] = createSignal<string>(P.settings.name || '')
	const [isSpectating, setIsSpectating] = createSignal(props.numPlayers >= 2)
	const [submitted, setSubmitted] = createSignal(false)
	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		if (submitted()) return
		setSubmitted(true)
		P.setSettings({ name: displayName().trim() })
		props.submitPlayer(displayName(), props.numPlayers >= 2 || isSpectating())
	}

	createEffect(() => {
		if (P.settings.name) setDisplayName(P.settings.name)
	})

	return (
		<ScreenFittingContent class="grid place-items-center p-2">
			<Card>
				<CardHeader>
					<CardTitle class="text-center">Set your Display Name</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={onSubmit} class="flex flex-col space-y-3">
						<Input
							type="text"
							value={displayName()}
							disabled={submitted()}
							required={true}
							pattern={'[a-zA-Z0-9 ]+'}
							onchange={(e) => setDisplayName(e.target.value.trim())}
						/>
						<div class="flex justify-between space-x-3">
							<Show when={props.numPlayers < 2}>
								<div class="flex items-center space-x-1">
									<Checkbox
										class="space-x-0"
										id="spectating-checkbox"
										checked={isSpectating()}
										onChange={() => setIsSpectating((is) => !is)}
									/>
									<Label for="spectating-checkbox-input">Spectate</Label>
								</div>
							</Show>
							<Button class="flex-1" type="submit" value="Submit">
								Join
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</ScreenFittingContent>
	)
}
