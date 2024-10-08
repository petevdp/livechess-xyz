import { For, JSXElement, Show } from 'solid-js'

import { Button, ButtonProps } from '~/components/ui/button.tsx'
import { cn } from '~/lib/utils.ts'

export type Choice<T> = { id: T; label: string }

export function MultiChoiceButton<T extends string>(props: {
	label?: string | JSXElement
	choices: Choice<T>[]
	selected: string
	onChange: (id: T) => void
	listClass?: string
	classList?: Record<string, boolean>
	containerClass?: string
	classListButton?: Record<string, boolean>
	variant?: ButtonProps['variant']
	disabled?: boolean
}) {
	props.classList ||= {}
	return (
		<div class={cn('flex flex-col', props.containerClass || '')}>
			<Show when={props.label && typeof props.label === 'string'}>
				<label class={`col-span-full text-center ${props.disabled ? 'text-gray-600 hover:text-gray-600' : ''}`}>{props.label}</label>
			</Show>
			<Show when={props.label && typeof props.label !== 'string'}>{props.label}</Show>
			<div class={cn('space-x-1', props.listClass || '')} classList={props.classList}>
				<For each={props.choices}>
					{(choice) => (
						<Button
							type="button"
							disabled={props.disabled}
							variant={props.variant || 'outline'}
							class={choice.id === props.selected ? 'bg-accent' : ''}
							onClick={() => props.onChange(choice.id)}
						>
							{choice.label}
						</Button>
					)}
				</For>
			</div>
		</div>
	)
}
