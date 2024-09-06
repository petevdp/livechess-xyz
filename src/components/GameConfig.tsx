import { debounceTime, from as rxFrom, skip } from 'rxjs'
import { For, JSX, Show, createEffect, createMemo, createSignal, observable, on, onCleanup } from 'solid-js'

import * as Svgs from '~/components/Svgs.tsx'
import { VariantInfoDialog } from '~/components/VariantInfoDialog.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Input } from '~/components/ui/input.tsx'
import { Label } from '~/components/ui/label.tsx'
import { NumberField, NumberFieldDecrementTrigger, NumberFieldIncrementTrigger, NumberFieldInput } from '~/components/ui/number-field.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip.tsx'
import { Choice, MultiChoiceButton } from '~/components/utils/MultiChoiceButton.tsx'
import { cn } from '~/lib/utils.ts'
import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import { getPieceSvg } from '~/systems/piece.tsx'
import * as VB from '~/systems/vsBot.ts'

export function GameConfig(props: { ctx: G.GameConfigContext }) {
	const QuestionMark = () => <span class={`p-1 leading-[24px] text-md text-primary underline cursor-pointer`}>?</span>
	const helpCardLabel = (
		<div class="flex justify-center items-center text-inherit">
			<VariantInfoDialog variant={props.ctx.gameConfig.variant}>
				<label>
					Variant <QuestionMark />
				</label>
			</VariantInfoDialog>
		</div>
	)

	const timeControlLabel = (
		<div class="flex justify-center items-center text-inherit">
			<Popover>
				<PopoverTrigger>
					<label>
						Time Control <QuestionMark />
					</label>
				</PopoverTrigger>
				<PopoverContent>
					<div class="flex flex-col space-y-1">
						<span>Each player gets the set amount of time at the start of the game.</span>
						<span>When you run out of time, you lose.</span>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)

	const incrementLabel = (
		<div class="flex justify-center items-center text-inherit">
			<Popover>
				<PopoverTrigger>
					<label>
						Increment <QuestionMark />
					</label>
				</PopoverTrigger>
				<PopoverContent>
					<div class="flex flex-col space-y-1">
						<span>Each time you make a move, you gain the set amount of time.</span>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)

	let fischerRandomConfig: JSX.Element
	{
		const cells = createMemo(() => {
			const pieces: GL.ColoredPiece[] = []
			const pos = GL.getStartPos(props.ctx.gameConfig)

			if (pos.toMove === 'black') throw new Error('toMove should be white')
			for (let colIdx = 0; colIdx < 8; colIdx++) {
				const coord: GL.Coords = { x: colIdx, y: 0 }
				const piece = pos.pieces[GL.notationFromCoords(coord)]
				pieces.push(piece)
			}
			return pieces
		})

		// eslint-disable-next-line prefer-const
		let seedInputRef = null as unknown as HTMLInputElement
		// state is a string instead of a number because we we're checking if the input is a valid integer via the native html input validations
		const [randomSeed, setRandomSeed] = createSignal<string>(props.ctx.gameConfig.fischerRandomSeed.toString())
		const [invalidSeed, setInvalidSeed] = createSignal(false)
		const sub = rxFrom(observable(randomSeed))
			.pipe(skip(1), debounceTime(100))
			.subscribe((seed) => {
				if (seed === props.ctx.gameConfig.fischerRandomSeed.toString()) return
				if (!seedInputRef!.reportValidity()) {
					return
				}
				props.ctx.setGameConfig({ fischerRandomSeed: parseInt(seed) })
			})

		createEffect(
			on(randomSeed, () => {
				setInvalidSeed(!seedInputRef.checkValidity())
			})
		)

		createEffect(
			on(
				() => props.ctx.gameConfig.fischerRandomSeed,
				(seed) => {
					if (seed.toString() !== randomSeed()) setRandomSeed(seed.toString())
				}
			)
		)

		onCleanup(() => {
			sub.unsubscribe()
		})

		fischerRandomConfig = (
			<div class={cn('space-x-2 flex items-center justify-end', props.ctx.gameConfig.variant !== 'fischer-random' ? 'invisible' : '')}>
				<For each={cells()}>
					{(piece) => {
						const Svg = getPieceSvg(piece)
						return <Svg class="w-6 h-6" />
					}}
				</For>
				<form class="flex space-x-1 items-center">
					<Label for="fischer-random-seed">Seed:</Label>
					<Input
						id="fischer-random-seed"
						ref={seedInputRef}
						type="number"
						required
						oninput={(e) => setRandomSeed(e.currentTarget.value)}
						min={0}
						max={959}
						step={1}
						value={randomSeed()?.toString()}
						class={cn('max-w-[75px]', invalidSeed() ? 'border-destructive focus:border-destructive' : '')}
					/>
				</form>
				<Tooltip>
					<TooltipTrigger>
						<Button onclick={() => props.ctx.reseedFischerRandom()} variant="outline" size="icon">
							<Svgs.Flip />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Reseed</TooltipContent>
				</Tooltip>
			</div>
		)
	}
	const choices = (props.ctx.vsBot ? VB.BOT_COMPATIBLE_VARIANTS : GL.VARIANTS) as GL.Variant[]

	return (
		<div class="flex flex-col gap-y-1">
			<Show when={props.ctx.vsBot}>
				<div class="flex items-center space-x-2 mx-auto">
					<Label>Difficulty (1-20)</Label>
					<NumberField
						class="w-36"
						minValue={1}
						maxValue={20}
						onRawValueChange={(value) => {
							props.ctx.setGameConfig({ bot: { difficulty: value } })
						}}
						validationState={!isNaN(props.ctx.gameConfig.bot!.difficulty) ? 'valid' : 'invalid'}
						rawValue={props.ctx.gameConfig.bot!.difficulty}
					>
						<div class="relative">
							<NumberFieldInput />
							<NumberFieldIncrementTrigger />
							<NumberFieldDecrementTrigger />
						</div>
					</NumberField>
				</div>
			</Show>
			<Show when={!props.ctx.vsBot}>
				<MultiChoiceButton
					label={helpCardLabel}
					listClass="grid grid-cols-2 md:grid-cols-4 text-sm space-x-0 gap-1"
					choices={choices.map((c) => ({ label: c, id: c }) satisfies Choice<GL.Variant>)}
					selected={props.ctx.gameConfig.variant}
					onChange={(v) => props.ctx!.setGameConfig({ variant: v })}
					disabled={props.ctx.editingConfigDisabled()}
				/>
				{fischerRandomConfig}
			</Show>
			<MultiChoiceButton
				label={timeControlLabel}
				listClass="grid grid-rows-1 grid-cols-3 w-full tex-sm space-x-0 gap-1"
				choices={GL.TIME_CONTROLS.map((tc) => ({ label: tc, id: tc }) satisfies Choice<GL.TimeControl>)}
				selected={props.ctx.gameConfig.timeControl}
				onChange={(v): void => {
					if (v === 'unlimited') {
						props.ctx.setGameConfig({ increment: '0', timeControl: v })
					} else {
						props.ctx.setGameConfig({ timeControl: v })
					}
				}}
				disabled={props.ctx.editingConfigDisabled()}
			/>
			<MultiChoiceButton
				label={incrementLabel}
				listClass="grid  grid-cols-4 text-sm"
				choices={GL.INCREMENTS.map((i) => ({ label: `${i}s`, id: i }) satisfies Choice<GL.Increment>)}
				selected={props.ctx.gameConfig.increment}
				onChange={(v) => {
					if (props.ctx.gameConfig.timeControl === 'unlimited') return
					props.ctx.setGameConfig({ increment: v })
				}}
				disabled={props.ctx.editingConfigDisabled()}
			/>
		</div>
	)
}
