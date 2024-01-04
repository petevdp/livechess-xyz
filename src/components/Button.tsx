import { createEffect, createSignal, JSX, mergeProps } from 'solid-js'
import { filterProps } from '@solid-primitives/props'
import styles from './Button.module.css'
import { tippy } from '../utils/tippy.tsx'
import 'tippy.js/themes/material.css'

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
	if (props.title) {
		return (
			<button
				{...merged}
				classList={classList()}
				use:tippy={{ theme: 'material', content: props.title, showOnCreate: false }}
			>
				{props.children}
			</button>
		)
	} else {
		return (
			<button {...merged} classList={classList()}>
				{props.children}
			</button>
		)
	}
}
