import { ComponentProps, ParentProps, splitProps } from 'solid-js'
import { ModalContainer } from './Modal.tsx'
import { A } from '@solidjs/router'
import Logo from '~/assets/logo.svg'
import styles from './AppContainer.module.css'
import { cn } from '~/lib/utils.ts'

export function AppContainer(props: ParentProps) {
	// @ts-ignore
	const logo = <Logo class={styles.logo} />
	return (
		<div class="w-screen">
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
