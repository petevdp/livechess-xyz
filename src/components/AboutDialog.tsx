import { GithubSvg, InfoSvg } from '~/components/Svgs.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx'

export function AboutDialog() {
	return (
		<Dialog>
			<DialogTrigger>
				<Button size="icon" variant="ghost">
					<InfoSvg />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>About</DialogTitle>
					<DialogDescription>
						<a>
							<GithubSvg />
						</a>
					</DialogDescription>
				</DialogHeader>
			</DialogContent>
		</Dialog>
	)
}
