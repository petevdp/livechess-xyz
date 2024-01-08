import { ParentProps } from 'solid-js'
import { ModalContainer } from './Modal.tsx'
import { A } from '@solidjs/router'
import Logo from '../assets/logo.svg'
import styles from './AppContainer.module.css'

export function AppContainer(props: ParentProps) {
	// @ts-ignore
	const logo = <Logo class={styles.logo} />
	return (
		<div class="min-h-screen w-[w-screen] bg-gradient-to-b from-blue-800 to-blue-600 text-white">
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
