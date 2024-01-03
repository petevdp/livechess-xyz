import { ParentProps } from 'solid-js'
import { ModalContainer } from './Modal.tsx'
import { A } from '@solidjs/router'
import Logo from '../assets/logo.svg'

export function AppContainer(props: ParentProps) {
	return (
		<div class="w-full bg-gradient-to-b from-gray-900 to-gray-700 text-white">
			<div class="p-2">
				<A href="/">
					<Logo />
				</A>
			</div>
			<ModalContainer />
			{props.children}
		</div>
	)
}
