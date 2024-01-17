import { A } from '@solidjs/router'
import { ComponentProps, ParentProps, Show, splitProps } from 'solid-js'

import { AboutDialog } from '~/components/AboutDialog.tsx'
import { SettingsDialog } from '~/components/Settings.tsx'
import { Button } from '~/components/ui/button.tsx'
import { cn } from '~/lib/utils.ts'
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
					<Svgs.Logo/>
				</A>
				<div class="flex items-center justify-end space-x-1 font-light">
					<Button size="icon" variant="ghost" onclick={() => P.setSettings({muteAudio: !P.settings.muteAudio})}>
						{P.settings.muteAudio ? <Svgs.Muted/> : <Svgs.NotMuted/>}
					</Button>
					<Show when={R.room() && !R.room()!.isPlayerParticipating}>Spectating</Show>
					<SettingsDialog />
					<AboutDialog/>
				</div>
			</nav>
			<ModalContainer />
			<div>{props.children}</div>
		</div>
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
