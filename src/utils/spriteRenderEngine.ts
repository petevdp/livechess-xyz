import { Subject, filter, firstValueFrom, map } from 'rxjs'

import { OneToManyMap, otmAdd } from './oneToManyMap'

export type SpriteTemplate = {
	draw(ctx: CanvasRenderingContext2D, sprite: Sprite, args?: any): void
}

export type SpriteRenderEngineConfig = {
	spriteTypes: { [key: string]: SpriteTemplate }
}

export type Sprite = {
	x: number
	y: number
	size: number
	zIndex: number
	args: any
	moveAnimation?: {
		startFrame: bigint
		start: Coords
		dest: Coords
		duration: number
		// set every running frame during update call
		// TODO can add curve here to control acceleration
	}
}

export type Coords = { x: number; y: number }

export type EngineEvent = {
	type: 'animation-end' | 'animation-cancelled'
	spriteIndex: number
}
export class SpriteRenderEngine<S extends Sprite = Sprite> {
	sprites: [string, S][] = []
	zIndexMap = new Map() as OneToManyMap<number, number>
	frame = 0n
	animsRunning = 0
	event$ = new Subject<EngineEvent>()
	get isRunning() {
		return this.animsRunning > 0
	}
	constructor(
		public config: SpriteRenderEngineConfig,
		private ctx: CanvasRenderingContext2D
	) {
		this._run = this._run.bind(this)

		this.event$.subscribe((e) => {
			if (e.type === 'animation-end' || e.type === 'animation-cancelled') {
				this.animsRunning -= 1
			}
		})
	}

	run() {
		this.frame = 0n
		this._run()
	}

	private _run() {
		if (!this.isRunning) return
		this.update()
		this.draw()
		this.frame++
		requestAnimationFrame(this._run)
	}

	addOne(key: string, sprite: S) {
		return this.add([[key, sprite]])[0]
	}

	add(sprites: [string, S][]) {
		const indexes = new Array(sprites.length)
		for (let i = 0; i < sprites.length; i++) {
			const [key, sprite] = sprites[i]
			this.sprites.push([key, sprite])
			const index = this.sprites.length - 1
			otmAdd(sprite.zIndex, index, this.zIndexMap)
			indexes[i] = index
		}
		return indexes
	}
	*spritesByZIndex() {
		const zIndexes = Array.from(this.zIndexMap.keys()).sort((a, b) => a - b)

		for (const zIndex of zIndexes) {
			for (const spriteIndex of this.zIndexMap.get(zIndex)!) {
				yield [spriteIndex, ...this.sprites[spriteIndex]] as const
			}
		}
	}

	update() {
		for (const [spriteIndex, _, sprite] of this.spritesByZIndex()) {
			if (sprite.moveAnimation) {
				const distanceToDestX = sprite.moveAnimation.dest.x - sprite.moveAnimation.start.x
				const distanceToDestY = sprite.moveAnimation.dest.y - sprite.moveAnimation.start.y
				const stepX = distanceToDestX / sprite.moveAnimation.duration
				const stepY = distanceToDestY / sprite.moveAnimation.duration

				const stepCount = this.frame - sprite.moveAnimation.startFrame
				if (stepCount !== 0n) {
					const beforeStepX = Math.abs(sprite.moveAnimation.start.x + stepX * (Number(stepCount) - 1) - sprite.moveAnimation.dest.x)
					const afterStepX = Math.abs(sprite.x + stepX * Number(stepCount) - sprite.moveAnimation.dest.x)
					const beforeStepY = Math.abs(sprite.moveAnimation.start.y + stepY * (Number(stepCount) - 1) - sprite.moveAnimation.dest.y)
					const afterStepY = Math.abs(sprite.moveAnimation.start.y + stepY * Number(stepCount) - sprite.moveAnimation.dest.y)

					if (beforeStepX / beforeStepX !== afterStepX / afterStepX || beforeStepY / beforeStepY !== afterStepY / afterStepY) {
						// we have passed the destination
						sprite.x = sprite.moveAnimation!.dest.x
						sprite.y = sprite.moveAnimation!.dest.y
						delete sprite.moveAnimation
						this.event$.next({ type: 'animation-end', spriteIndex: spriteIndex })
					} else {
						sprite.x += stepX
						sprite.y += stepY
					}
				}
			}
		}
	}

	draw() {
		this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
		for (const [_, spriteType, sprite] of this.spritesByZIndex()) {
			const template = this.config.spriteTypes[spriteType]
			template.draw(this.ctx, sprite)
		}
	}

	move(index: number, dest: Coords) {
		const [_, sprite] = this.sprites[index]
		if (sprite.moveAnimation) {
			// cancel animation
			delete sprite.moveAnimation
			this.event$.next({ type: 'animation-cancelled', spriteIndex: index })
		}
		sprite.x = dest.x
		sprite.y = dest.y
		this.draw()
		return true
	}

	async moveAnimated(index: number, dest: Coords, durationFrames: number) {
		if (durationFrames <= 0) throw new Error('duration must be greater than 0')
		const [_, sprite] = this.sprites[index]
		sprite.moveAnimation = { startFrame: this.frame, duration: durationFrames, dest, start: { x: sprite.x, y: sprite.y } }
		const animationCompletedPromise = firstValueFrom(
			this.event$.pipe(
				filter((e) => (e.type === 'animation-end' || e.type === 'animation-cancelled') && e.spriteIndex === index),
				map((e) => e.type === 'animation-end')
			),
			{
				defaultValue: false,
			}
		)
		this.animsRunning += 1
		if (this.animsRunning === 1) this.run()
		return await animationCompletedPromise
	}
}
