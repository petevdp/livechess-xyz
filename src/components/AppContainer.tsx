import { As, useColorMode } from '@kobalte/core'
import { A } from '@solidjs/router'
import { ComponentProps, Match, ParentProps, Show, Switch, splitProps } from 'solid-js'

import { AboutDialog } from '~/components/AboutDialog.tsx'
import { SettingsDialog } from '~/components/Settings.tsx'
import { Spinner } from '~/components/Spinner.tsx'
import { Button } from '~/components/ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '~/components/ui/dropdown-menu.tsx'
import { cn } from '~/lib/utils.ts'
import * as GlobalLoading from '~/systems/globalLoading.ts'
import * as P from '~/systems/player.ts'
import * as R from '~/systems/room.ts'

import * as Svgs from './Svgs.tsx'
import { ModalContainer } from './utils/Modal.tsx'

// so we can account for the width of the scrollbar for the app container's width
const scrollBarWidth = (() => {
	const scrollDiv = document.createElement('div')
	scrollDiv.className = 'scrollbar-measure'
	document.body.appendChild(scrollDiv)
	const scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth
	document.body.removeChild(scrollDiv)
	return scrollbarWidth
})()

export function AppContainer(props: ParentProps) {
	return (
		<div class={`w-[calc(100%_-_${scrollBarWidth}px]`}>
			<nav class="flex w-full justify-between p-[0.25rem] pb-[.5rem]">
				<A href="/" class="inline-flex p-1 h-10 w-10 items-center justify-center">
					<Svgs.Logo />
				</A>
				<div class="flex items-center justify-end space-x-1 font-light">
					<Show when={R.room() && !R.room()!.isPlayerParticipating}>Spectating</Show>
					<Button size="icon" variant="ghost" onclick={() => (P.settings.muteAudio = !P.settings.muteAudio)}>
						{P.settings.muteAudio ? <Svgs.Muted /> : <Svgs.NotMuted />}
					</Button>
					<ThemeToggle />
					<SettingsDialog />
					<AboutDialog />
				</div>
			</nav>
			<ModalContainer />
			<Switch>
				<Match when={GlobalLoading.isLoading()}>
					<ScreenFittingContent class="grid place-items-center">
						<Spinner />
					</ScreenFittingContent>
				</Match>
				<Match when={!GlobalLoading.isLoading()}>
					<div>{props.children}</div>
				</Match>
			</Switch>
		</div>
	)
}

export function ThemeToggle() {
	const { setColorMode } = useColorMode()

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<As component={Button} variant="ghost" size="icon">
					<Svgs.LightMode width={16} height={16} class=" dark:invisible dark:w-0" />
					<Svgs.DarkMode width={16} height={16} class="invisible w-0 dark:visible dark:w-auto" />
					<span class="sr-only">Toggle theme</span>
				</As>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem onSelect={() => setColorMode('light')}>
					<Svgs.LightMode class="mr-2 h-4 w-4" />
					<span>Light</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setColorMode('dark')}>
					<Svgs.DarkMode class="mr-2 h-4 w-4" />
					<span>Dark</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setColorMode('system')}>
					<Svgs.Laptop class="mr-2 h-4 w-4" />
					<span>System</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function ScreenFittingContent(props: ComponentProps<'div'>) {
	const [, rest] = splitProps(props, ['class'])
	return (
		<div class={cn('h-[calc(100vh_-_48px_-.5rem)]', props.class)} {...rest}>
			{props.children}
		</div>
	)
}
