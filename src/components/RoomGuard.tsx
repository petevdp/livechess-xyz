import { until } from '@solid-primitives/promise'
import { useNavigate, useParams } from '@solidjs/router'
import { Subscription } from 'rxjs'
import { Match, Resource, Show, Switch, createEffect, createResource, createSignal, getOwner, onCleanup } from 'solid-js'

import * as Api from '~/api.ts'
import adjectives from '~/assets/names_dictionary/adjectives.ts'
import animals from '~/assets/names_dictionary/animals.ts'
import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import { Checkbox } from '~/components/ui/checkbox.tsx'
import { Input } from '~/components/ui/input.tsx'
import { Label } from '~/components/ui/label.tsx'
import * as Errors from '~/systems/errors.ts'
import * as GlobalLoading from '~/systems/globalLoading.ts'
import * as Pieces from '~/systems/piece.tsx'
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

export default function RoomGuard() {
	P.setupPlayerSystem()
	Pieces.setupPieceSystem()
	const params = useParams()
	const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>(R.room() ? 'connected' : 'disconnected')
	const navigate = useNavigate()
	const owner = getOwner()!
	const [playerFormState, setPlayerFormState] = createSignal<PlayerFormState>({
		state: 'hidden',
	})

	let networkExists: Resource<boolean>
	if (params.createdRoom) {
		// remove param from url
		navigate('/rooms/' + params.id, { replace: true })
		;[networkExists] = createResource(() => Promise.resolve(true))
	} else {
		;[networkExists] = createResource(() => Api.checkNetworkExists(params.id))
	}

	createEffect(() => {
		if (networkExists() === false) {
			navigate('/404')
		}
	})

	async function initPlayer(numPlayers: number): Promise<{ player: P.Player; isSpectating: boolean }> {
		GlobalLoading.unsetLoading('connect-to-room')
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

	//#region connect to room, handle connection status

	let connectionSub: Subscription | null = null
	createEffect(() => {
		if ((!R.room() || R.room()!.roomId !== params.id) && P.playerId() && networkExists()) {
			setConnectionStatus('connecting')
			console.debug('connecting to room', params.id)

			connectionSub = R.connectToRoom(params.id, P.playerId()!, initPlayer, owner).subscribe((state) => {
				switch (state.status) {
					case 'connecting':
						setConnectionStatus('connecting')
						break
					case 'connected':
						setConnectionStatus('connected')
						GlobalLoading.unsetLoading('connect-to-room')
						break
					case 'lost':
						setConnectionStatus('disconnected')

						GlobalLoading.unsetLoading('connect-to-room')
						Errors.pushFatalError('Connection Lost', `Connection to room ${params.id} lost.`)
						navigate('/')
						break
					case 'timeout':
						setConnectionStatus('disconnected')
						GlobalLoading.unsetLoading('connect-to-room')
						Errors.pushFatalError('Timed Out', `Connection to room ${params.id} timed out.`)
						navigate('/')
						break
				}
			})
		}
	})

	onCleanup(() => {
		connectionSub?.unsubscribe()
	})
	//#endregion

	createEffect(() => {
		console.debug('connection status:', connectionStatus())
	})

	return (
		<AppContainer>
			<Switch>
				<Match when={playerFormState().state === 'visible'}>
					{/* @ts-expect-error fuck it */}
					<PlayerForm {...playerFormState().props} />
				</Match>
				<Match when={!R.room() || connectionStatus() === 'connecting'}>{null}</Match>
				<Match when={connectionStatus() === 'disconnected'}>
					<div>disconnected</div>
				</Match>
				<Match when={connectionStatus() === 'connected' && R.room()}>
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
	const [displayName, setDisplayName] = createSignal<string>(P.settings.name || genName())
	const [isSpectating, setIsSpectating] = createSignal(props.numPlayers >= 2)
	const [submitted, setSubmitted] = createSignal(false)
	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		if (submitted()) return
		setSubmitted(true)
		P.settings.name = displayName().trim()
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
							autofocus
							type="text"
							value={displayName()}
							disabled={submitted()}
							required={true}
							pattern={'[a-zA-Z0-9 ]+'}
							oninput={(e) => setDisplayName(e.target.value.trim())}
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

// @ts-expect-error
window.genName = genName

function genName() {
	let adj = adjectives[Math.floor(Math.random() * adjectives.length)]
	let animal = animals[Math.floor(Math.random() * animals.length)]
	adj = adj.charAt(0).toUpperCase() + adj.slice(1)
	animal = animal.charAt(0).toUpperCase() + animal.slice(1)
	return `${adj}${animal}`
}
