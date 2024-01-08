import { useNavigate, useParams } from '@solidjs/router'
import { createEffect, createSignal, Match, onCleanup, Switch } from 'solid-js'
import * as R from '../systems/room.ts'
import * as P from '../systems/player.ts'
import { AppContainer } from './AppContainer.tsx'
import { NickForm, Room } from './Room.tsx'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'
export function RoomGuard() {
	const params = useParams()
	const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>(R.room() ? 'connected' : 'disconnected')
	const navigate = useNavigate()

	createEffect(() => {
		if ((!R.room() || R.room()!.roomId !== params.id) && P.playerId() && P.playerName()) {
			setConnectionStatus('connecting')
			console.log('connecting to room', params.id)
			R.room()?.destroy()
			// TODO need some sort of retry mechanism here
			R.connectToRoom(params.id, { id: P.playerId()!, name: P.playerName()! }, () => navigate('/')).then((room) => {
				R.setRoom(room)
				setConnectionStatus('connected')
			})
		}
	})

	createEffect(() => {
		console.log('connection status', connectionStatus())
	})

	onCleanup(() => {
		R.room()?.destroy()
		R.setRoom(null)
	})

	return (
		<AppContainer>
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
		</AppContainer>
	)
}
