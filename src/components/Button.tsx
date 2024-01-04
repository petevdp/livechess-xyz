import { JSX, mergeProps } from 'solid-js'
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
		classList: {
			[styles.button]: true,
			[styles[props.kind]]: true,
			[styles[props.size]]: true,
		},
		'aria-label': props.children instanceof HTMLElement ? props.children.innerText : '',
	}

	let merged = mergeProps(baseProps, props)
	merged = filterProps(merged, (k) => !['kind', 'size', 'title'].includes(k))
	if (props.title) {
		return (
			<button {...merged} use:tippy={{ theme: 'material', content: props.title, showOnCreate: false }}>
				{props.children}
			</button>
		)
	} else {
		return <button {...merged}>{props.children}</button>
	}
}
