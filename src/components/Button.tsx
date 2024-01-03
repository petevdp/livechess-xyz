import { JSX, mergeProps } from 'solid-js'
import styles from './Button.module.css'

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

	const merged = mergeProps(baseProps, props)

	return <button {...merged}>{props.children}</button>
}
