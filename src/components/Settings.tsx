import { createEffect, createSignal } from 'solid-js';



import SettingsSvg from '~/assets/icons/settings.svg';
import { Button } from '~/components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx';
import { Input } from '~/components/ui/input.tsx';
import { Label } from '~/components/ui/label.tsx';
import { MultiChoiceButton } from '~/components/utils/MultiChoiceButton.tsx';
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
		P.setSettings({ name: nickname().trim() })
		setSubmitted(true)
		// hacky but better than overriding default dialog behavior
		triggerButtonRef?.click()
		triggerButtonRef?.blur()
	}

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
					<SettingsSvg />
				</Button>
			</DialogTrigger>
			<DialogContent
				class="sm:max-w-[425px]"
				onEscapeKeyDown={() => {
					console.log('requesting submit')
				}}
			>
				<form onSubmit={onSubmit}>
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<div class="grid gap-4 py-4">
						<div class="grid grid-cols-4 items-center gap-4">
							<Label for="nickname" class="text-right">
								Display Name
							</Label>
							<Input
								required={true}
								pattern={'[a-zA-Z0-9 ]+'}
								id="nickname"
								value={nickname()}
								class="col-span-3"
								disabled={submitted()}
								onchange={(e) => setNickname(e.target.value)}
							/>
						</div>
						<div class="grid grid-cols-4 items-center gap-4">
							<Label class="text-right">Touch Offset Direction</Label>
							<MultiChoiceButton
								containerClass="grid-cols-4 grid grid-cols-4 items-center gap-4"
								listClass="flex"
								choices={[
									{label: 'Left', id: 'left'},
									{label: 'Right', id: 'right'},
								]}
								selected={P.settings.touchOffsetDirection}
								onChange={(id) => P.setSettings({touchOffsetDirection: id})}
							/>
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
