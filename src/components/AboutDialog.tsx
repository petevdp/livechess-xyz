import * as Svgs from '~/components/Svgs.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx'


// TODO fill out about page
export function AboutDialog() {
	return (
		<Dialog>
			<DialogTrigger>
				<Button size="icon" variant="ghost">
					<Svgs.Info />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>About</DialogTitle>
					<DialogDescription>
						<a>
							<Svgs.Github />
						</a>
					</DialogDescription>
				</DialogHeader>
			</DialogContent>
		</Dialog>
	)
}
