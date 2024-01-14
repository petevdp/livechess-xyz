import { For } from 'solid-js'



import { Button, ButtonProps } from '~/components/ui/button.tsx';
import { cn } from '~/lib/utils.ts';


export type Choice<T> = { id: T; label: string }

export function MultiChoiceButton<T extends string>(props: {
	label: string
	choices: Choice<T>[]
	selected: string
	onChange: (id: T) => void
	listClass?: string
	classList?: Record<string, boolean>
	classListButton?: Record<string, boolean>
	variant?: ButtonProps['variant']
	disabled?: boolean
}) {
	props.classList ||= {}
	return (
		<div class="flex flex-col">
			<label class="col-span-full text-center">{props.label}</label>
			<div class={cn('space-x-1', props.listClass || '')} classList={props.classList}>
				<For each={props.choices}>
					{(choice) => (
						<Button
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
