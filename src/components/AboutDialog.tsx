import * as Svgs from '~/components/Svgs.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx'

import styles from './Dialog.module.scss'

export function AboutDialog() {
	return (
		<Dialog>
			<DialogTrigger>
				<Button size="icon" variant="ghost">
					<Svgs.Info />
				</Button>
			</DialogTrigger>
			<DialogContent class={styles.dialogContent}>
				<DialogHeader>
					<DialogTitle>About</DialogTitle>
					<DialogDescription>
						<a href="https://github.com/petevdp/livechess-xyz">
							<Svgs.Github />
						</a>
					</DialogDescription>
				</DialogHeader>
				<div>
					<p>livechess.xyz is a free and open-source chess site.</p>
					<p>The goal is to provide a convenient way to play chess with your friends without requiring sign-ups or accounts of any kind.</p>
					<p>Just paste a link or have your friend scan a QR code and you're ready to play.</p>
					<p>
						If you have any questions, concerns bug reports or feature requests please create an issue here:
						<a class="link" href={'https://github.com/petevdp/livechess-xyz/issues'}>
							https://github.com/petevdp/livechess-xyz/issues
						</a>
					</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}
