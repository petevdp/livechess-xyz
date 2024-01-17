import { ColorMode, ColorModeProvider, ColorModeScript } from '@kobalte/core'
import { Route, Router } from '@solidjs/router'
import { onMount } from 'solid-js'
import { Toaster } from 'solid-toast'

import { Home } from './components/Home.tsx'
import { RoomGuard } from './components/RoomGuard.tsx'
import * as Agent from './systems/agent.ts'
import * as Pieces from './systems/piece.tsx'
import * as P from './systems/player.ts'


function App() {
	onMount(async () => {
		await P.setupPlayer()
	})

	Agent.setupAgentSystem()
	Pieces.initPieceSystem()

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
				<Toaster />
				<Router>
					<Route path="/" component={Home} />
					<Route path="/rooms/:id" component={RoomGuard} />
				</Router>
			</ColorModeProvider>
			<Toaster />
		</>
	)
}

export default App
