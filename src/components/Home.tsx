import { For, Show, createSignal, onMount } from 'solid-js'

import { buttonVariants } from '~/components/ui/button.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import { cn } from '~/lib/utils.ts'
import * as GlobalLoading from '~/systems/globalLoading.ts'
import { RoomDetails, recentRooms, setRecentRooms } from '~/systems/room.ts'

import { AppContainer, ScreenFittingContent } from './AppContainer.tsx'

export function Home() {
	GlobalLoading.clear()
	const [roomDetails, setRoomDetails] = createSignal<RoomDetails[] | null>()
	onMount(() => {
		const roomIds = recentRooms()
		if (roomIds.length === 0) {
			setRoomDetails([])
			return
		}

		fetch('/api/roomDetails', {
			body: JSON.stringify(roomIds),
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
		})
			.then((res) => {
				if (!res.ok) throw new Error(`roomDetails lookup failed: ${res.status}`)
				return res.json()
			})
			.then((data: RoomDetails[]) => {
				const stillExistingRooms: string[] = []
				for (const details of data) {
					stillExistingRooms.push(details.roomId)
				}
				setRecentRooms(stillExistingRooms)
				setRoomDetails(data)
			})
			// a failed lookup shouldn't blank the page -- just show no recent rooms
			.catch((err) => {
				console.error(err)
				setRoomDetails([])
			})
	})

	return (
		<AppContainer>
			<ScreenFittingContent class="grid place-items-center">
				<div class="flex w-fit flex-col gap-4">
					<Card class="h-min w-full">
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
								Play Vs Friends
							</a>
							<a href="/bot" class={buttonVariants({ variant: 'secondary' })}>
								Play vs Bot
							</a>
						</CardFooter>
					</Card>
					<Show when={roomDetails()?.length}>
						<Card class="h-min w-full">
							<CardHeader class="pb-3">
								<CardTitle>Recent Rooms</CardTitle>
							</CardHeader>
							<CardContent class="flex flex-col gap-1">
								<For each={roomDetails()!}>
									{(room) => (
										<a
											href={`/rooms/${room.roomId}`}
											class={cn(buttonVariants({ variant: 'ghost' }), 'h-auto justify-between gap-4 px-3 py-2 font-normal')}
										>
											<span class="font-medium">{room.roomId}</span>
											<span class="truncate text-sm text-muted-foreground">
												{room.memberNames.length > 0 ? room.memberNames.join(', ') : 'empty'}
											</span>
										</a>
									)}
								</For>
							</CardContent>
						</Card>
					</Show>
				</div>
			</ScreenFittingContent>
		</AppContainer>
	)
}
