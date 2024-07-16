import { ColorMode, ColorModeProvider, ColorModeScript } from '@kobalte/core'
import { Navigate, Route, Router } from '@solidjs/router'
import { ErrorBoundary, JSXElement, Show, Suspense, createEffect, createSignal, lazy, onMount } from 'solid-js'
import { Toaster } from 'solid-toast'

import NotFound from '~/components/404.tsx'
import { AppContainer, ScreenFittingContent } from '~/components/AppContainer.tsx'
import { Spinner } from '~/components/Spinner.tsx'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '~/components/ui/alert-dialog.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Callout, CalloutContent, CalloutTitle } from '~/components/ui/callout.tsx'
import * as Errors from '~/systems/errors.ts'
import * as GlobalLoading from '~/systems/globalLoading.ts'

import { Home } from './components/Home.tsx'

const RoomGuard = lazy(() => import('~/components/RoomGuard.tsx'))

function App() {
	const [displayedError, setDisplayedError] = createSignal<Errors.FatalError | null>(null)
	onMount(() => {
		document.getElementById('loader')?.remove()
		document.getElementById('root')?.classList.remove('hidden')
		document.querySelector('body')?.classList.remove('loading')
	})
	createEffect(() => {
		if (Errors.fatalError()) {
			setDisplayedError(Errors.fatalError())
			GlobalLoading.clear()
		}
	})

	const dismissError = () => {
		Errors.shiftFatalError()
		setDisplayedError(null)
	}

	function ErrorHandled(Component: () => JSXElement) {
		return () => (
			<ErrorBoundary fallback={(e) => <GenericErrorScreen error={e} />}>
				<Component />
			</ErrorBoundary>
		)
	}

	const spinner = (
		<ScreenFittingContent class="grid place-items-center">
			<Spinner />
		</ScreenFittingContent>
	)

	// we're not handling errors that occur above this error boundary, do don't put anything too crazy in <App />
	return (
		<>
			<ColorModeScript storageType="localStorage" />
			<ColorModeProvider
				storageManager={{
					type: 'localStorage',
					ssr: false,
					get: (fallback: 'light' | 'dark' | 'system' | undefined) =>
						(localStorage.getItem('colorMode') as ColorMode) || fallback || 'dark',
					set: (value: 'light' | 'dark' | 'system') => localStorage.setItem('colorMode', value),
				}}
			>
				<Router>
					<Route path="/" component={ErrorHandled(Home)} />
					<Route
						path="/rooms/:id"
						component={ErrorHandled(() => (
							<Suspense fallback={spinner}>
								<RoomGuard />
							</Suspense>
						))}
					/>
					<Route
						path="/404"
						component={ErrorHandled(() => (
							<NotFound />
						))}
					/>
					<Route path="*" component={() => <Navigate href="/404" />} />
				</Router>
			</ColorModeProvider>
			<Toaster position="bottom-left" />
			<AlertDialog
				open={!!displayedError()}
				onOpenChange={(open) => {
					if (open) return
					dismissError()
				}}
			>
				<AlertDialogContent>
					<AlertDialogTitle>{Errors.fatalError()?.title}</AlertDialogTitle>
					<AlertDialogDescription>{Errors.fatalError()?.message}</AlertDialogDescription>
					<Button class="w-max" onclick={dismissError}>
						Dismiss
					</Button>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

function GenericErrorScreen(props: { error: Error }) {
	const [showError, setShowError] = createSignal(false)
	onMount(() => {
		console.error(props.error)
		GlobalLoading.clear()
	})
	return (
		<AppContainer>
			<ScreenFittingContent class="grid place-items-center">
				<Callout variant={'error'}>
					<CalloutTitle>Something Went Wtrong</CalloutTitle>
					<CalloutContent class="flex flex-col min-h-max">
						Something broke. Please try again later.
						<Show
							when={showError()}
							fallback={
								<Button variant="secondary" onclick={() => setShowError(true)}>
									Show Error
								</Button>
							}
						>
							<pre class="flex flex-col text-left p-2">
								<code>{props.error.message}</code>
								<br />
								<code>{props.error.stack}</code>
							</pre>
						</Show>
					</CalloutContent>
				</Callout>
			</ScreenFittingContent>
		</AppContainer>
	)
}

export default App
