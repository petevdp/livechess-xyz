import { useNavigate } from '@solidjs/router'

import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import * as Agent from '~/systems/agent.ts'
import * as R from '~/systems/room.ts'

import { AppContainer, ScreenFittingContent } from './AppContainer.tsx'


export function Home() {
	const navigate = useNavigate()

	async function createRoom() {
		const res = await R.createRoom()
		navigate(`/rooms/${res.networkId}`)
	}

	return (
		<AppContainer>
			<ScreenFittingContent class="grid place-items-center">
				<Card class="h-min w-80">
					<CardHeader>
						<CardTitle>Welcome to <a href="/" class="text-primary underline">livechess.xyz</a>!</CardTitle>
					</CardHeader>
					<CardContent>
						<p>{Agent.usingTouch() ? 'Tap' : 'Click'} below to host a new game.</p>
					</CardContent>
					<CardFooter>
						<Button variant="default" onclick={createRoom}>
							Host New Game
						</Button>
					</CardFooter>
				</Card>
			</ScreenFittingContent>
		</AppContainer>
	)
}
