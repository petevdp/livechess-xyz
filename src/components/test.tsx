import { createEffect, createRenderEffect, createSignal, onMount } from 'solid-js'

import * as pieces from '~/systems/piece'

import styles from './Game.module.css'

export function Test() {
	const [coords, setCoords] = createSignal({ x: 0, y: 0 })
	function listener(e: MouseEvent) {
		setCoords({ x: e.clientX, y: e.clientY })
	}
	createEffect(() => {
		console.log('coords: ', coords())
	})
	document.addEventListener('mousemove', listener)
	return (
		// return { transform: `translate(${postiion.x}px, ${postiion.y}px)` }
		<div class="w-full h-full bg-blue-600 absolute">
			<div
				class={`absolute top-0 left-0 w-64 h-64 ${styles.piece} ${styles[pieces.getPieceKey({ color: 'white', type: 'rook' })]}`}
				style={{ transform: `translate(${coords().x}px, ${coords().y}px)` }}
			/>
		</div>
	)
}
