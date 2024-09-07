import { onMount } from 'solid-js'

import { Button } from '~/components/ui/button'
import { SpriteRenderEngine, SpriteRenderEngineConfig } from '~/utils/spriteRenderEngine'

const spriteConfig: SpriteRenderEngineConfig = {
	spriteTypes: {
		square: {
			draw(ctx, sprite) {
				ctx.fillStyle = sprite.args.color
				ctx.fillRect(sprite.x, sprite.y, sprite.size, sprite.size)
				ctx.stroke()
			},
		},
	},
}

export function Canvas() {
	// eslint-disable-next-line prefer-const
	let canvasRef: HTMLCanvasElement = null as unknown as HTMLCanvasElement
	onMount(() => {
		document.getElementById('loader')?.remove()
		document.getElementById('root')?.classList.remove('hidden')
		document.querySelector('body')?.classList.remove('loading')
	})
	let engine: SpriteRenderEngine
	let squareIdx: number = -1
	onMount(() => {
		const ctx = canvasRef.getContext('2d')!
		engine = new SpriteRenderEngine(spriteConfig, ctx)
		squareIdx = engine.addOne('square', { x: 100, y: 100, zIndex: 1, size: 50, args: { color: 'red' } })
		engine.addOne('square', { x: 120, y: 120, zIndex: 0, size: 50, args: { color: 'blue' } })
		engine.draw()
	})

	async function onStart() {
		const success = await engine.moveAnimated(squareIdx, { x: 60, y: 120 }, 25)

		if (success) {
			engine.moveAnimated(squareIdx, { x: 200, y: 200 }, 50)
		}
	}

	return (
		<div class="flex flex-col h-full w-full">
			<div class="flex-grow">
				<canvas ref={canvasRef} width={500} height={500} />
			</div>
			<div class="flex items-center">
				<Button onClick={onStart}>Start</Button>
			</div>
		</div>
	)
}
