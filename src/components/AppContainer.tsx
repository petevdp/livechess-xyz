import { ComponentProps, ParentProps, splitProps } from 'solid-js'
import { ModalContainer } from './utils/Modal.tsx'
import { A } from '@solidjs/router'
import Logo from '~/assets/logo.svg'
import styles from './AppContainer.module.css'
import { cn } from '~/lib/utils.ts'

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
	// @ts-ignore
	const logo = <Logo class={styles.logo} />
	return (
		<div class={`w-[calc(100%_-_${scrollBarWidth}px]`}>
			<div class="w-min p-2">
				<A href="/" class="flex">
					{logo}
				</A>
			</div>
			<ModalContainer />
			{props.children}
		</div>
	)
}
export function ScreenFittingContent(props: ComponentProps<'div'>) {
	const [, rest] = splitProps(props, ['class'])
	return (
		<div class={cn('h-[calc(100vh_-_48px_-1rem)]', props.class)} {...rest}>
			{props.children}
		</div>
	)
}
