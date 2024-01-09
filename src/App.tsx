import { Route, Router } from '@solidjs/router'
import { onMount } from 'solid-js'
import * as P from './systems/player.ts'
import { Home } from './components/Home.tsx'
import { Toaster } from 'solid-toast'
import { RoomGuard } from './components/RoomGuard.tsx'
import { ColorMode, ColorModeProvider, ColorModeScript } from '@kobalte/core'

function App() {
	onMount(async () => {
		await P.setupPlayer()
	})

	return (
		<>
			<ColorModeScript storageType="localStorage" />
			<ColorModeProvider
				storageManager={{
					type: 'localStorage',
					ssr: false,
					get: (fallback: 'light' | 'dark' | 'system' | undefined) => (localStorage.getItem('colorMode') as ColorMode) || fallback,
					set: (value: 'light' | 'dark' | 'system') => localStorage.setItem('colorMode', value),
				}}
			>
				<Toaster />
				<Router>
					<Route path="/" component={Home} />
					<Route path="/rooms/:id" component={RoomGuard} />
				</Router>
			</ColorModeProvider>
		</>
	)
}

export default App
