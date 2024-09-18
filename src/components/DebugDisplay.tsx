import { FloatingElement } from '@floating-ui/dom'
import { useFloating } from 'solid-floating-ui'
import { AiFillBug } from 'solid-icons/ai'
import { For, batch, createMemo, onMount } from 'solid-js'
import { createSignal } from 'solid-js'
import { onCleanup } from 'solid-js'

import * as DS from '~/systems/debugSystem'
import { makePersistedStore } from '~/utils/makePersisted'
import { trackAndUnwrap } from '~/utils/solid'

import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'

type Coords = { x: number; y: number }
type DebugDisplayDetails = {
	coords: Coords
	dimensions: Coords
	visible: boolean
}

const [displayState, setDisplayState] = makePersistedStore('debugDisplays', {} as Record<string, DebugDisplayDetails | undefined>)

export default function DebugDisplays() {
	const [selectedKey, setSelectedKey] = createSignal('<none>')
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button size={'icon'} variant="ghost">
						<AiFillBug />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent class="w-56">
					<For each={DS.debugKeys()}>
						{(key) => (
							<DropdownMenuCheckboxItem checked={selectedKey() === key} onClick={() => setSelectedKey(key)}>
								{key}
							</DropdownMenuCheckboxItem>
						)}
					</For>
				</DropdownMenuContent>
			</DropdownMenu>
			<For each={DS.debugKeys()}>{(key) => <DebugDisplay key={key} />}</For>
		</>
	)
}

export type DebugDisplayProps = {
	key: string
}

export function DebugDisplay(props: DebugDisplayProps) {
	const [floating, setFloating] = createSignal(undefined as unknown as FloatingElement)
	const [dragging, setDragging] = createSignal(false)

	if (!displayState[props.key]) setDisplayState([props.key], { coords: { x: 0, y: 0 }, dimensions: { x: 400, y: 200 }, visible: true })

	const clientCoords = () => displayState[props.key]!.coords
	const setClientCoords = (coords: Coords) => setDisplayState(props.key, 'coords', coords)
	// const windowDimensions = () => displayState[props.key]!.dimensions
	// const setWindowDimensions = (dimensions: Coords) => setDisplayState(props.key, 'dimensions', dimensions)

	const referenceEl = createMemo(() => {
		const floatingWindowX = clientCoords().x
		const floatingWindowY = clientCoords().y
		return {
			getBoundingClientRect() {
				return {
					x: floatingWindowX,
					y: floatingWindowY,
					top: floatingWindowY,
					left: floatingWindowX,
					bottom: floatingWindowY,
					right: floatingWindowX,
					width: 0,
					height: 0,
				}
			},
		}
	})

	// eslint-disable-next-line prefer-const
	let floatingWindowBarRef = null as unknown as HTMLDivElement
	// const [referenceEl, setReferenceEl] = createSignal({
	// 	getBoundingClientRect() {
	// 		return {
	// 			x: 0,
	// 			y: 0,
	// 			top: 200,
	// 			left: 200,
	// 			bottom: 20,
	// 			right: 20,
	// 			width: WIDTH,
	// 			height: HEIGHT,
	// 		}
	// 	},
	// })

	const position = useFloating(referenceEl, floating)
	async function moveListener(evt: MouseEvent) {
		if (!dragging()) return
		setClientCoords({ x: evt.clientX, y: evt.clientY })
	}

	function mouseDownListener(evt: MouseEvent) {
		batch(() => {
			setClientCoords({ x: evt.clientX, y: evt.clientY })
			setDragging(true)
		})

		floatingWindowBarRef.style.cursor = 'grabbing'
	}

	function mouseUpListener() {
		setDragging(false)
		floatingWindowBarRef.style.cursor = ''
	}

	onMount(() => {
		document.addEventListener('mousemove', moveListener)
		floatingWindowBarRef.addEventListener('mousedown', mouseDownListener)
		document.addEventListener('mouseup', mouseUpListener)
	})
	onCleanup(() => {
		document.removeEventListener('mousemove', moveListener)
		floatingWindowBarRef.removeEventListener('mousedown', mouseDownListener)
		document.removeEventListener('mouseup', mouseUpListener)
		document.removeEventListener('mouseleave', mouseUpListener)
	})

	return (
		<div
			class="flex flex-col rounded-lg border shadow-sm bg-card select-none w-[400px] h-[200px]"
			ref={setFloating}
			style={{
				position: position.strategy,
				top: `${position.y ?? 0}px`,
				left: `${position.x ?? 0}px`,
			}}
		>
			<div ref={floatingWindowBarRef} class="bg-gray-950 py-2 cursor-grab">
				<pre>
					<code>{JSON.stringify(trackAndUnwrap(displayState[props.key] || {}), null, 2)}</code>
				</pre>
			</div>
			<div>content</div>
		</div>
	)
}
