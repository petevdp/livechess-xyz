import { useNavigate } from '@solidjs/router'

import { Button, buttonVariants } from '~/components/ui/button.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import * as GlobalLoading from '~/systems/globalLoading.ts'
import * as R from '~/systems/room.ts'

import { AppContainer, ScreenFittingContent } from './AppContainer.tsx'

export function Home() {
	const navigate = useNavigate()
	async function createRoom() {
		GlobalLoading.setLoading('connect-to-room')
		const res = await R.createRoom()
		navigate(`/rooms/${res.networkId}`)
	}

	GlobalLoading.clear()

	return (
		<AppContainer>
			<ScreenFittingContent class="grid place-items-center">
				<Card class="h-min w-fit">
					<CardHeader>
						<CardTitle class="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
							Welcome to{' '}
							<a href="/" class="text-primary underline">
								livechess.xyz
							</a>
							!
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p>Play chess with your friends, on desktop or mobile.</p>
					</CardContent>
					<CardFooter class="space-x-1">
						<a href="/rooms/new" class={buttonVariants({ variant: 'default' })}>
							Join Game
						</a>
						<a href="/bot" class={buttonVariants({ variant: 'secondary' })}>
							Play vs Bot
						</a>
					</CardFooter>
				</Card>
			</ScreenFittingContent>
		</AppContainer>
	)
}
