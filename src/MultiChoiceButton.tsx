import {For} from "solid-js";

export type Choice<T> = { id: T; label: string }
export function MultiChoiceButton<T extends string>(props: {
    choices: Choice<T>[],
    selected: string,
    onChange: (id: T) => void
}) {
    return <div class={'flex'}>
        <For each={props.choices}>{(choice => <button class="p-0.5"
                                                      classList={{"bg-blue-500": choice.id == props.selected}}
                                                      onClick={() => props.onChange(choice.id)}>{choice.label}</button>)}</For>
    </div>
}