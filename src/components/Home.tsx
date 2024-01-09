import { AppContainer, ScreenFittingContent } from './AppContainer.tsx'
import * as R from '~/systems/room.ts'
import { useNavigate } from '@solidjs/router'
import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '~/components/ui/card.tsx'

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
					<CardHeader>Welcome to LiveChess!</CardHeader>
					<CardContent>
						<p>Click below to host a new game, or copy the link from your opponent into your browser to join theirs.</p>
						<div class="flex justify-center">
							<Button variant="default" onclick={createRoom}>
								Play
							</Button>
						</div>
					</CardContent>
				</Card>
			</ScreenFittingContent>
		</AppContainer>
	)
}
