import { Accessor, JSXElement, Show, createEffect, createRoot, createSignal, getOwner, onCleanup, onMount, runWithOwner } from 'solid-js';



import { Button } from '~/components/ui/button.tsx';
import { myUntil } from '~/utils/solid.ts'

let modalContainer: HTMLDivElement | null = null
// for some reason checking for reference equality on the JSXElement itself isn't working, so we're wrap it in an object as a workaround
type ActiveModal = {
	title: string | null
	elt: HTMLElement
	position: () => [string, string] | undefined
	visible: () => boolean
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
				[activeModal() ? 'absolute' : 'hidden']: true,
				[activeModal()?.closeOnOutsideClick ? 'pointer-events-auto' : 'pointer-events-none']: true,
			}}
			id="modal-container"
			tabindex="-1"
			aria-labelledby="modalLabel"
			onclick={() => setActiveModal(null)}
			aria-hidden={!activeModal()}
		>
			<div
				class="activeModal pointer-events-auto flex w-max items-center overflow-hidden"
				classList={{
					['absolute -translate-x-1/2 -translate-y-1/2 left-[50%] top-[50%]']: !activeModal()?.position(),
				}}
				style={{
					position: activeModal()?.position() ? 'absolute' : undefined,
					left: (activeModal()?.position() || [])[0],
					top: (activeModal()?.position() || [])[1],
					display: activeModal()?.visible() ? undefined : 'none',
					visibility: activeModal()?.visible() ? undefined : 'hidden',
				}}
				onclick={(e) => e.stopPropagation()}
			>
				<div class="pointer-events-auto relative flex w-full flex-col rounded-md border bg-card text-card-foreground shadow-sm outline-none">
					<Show when={activeModal()?.title}>
						<div
							class="flex flex-shrink-0 flex-row items-center rounded-t-md p-2"
							classList={{
								[activeModal()!.title ? 'justify-between' : 'justify-end']: true,
							}}
						>
							<h5 class="text-lg font-medium leading-normal text-neutral-800 dark:text-neutral-200" id="modalLabel">
								{activeModal()!.title}
							</h5>
							<Button variant="secondary" onclick={() => setActiveModal(null)}>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="h-6 w-6"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</Button>
						</div>
					</Show>
					<div class="p-3">{activeModal()?.elt}</div>
				</div>
			</div>
		</div>
	)
}

type ModalProps = {
	title: string | null
	render: () => JSXElement
	position?: () => [string, string] | undefined
	visible: Accessor<boolean>
	setVisible: (visible: boolean) => void
	closeOnEscape?: boolean
	closeOnOutsideClick?: boolean
}

export function addModal(props: ModalProps) {
	// this closure owns the modal's element
	let current: ActiveModal | null = null

	let owner = getOwner()
	if (!owner) throw new Error('addModal must be called with an owner')

	let storedDisplay = 'block'
	createEffect(() => {
		if (!props.visible() && current) {
			storedDisplay = current.elt.style.display
			current.elt.style.display = 'none'
		} else if (props.visible() && !current) {
			runWithOwner(owner, () => {
				current = {
					elt: (
						<span>
							<props.render />
						</span>
					) as HTMLSpanElement,
					title: props.title,
					visible: props.visible,
					position: props.position || (() => undefined),
					closeOnEscape: props.closeOnEscape ?? true,
					closeOnOutsideClick: props.closeOnOutsideClick ?? true,
				}
			})
			setActiveModal(current)
		} else if (props.visible() && current) {
			current.elt.style.display = storedDisplay
			setActiveModal(current)
		}
	})

	onCleanup(() => {
		if (current) {
			if (activeModal() === current) setActiveModal(null)
			current.elt.remove()
			current = null
		}
	})
}

export type CanPrompt<T> = { onCompleted: (result: T) => void }

export async function prompt<T>(
	component: (props: CanPrompt<T>) => JSXElement,
	defaultValue: T,
	disposed?: Accessor<boolean>,
	position?: () => [string, string] | undefined
) {
	// wrapping output in object so falsy values still work
	const [output, setOutput] = createSignal(null as { out: T } | null)
	let disposeOwner = null as unknown as () => void

	disposed ||= () => false

	function render() {
		const onCompleted = (result: T) => {
			setOutput(() => ({ out: result }))
		}

		const rendered = component({ onCompleted })

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
					<Button tabindex={1} ref={buttonRef!} onclick={() => onCompleted(defaultValue)}>
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
			position,
			visible: () => true,
			setVisible: () => {},
			closeOnOutsideClick: false,
			closeOnEscape: false,
		})
		createEffect(() => {
			if (disposed!()) {
				setOutput({ out: defaultValue })
			}
		})
	})

	await myUntil(() => output() !== null)
	disposeOwner()
	return output()!.out
}
