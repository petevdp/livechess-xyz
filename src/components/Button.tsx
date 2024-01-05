import { createEffect, createSignal, JSX, mergeProps, onMount } from 'solid-js'
import { filterProps } from '@solid-primitives/props'
import styles from './Button.module.css'
import { tippy } from '../utils/tippy.tsx'

tippy
export const buttonPrimary: Record<string, boolean> = {
	'bg-blue-500': true,
}

export type ButtonProps = {
	kind: 'primary' | 'secondary' | 'tertiary'
	size: 'small' | 'medium' | 'large'
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

export function Button(props: ButtonProps) {
	const baseProps: JSX.ButtonHTMLAttributes<HTMLButtonElement> = {
		'aria-label': props.children instanceof HTMLElement ? props.children.innerText : '',
	}

	const getClassList = () => ({
		[styles.button]: true,
		[styles[props.kind]]: true,
		[styles[props.size]]: true,
		[props.class || '']: !!props.class,
	})

	const [classList, setClassList] = createSignal(getClassList())

	createEffect(() => {
		setClassList(getClassList())
	})

	let merged = mergeProps(baseProps, props)
	merged = filterProps(merged, (k) => !['kind', 'size', 'title', 'class'].includes(k))
	let ref = null as unknown as HTMLButtonElement

	if (props.title) {
		onMount(() => {
			tippy(ref, {
				content: props.title,
				showOnCreate: false,
				interactive: true,
			})
		})
	}

	return (
		<button {...merged} ref={ref} classList={classList()}>
			{props.children}
		</button>
	)

	// if (props.title) {
	// 	return (
	// 		<button
	// 			{...merged}
	// 			classList={classList()}
	// 			use:tippy={{ content: props.title, showOnCreate: false, interactive: true, }}
	// 		>
	// 			{props.children}
	// 		</button>
	// 	)
	// } else {
	// 	return (
	// 		<button {...merged} classList={classList()}>
	// 			{props.children}
	// 		</button>
	// 	)
	// }
}
