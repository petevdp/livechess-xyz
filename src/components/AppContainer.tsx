import { ParentProps } from 'solid-js'
import { ModalContainer } from './Modal.tsx'
import { A } from '@solidjs/router'
import Logo from '../assets/logo.svg'
import styles from './AppContainer.module.css'

export function AppContainer(props: ParentProps) {
	return (
		<div class="min-h-screen w-screen bg-gradient-to-b from-blue-800 to-blue-600 text-white">
			<div class="w-min p-2">
				<A href="/" class="flex">
					<Logo class={styles.logo} />
				</A>
			</div>
			<ModalContainer />
			{props.children}
		</div>
	)
}
