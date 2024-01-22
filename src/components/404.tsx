import { AppContainer, ScreenFittingContent } from '~/components/AppContainer.tsx';
import { Callout, CalloutContent, CalloutTitle } from '~/components/ui/callout.tsx'


export default function NotFound() {
	return (
		<AppContainer>
			<ScreenFittingContent class="grid place-items-center">
				<Callout variant="error">
					<CalloutTitle>Not Found</CalloutTitle>
					<CalloutContent>If you were connecting to a game, the game may no longer exist or there may be an error in
						your URL.</CalloutContent>
				</Callout>
			</ScreenFittingContent>
		</AppContainer>
	)
}
