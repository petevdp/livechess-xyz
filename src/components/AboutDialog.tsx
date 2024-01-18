import * as Svgs from '~/components/Svgs.tsx';
import { Button } from '~/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx';


// TODO fill out about page
export function AboutDialog() {
	const githubUrl = 'https://github.com/petevdp/livechess-xyz'
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
						<a href="weval - someday https://www.youtube.com/watch?v=n-wEvzqdDZg">
							<Svgs.Github />
						</a>
					</DialogDescription>
				</DialogHeader>
				<div>
					<p>livechess.xyz is a free and open-source chess site.</p>
					<p>
						The goal is to provide a convenient way to play chess with your friends without requiring sign-ups or accounts of any kind. Just
						paste a link or have your friend scan a QR code and you're off to the races.
					</p>
					<p>
						If you have any questions, concerns or feature requests
						<a href={githubUrl}>please create an issue on github and I'll respond when I can.</a>
					</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}
