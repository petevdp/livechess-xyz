import { Show, createEffect, createSignal } from 'solid-js'

import * as Svgs from '~/components/Svgs.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx'
import { Input } from '~/components/ui/input.tsx'
import { Label } from '~/components/ui/label.tsx'
import { Choice, MultiChoiceButton } from '~/components/utils/MultiChoiceButton.tsx'
import * as P from '~/systems/player.ts'

export function SettingsDialog() {
	const [nickname, setNickname] = createSignal('')
	const [submitted, setSubmitted] = createSignal(false)
	createEffect(() => {
		if (P.settings.name) {
			setNickname(P.settings.name!)
		}
	})

	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		if (submitted()) return
		P.settings.name = nickname().trim()
		setSubmitted(true)
		// hacky but better than overriding default dialog behavior
		triggerButtonRef?.click()
		triggerButtonRef?.blur()
	}

	// eslint-disable-next-line prefer-const
	let triggerButtonRef: HTMLButtonElement | null = null

	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) {
					setNickname(P.settings.name!)
					setSubmitted(false)
				}
			}}
		>
			<DialogTrigger>
				<Button ref={triggerButtonRef!} size="icon" variant="ghost">
					<Svgs.Settings />
				</Button>
			</DialogTrigger>
			<DialogContent class="sm:max-w-[425px]">
				<form onSubmit={onSubmit}>
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<div class="grid gap-4 py-4">
						<div class="flex w-full items-center justify-between space-x-2">
							<Label for="nickname">Nickname</Label>
							<Input
								required={true}
								pattern={'[a-zA-Z0-9 ]+'}
								id="nickname"
								value={nickname()}
								disabled={submitted()}
								onchange={(e) => setNickname(e.target.value)}
							/>
						</div>
						<div class="flex w-full items-center justify-between space-x-2">
							<Label class="text-right">Touch Offset Direction</Label>
							<Show when={P.settings.usingTouch}>
								<MultiChoiceButton
									listClass="flex"
									choices={
										[
											{ label: 'Left', id: 'left' },
											{ label: 'None', id: 'none' },
											{ label: 'Right', id: 'right' },
										] satisfies Choice<P.PlayerSettings['touchOffsetDirection']>[]
									}
									selected={P.settings.touchOffsetDirection}
									onChange={(id) => (P.settings.touchOffsetDirection = id)}
								/>
							</Show>
						</div>
					</div>
					<DialogFooter>
						<Button type="submit" value="Submit">
							Save changes
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
