import {JSX, mergeProps} from "solid-js";
import styles from './Button.module.css'

export const buttonPrimary: Record<string, boolean> = {
	"bg-blue-500": true,
}


export type ButtonProps = {
	kind: 'primary' | 'secondary';
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button(props: ButtonProps) {
	const baseProps: JSX.ButtonHTMLAttributes<HTMLButtonElement> = {
		classList: {
			[styles.button]: true,
			[props.kind === 'primary' ? styles.primary : styles.secondary]: true,
		},
		"aria-label": props.children instanceof HTMLElement ? props.children.innerText : '',
	}


	const merged = mergeProps(baseProps, props)

	return <button {...merged}>{props.children}</button>
}
