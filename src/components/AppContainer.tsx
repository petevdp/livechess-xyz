import { useColorMode } from '@kobalte/core'
import { A } from '@solidjs/router'
import { ComponentProps, Match, ParentProps, Show, Switch, splitProps } from 'solid-js'

import { AboutDialog } from '~/components/AboutDialog.tsx'
import { SettingsDialog } from '~/components/Settings.tsx'
import { Spinner } from '~/components/Spinner.tsx'
import { Button, buttonVariants } from '~/components/ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '~/components/ui/dropdown-menu.tsx'
import { cn } from '~/lib/utils.ts'
import * as GlobalLoading from '~/systems/globalLoading.ts'
import * as P from '~/systems/player.ts'
import * as R from '~/systems/room.ts'

import styles from './AppContainer.module.css'
import DebugDisplay from './DebugDisplay.tsx'
import * as Svgs from './Svgs.tsx'
import { ModalContainer } from './utils/Modal.tsx'

export function AppContainer(props: ParentProps) {
	return (
		<div class={`w-full h-full flex wc:flex-col min-h-0`}>
			{/* include id so we can do precise height calculations against the navbar for the board */}
			<nav id="navbar" class={`${styles.nav} p-[0.25rem] pb-[.5rem] flex flex-col wc:flex-row items-center wc:justify-between`}>
				<A href="/" class={buttonVariants({ variant: 'ghost', size: 'icon' })}>
					<Svgs.Logo />
				</A>
				<div class={`${styles.controls} p-[0.25rem] pb-[.5rem] flex flex-col items-center wc:flex-row`}>
					<Button size="icon" variant="ghost" onclick={() => (P.settings.muteAudio = !P.settings.muteAudio)}>
						{P.settings.muteAudio ? <Svgs.Muted /> : <Svgs.NotMuted />}
					</Button>
					<ThemeToggle />
					<SettingsDialog />
					<AboutDialog />
					<div class="flex items-center justify-end space-x-1 font-light">
						<Show when={R.room() && !R.room()!.isPlayerParticipating}>Spectating</Show>
					</div>
					<DebugDisplay />
				</div>
			</nav>
			<Switch>
				<Match when={GlobalLoading.isLoading()}>
					<ScreenFittingContent class="grid place-items-center">
						<Spinner />
					</ScreenFittingContent>
				</Match>
				<Match when={!GlobalLoading.isLoading()}>{props.children}</Match>
			</Switch>
			<ModalContainer />
		</div>
	)
}

export function ThemeToggle() {
	const { setColorMode } = useColorMode()

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button variant="ghost" size="icon">
					<Svgs.LightMode width={16} height={16} class=" dark:invisible dark:w-0" />
					<Svgs.DarkMode width={16} height={16} class="invisible w-0 dark:visible dark:w-auto" />
					<span class="sr-only">Toggle theme</span>
				</Button>
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
		<div class={cn('h-full w-full min-h-0', props.class)} {...rest}>
			{props.children}
		</div>
	)
}
