import { useNavigate, useParams } from '@solidjs/router'
import { createEffect, createSignal, getOwner, Match, Switch } from 'solid-js'
import * as R from '../systems/room.ts'
import * as P from '../systems/player.ts'
import { AppContainer } from './AppContainer.tsx'
import { NickForm, Room } from './Room.tsx'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'
export function RoomGuard() {
	const params = useParams()
	const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>(R.room() ? 'connected' : 'disconnected')
	const navigate = useNavigate()
	const owner = getOwner()!

	createEffect(() => {
		if ((!R.room() || R.room()!.roomId !== params.id) && P.playerId() && P.playerName()) {
			setConnectionStatus('connecting')
			console.log('connecting to room', params.id)
			// TODO need some sort of retry mechanism here
			R.connectToRoom(params.id, { id: P.playerId()!, name: P.playerName()! }, owner, () => navigate('/')).then(() => {
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
