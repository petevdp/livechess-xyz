import * as P from '~/systems/player.ts'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '~/components/ui/dialog.tsx'
import { Button } from '~/components/ui/button.tsx'
import SettingsSvg from '~/assets/icons/settings.svg'
import { Label } from '~/components/ui/label.tsx'
import { Input } from '~/components/ui/input.tsx'
import { createEffect, createSignal } from 'solid-js'

export function SettingsDialog() {
	const [nickname, setNickname] = createSignal('')
	const [submitted, setSubmitted] = createSignal(false)
	createEffect(() => {
		if (P.playerName()) {
			setNickname(P.playerName()!)
		}
	})

	const onSubmit = (e: SubmitEvent) => {
		e.preventDefault()
		if (submitted()) return
		P.setPlayerName(nickname().trim())
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
					setNickname(P.playerName()!)
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
						<DialogDescription>Make changes to your profile here. Click save when you're done.</DialogDescription>
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
