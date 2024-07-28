import { For, JSXElement, Show } from 'solid-js'

import { Button, buttonProps } from '~/components/ui/button.tsx'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group.tsx'
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
	variant?: buttonProps['variant']
	disabled?: boolean
}) {
	props.classList ||= {}
	return (
		<div class={cn('flex flex-col', props.containerClass || '')}>
			<Show when={props.label && typeof props.label === 'string'}>
				<label class="col-span-full text-center">{props.label}</label>
			</Show>
			<Show when={props.label && typeof props.label !== 'string'}>{props.label}</Show>
			<ToggleGroup
				value={props.selected}
				disabled={props.disabled}
				class={cn('space-x-1', props.listClass || '')}
				classList={props.classList}
			>
				<For each={props.choices}>
					{(choice) => (
						<ToggleGroupItem
							class={cn(props.disabled ? 'text-lime-500' : '')}
							type="button"
							disabled={props.disabled}
							onClick={() => props.onChange(choice.id)}
							value={choice.id}
						>
							{choice.label}
						</ToggleGroupItem>
					)}
				</For>
			</ToggleGroup>
		</div>
	)
}
