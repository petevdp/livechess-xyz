import {
	Accessor,
	createEffect,
	createRoot,
	createSignal,
	getOwner,
	JSXElement,
	onCleanup, onMount,
	runWithOwner,
	Show,
} from 'solid-js'
import {Button} from './Button.tsx'
import {until} from '@solid-primitives/promise'
import {sleep} from "../utils/time.ts";

let modalContainer: HTMLDivElement | null = null
// for some reason checking for reference equality on the JSXElement itself isn't working, so we're wrap it in an object as a workaround
type ActiveModal = {
	title: string | null
	elt: HTMLElement
	closeOnEscape: boolean
	closeOnOutsideClick: boolean
}

const [activeModal, setActiveModal] = createSignal<ActiveModal | null>(null)

export function ModalContainer() {
	modalContainer?.remove()
	onCleanup(() => {
		modalContainer?.remove()
		modalContainer = null
	})

	return (
		<div
			ref={modalContainer!}
			class="left-0 top-0 z-[1000] h-full w-full overflow-y-auto outline-none"
			classList={{
				[activeModal() ? 'absolute' : 'hidden']: true
			}}
			id="modal-container"
			tabindex="-1"
			aria-labelledby="modalLabel"
			onclick={() => setActiveModal(null)}
			aria-hidden={!activeModal()}
		>
			<div
				class="pointer-events-none relative top-[50%] left-[50%] transform[-translate-x-1/2_-translate-y-1/2] w-max flex items-center"
				onclick={(e) => e.stopPropagation()}
			>
				<div
					class="pointer-events-auto relative flex w-full flex-col rounded-md border-none bg-gray-800 text-current shadow-lg outline-none">
					<Show when={activeModal()?.title}>
						<div
							class="flex flex-shrink-0 flex-row items-center rounded-t-md p-2 border-b-2 border-b-gray-500"
							classList={{
								[activeModal()!.title ? 'justify-between' : 'justify-end']: true
							}}
						>
							<h5
								class="text-lg font-medium leading-normal text-neutral-800 dark:text-neutral-200"
								id="modalLabel"
							>
								{activeModal()!.title}
							</h5>
							<Button kind={'secondary'} onclick={() => setActiveModal(null)}>
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
					<div class="p-3">
						{activeModal()?.elt}
					</div>
				</div>
			</div>
		</div>
	)
}

type ModalProps = {
	title: string | null
	render: () => JSXElement
	visible: Accessor<boolean>
	setVisible: (visible: boolean) => void,
	closeOnEscape?: boolean
	closeOnOutsideClick?: boolean
}

function addModal(props: ModalProps) {
	// this closure owns the modal's element
	let current: ActiveModal | null = null

	let owner = getOwner()
	if (!owner) throw new Error('addModal must be called with an owner')

	createEffect(() => {
		if (!props.visible() && current) {
			current.elt.style.display = 'none'
		} else if (props.visible() && !current) {
			runWithOwner(owner, () => {
				current = {
					elt: (
						<span>
							<props.render/>
						</span>
					) as HTMLSpanElement,
					title: props.title,
					closeOnEscape: props.closeOnEscape ?? true,
					closeOnOutsideClick: props.closeOnOutsideClick ?? true,
				}
			})
			setActiveModal(current)
		} else if (props.visible() && current) {
			current.elt.style.display = 'block'
		}
	})

	onCleanup(() => {
		if (current) {
			if (activeModal() === current) setActiveModal(null)
			current.elt.remove()
		}
	})
}

export type CanPrompt<T> = { onCompleted: (result: T) => void }

export async function prompt<T>(
	component: (props: CanPrompt<T>) => JSXElement,
	defaultValue: T,
	disposed?: Accessor<boolean>
) {
	// wrapping output in object so falsy values still work
	const [output, setOutput] = createSignal(null as { out: T } | null)
	let disposeOwner = null as unknown as () => void

	let disposedAccessor = disposed || (() => false)

	function render() {
		const onCompleted = (result: T) => {
			setOutput(() => ({out: result}))
		}

		const rendered = component({onCompleted})

		if (typeof rendered === 'string') {
			let buttonRef: HTMLButtonElement | null = null

			function keyListener(e: KeyboardEvent) {
				if (e.key === 'Enter') {
					onCompleted(defaultValue)
				}
			}

			onMount(() => {
				document.addEventListener('keydown', keyListener)
			})

			onCleanup(() => {
				document.removeEventListener('keydown', keyListener)
			})

			return (
				<div class="flex items-center">
					<p class="mr-2 text-lg">{rendered}</p>
					<Button tabindex={1} ref={buttonRef!} kind="primary" onclick={() => onCompleted(defaultValue)}>
						OK
					</Button>
				</div>
			)
		} else {
			return rendered
		}
	}

	createRoot((dispose) => {
		disposeOwner = dispose
		addModal({
			title: null,
			render,
			visible: () => true,
			setVisible: () => {
			},
			closeOnOutsideClick: false,
			closeOnEscape: false,
		})
		createEffect(() => {
			if (disposedAccessor()) dispose()
		})
	})

	await until(() => output() !== null)
	!disposedAccessor() && disposeOwner()
	return output()!.out
}
