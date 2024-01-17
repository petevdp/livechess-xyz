import { useNavigate } from '@solidjs/router'

import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card.tsx'
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
						<CardTitle>Welcome to LiveChess!</CardTitle>
					</CardHeader>
					<CardContent>
						<p>Click below to host a new game, or copy the link from your opponent into your browser to join their
							game.</p>
					</CardContent>
					<CardFooter>
						<div class="flex justify-center w-full">
							<Button variant="default" onclick={createRoom}>
								Play
							</Button>
						</div>
					</CardFooter>
				</Card>
			</ScreenFittingContent>
		</AppContainer>
	)
}
