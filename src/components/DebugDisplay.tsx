import { FloatingElement } from '@floating-ui/dom'
import stringifyCompact from 'json-stringify-pretty-compact'
import { useFloating } from 'solid-floating-ui'
import { AiFillBug, AiFillMinusCircle } from 'solid-icons/ai'
import { For, Show, batch, createEffect, createMemo, createRenderEffect, on, onMount } from 'solid-js'
import { createSignal } from 'solid-js'
import { onCleanup } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

import { cn } from '~/lib/utils'
import * as DS from '~/systems/debugSystem'
import { makePersistedStore } from '~/utils/makePersisted'
import { trackAndUnwrap } from '~/utils/solid'

import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

type Coords = { x: number; y: number }
type DebugDisplayDetails = {
	coords: Coords
	dimensions: Coords
	visible: boolean
}

const [displayState, setDisplayState] = makePersistedStore('debugDisplays', {} as Record<string, DebugDisplayDetails | undefined>)
const [windowOrder, setWindowOrder] = makePersistedStore('debugWindowOrder', [] as string[])

const [resetCounter, reset] = createSignal(0)
//@ts-expect-error
window.resetDebugDisplays = () => {
	for (const key of DS.debugKeys()) {
		setDisplayState(key, { coords: { x: 0, y: 0 }, dimensions: { x: 400, y: 200 }, visible: true })
	}
}

export default function DebugDisplays() {
	createRenderEffect(
		on(
			() => {
				resetCounter()
				return DS.debugKeys()
			},
			(keys) => {
				for (const key of keys) {
					if (!displayState[key]) {
						setDisplayState([key], { coords: { x: 0, y: 0 }, dimensions: { x: 400, y: 200 }, visible: true })
					}
					if (!windowOrder.includes(key)) {
						setWindowOrder(windowOrder.length, key)
					}
				}
			}
		)
	)

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button size={'icon'} variant="ghost">
						<AiFillBug />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent class="w-56">
					<For each={DS.debugKeys()} fallback={<DropdownMenuItem>(empty)</DropdownMenuItem>}>
						{(key) => (
							<DropdownMenuCheckboxItem
								checked={displayState[key]!.visible}
								onChange={() => {
									console.log('changed')
									setDisplayState(key, 'visible', (s) => !s)
								}}
							>
								{key}
							</DropdownMenuCheckboxItem>
						)}
					</For>
				</DropdownMenuContent>
			</DropdownMenu>
			<For each={DS.debugKeys()}>
				{(key) => (
					<Show when={displayState[key]!.visible}>
						<DebugWindow key={key} />
					</Show>
				)}
			</For>
		</>
	)
}

export type DebugWindow = {
	key: string
}

export function DebugWindow(props: DebugWindow) {
	const [floating, setFloating] = createSignal(undefined as unknown as FloatingElement)
	const [dragging, setDragging] = createSignal(false)
	const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 })
	const windowCoords = () => displayState[props.key]!.coords
	const updateWindowFromCursor = (cursorCoords: Coords) => {
		setDisplayState(props.key, 'coords', { x: cursorCoords.x - dragOffset().x, y: cursorCoords.y - dragOffset().y })
	}
	createEffect(() => {
		console.log('coords', trackAndUnwrap(windowCoords()))
	})

	const bringToFront = () => {
		const index = windowOrder.indexOf(props.key)
		if (index === windowOrder.length - 1) return
		setWindowOrder((order) => {
			const newOrder = [...order]
			newOrder.splice(index, 1)
			newOrder.push(props.key)
			return newOrder
		})
	}

	const referenceEl = createMemo(() => {
		const floatingWindowX = windowCoords().x
		const floatingWindowY = windowCoords().y
		// calculate cursor offset from window
		return {
			getBoundingClientRect() {
				return {
					// x: floatingWindowX,
					// y: floatingWindowY,
					top: floatingWindowY,
					left: floatingWindowX,
					// bottom: floatingWindowY,
					// right: floatingWindowX,
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
		updateWindowFromCursor({ x: evt.clientX, y: evt.clientY })
	}

	function mouseDownListener(evt: MouseEvent) {
		// check if we're clicking anywhere in the window
		if (!floating().contains(evt.target as Node)) return
		if (!floatingWindowBarRef.contains(evt.target as Node) && !evt.altKey) return

		const rect = floating().getBoundingClientRect()
		setDragOffset({ x: evt.clientX - rect.left, y: evt.clientY - rect.top })

		batch(() => {
			updateWindowFromCursor({ x: evt.clientX, y: evt.clientY })
			setDragging(true)
			bringToFront()
		})

		document.body.style.cursor = 'grabbing'
	}

	function mouseUpListener() {
		setDragging(false)
		setDragOffset({ x: 0, y: 0 })
		document.body.style.cursor = ''
	}

	onMount(() => {
		document.addEventListener('mousemove', moveListener)
		document.addEventListener('mousedown', mouseDownListener)
		document.addEventListener('mouseup', mouseUpListener)
	})
	onCleanup(() => {
		document.removeEventListener('mousemove', moveListener)
		document.removeEventListener('mousedown', mouseDownListener)
		document.removeEventListener('mouseup', mouseUpListener)
		document.removeEventListener('mouseleave', mouseUpListener)
	})

	return (
		<div
			class={cn(
				'flex flex-col absolute rounded-lg border shadow-sm bg-card z-50 min-w-0  min-h-0 max-h-[80vh] max-w-[80vw]',
				dragging() ? 'select-none' : ''
			)}
			ref={setFloating}
			style={{
				position: position.strategy,
				top: `${position.y ?? 0}px`,
				left: `${position.x ?? 0}px`,
				'z-index': 25 + windowOrder.indexOf(props.key),
			}}
		>
			<div class="flex flex-col min-h-0 min-w-0">
				<div ref={floatingWindowBarRef} class="bg-gray-950 py-2 cursor-grab flex select-none justify-between items-center p-2">
					<h3>{props.key}</h3>
					<Button
						size="icon"
						class="minus-button"
						variant="ghost"
						onmousedown={(e) => {
							console.log('click')
							setDisplayState(props.key, 'visible', false)
							e.stopPropagation()
						}}
					>
						<AiFillMinusCircle />
					</Button>
				</div>
				<pre class="flex-grow w-max h-max min-h-0 min-w-0 overflow-auto">
					<code>{stringifyCompact(trackAndUnwrap(DS.values[props.key] || {}))}</code>
				</pre>
			</div>
		</div>
	)
}
