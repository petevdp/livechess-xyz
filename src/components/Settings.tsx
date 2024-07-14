import { Show, createSignal } from 'solid-js'

import * as Svgs from '~/components/Svgs.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx'
import { Input } from '~/components/ui/input.tsx'
import { Label } from '~/components/ui/label.tsx'
import { Switch } from '~/components/ui/switch.tsx'
import { Choice, MultiChoiceButton } from '~/components/utils/MultiChoiceButton.tsx'
import * as P from '~/systems/player.ts'

export function SettingsDialog() {
	const [nickname, setNickname] = createSignal(P.settings.name ?? '')
	const [open, setOpen] = createSignal(false)
	// eslint-disable-next-line prefer-const
	let nickFormRef: HTMLFormElement = null as unknown as HTMLFormElement

	function close() {
		if (nickFormRef?.reportValidity()) {
			P.settings.name = nickname().trim()
			setOpen(false)
		}
	}
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') close()
	}

	return (
		<Dialog
			open={open()}
			onOpenChange={(open) => {
				if (!open) {
					close()
					return
				} else if (P.playerId() === null) {
					return
				}
				setNickname(P.settings.name ?? '')
				setOpen(open)
			}}
		>
			<DialogTrigger>
				<Button size="icon" variant="ghost" disabled={P.playerId() === null}>
					<Svgs.Settings />
				</Button>
			</DialogTrigger>
			<DialogContent class="sm:max-w-[425px]" onkeydown={onKeyDown}>
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>
				{/*set tabindex so we don't automatically focus the nickname, opening the keyboard on mobile devices*/}
				<div tabindex={0} class="grid gap-4 py-4">
					<div class="flex w-full items-center justify-between space-x-2">
						<Label for="nickname">Nickname</Label>
						<form
							onSubmit={(e) => {
								e.preventDefault()
							}}
							ref={nickFormRef}
						>
							<Input
								required={true}
								pattern={'[a-zA-Z0-9 ]+'}
								min={3}
								name="nickname"
								id="nickname"
								value={nickname()}
								oninput={(e) => setNickname(e.target.value)}
							/>
						</form>
					</div>
					<div>
						<Switch
							label="Show Available Moves"
							checked={P.settings.showAvailablemoves}
							onChange={(changed) => {
								return (P.settings.showAvailablemoves = changed)
							}}
						/>
					</div>
					<Show when={P.settings.usingTouch}>
						<div class="flex w-full items-center justify-between space-x-2">
							<Label class="text-right">Touch Offset Direction</Label>
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
						</div>
						<div class="flex w-full items-center justify-between space-x-2">
							<Switch label="Vibrate" checked={P.settings.vibrate} onChange={(changed) => (P.settings.vibrate = changed)} />
						</div>
					</Show>
				</div>
				<Button onclick={close}>Close</Button>
			</DialogContent>
		</Dialog>
	)
}
