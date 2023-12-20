import {For} from "solid-js";

export type Choice<T> = { id: T; label: string }

export function MultiChoiceButton<T extends string>(props: {
	label: string
	choices: Choice<T>[]
	selected: string
	onChange: (id: T) => void
	class?: string
	classList?: Record<string, boolean>
	classListButton?: Record<string, boolean>
}) {
	props.classList ||= {}
	return <div classList={props.classList}>
		<label class="col-span-full text-center">{props.label}</label>
		<For each={props.choices}>
			{(choice => <button class="border-solid m-0.5 border-white bg-blue-500 rounded"
													classList={{"bg-blue-800": choice.id == props.selected, ...props.classListButton}}
													onClick={() => props.onChange(choice.id)}>{choice.label}</button>)}</For>
	</div>
}
