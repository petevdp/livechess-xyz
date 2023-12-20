import {Accessor, batch, createSignal, getOwner, JSXElement, onCleanup, Owner, runWithOwner, Show,} from 'solid-js'
import {Button} from "./Button.tsx";

let modalContainer: HTMLDivElement | null = null
// for some reason checking for reference equality on the JSXElement itself isn't working, so we're wrap it in an object as a workaround
let [activeElement, setActiveElement] = createSignal<null | {
	elt: JSXElement
}>(null)

const [title, setTitle] = createSignal<string>('')

export function ModalContainer() {
	modalContainer?.remove()
	onCleanup(() => {
		modalContainer?.remove()
		modalContainer = null
	})
	return (
		<div
			ref={modalContainer!}
			class={
				'left-0 top-0 z-[1000] h-full w-full overflow-y-auto outline-none ' +
				(activeElement() ? 'absolute' : 'hidden')
			}
			id="modal-container"
			tabindex="-1"
			aria-labelledby="modalLabel"
			onclick={() => setActiveElement(null)}
			aria-hidden={!activeElement()}
		>
			<div
				class="pointer-events-none relative flex min-h-[calc(100%-1rem)] w-auto translate-y-[-50px] items-center duration-300 ease-in-out min-[576px]:mx-auto min-[576px]:mt-7 min-[576px]:min-h-[calc(100%-3.5rem)] min-[576px]:max-w-[500px]"
				onclick={(e) => e.stopPropagation()}
			>
				<div
					class="min-[576px]:shadow-[0_0.5rem_1rem_rgba(#000, 0.15)] pointer-events-auto relative flex w-full flex-col rounded-md border-none bg-white  text-current shadow-lg outline-none dark:bg-neutral-600">
					<Show when={title()}>
						<div
							class={
								'flex flex-shrink-0 flex-row items-center rounded-t-md border-b-2 border-neutral-100 border-opacity-100 p-4 dark:border-opacity-50 ' +
								(title() ? 'justify-between' : 'justify-end')
							}
						>
							<h5
								class="text-xl font-medium leading-normal text-neutral-800 dark:text-neutral-200"
								id="modalLabel"
							>
								{title()}
							</h5>
							<Button
								kind={'secondary'}
								onclick={() => setActiveElement(null)}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="h-6 w-6"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</Button>
						</div>
					</Show>

					<div class="p-4">
						<Show when={activeElement() !== null}>{activeElement()?.elt}</Show>
					</div>
				</div>
			</div>
		</div>
	)
}

type ModalProps = {
	title: string | null
	render: (
		modalState: Accessor<boolean>,
		setActive: (isActive: boolean) => void
	) => JSXElement
}

export type ModalState = {
	visible: Accessor<boolean>
	setVisible: (visible: boolean) => void
}

export function addModal(
	props: ModalProps,
	owner: Owner | undefined
): ModalState {
	let current: { elt: HTMLSpanElement } | null = null
	const _owner = owner || getOwner()
	const isActive = () => activeElement() !== null && current === activeElement()
	const setVisible = (_active: boolean) => {
		runWithOwner(_owner, () => {
			if (!isActive() && _active) {
				const inner = props.render(isActive, setVisible)
				const element = (<span>{inner}</span>) as HTMLSpanElement
				current = {elt: element}
				element.addEventListener('keydown', (e) => {
					if (e.key === 'Escape') {
						setActiveElement(null)
						element.remove()
					}
				})
				batch(() => {
					props.title && setTitle(props.title)
					setActiveElement(current)
				})
			} else if (isActive() && !_active) {
				setActiveElement(null)
				current?.elt.remove()
			}
		})
	}

	return {visible: isActive, setVisible}
}

export type CanPrompt<T> = { onCompleted: (result: T) => void }

export async function prompt<T>(
	owner: Owner,
	title: string | null,
	component: (props: CanPrompt<T>) => JSXElement,
	defaultValue: T
) {
	return new Promise<T>((resolve) => {
		const {setVisible} = addModal(
			{
				title: title || null,
				render: (_, setVisible) => {
					const onCompleted = (result: T) => {
						setVisible(false)
						resolve(result)
					}
					const rendered = component({
						onCompleted,
					})

					if (typeof rendered === 'string') {
						return (
							<div class="flex flex-row justify-between">
								<p>{rendered}</p>
								<Button
									kind="primary"
									onclick={() => onCompleted(defaultValue)}
								>
									OK
								</Button>
							</div>
						)
					} else {
						return rendered
					}
				},
			},
			owner
		)
		setVisible(true)
	})
}
