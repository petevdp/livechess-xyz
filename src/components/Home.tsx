import { AppContainer } from './AppContainer.tsx'
import * as R from '../systems/room.ts'
import { useNavigate } from '@solidjs/router'
import { Button } from './Button.tsx'

export function Home() {
	const navigate = useNavigate()
	async function createRoom() {
		const res = await R.createRoom()
		navigate(`/room/${res.networkId}`)
	}

	return (
		<AppContainer>
			<div class="grid h-[calc(100vh_-_4rem)] place-items-center">
				<div class="flex w-[24em] flex-col rounded bg-gray-800 p-2">
					<h2 class="text-center">Welcome!</h2>
					<p class="mb-2 text-sm">Click below to host a new game, or copy the link from your opponent into your browser to join theirs.</p>
					<Button size="large" kind="primary" onClick={createRoom}>
						Play
					</Button>
				</div>
			</div>
		</AppContainer>
	)
}
