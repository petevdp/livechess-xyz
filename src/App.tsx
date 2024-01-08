import { Route, Router } from '@solidjs/router'
import { onMount } from 'solid-js'
import * as P from './systems/player.ts'
import { Home } from './components/Home.tsx'
import { Toaster } from 'solid-toast'
import { RoomGuard } from './components/RoomGuard.tsx'

function App() {
	onMount(async () => {
		await P.setupPlayer()
	})

	return (
		<>
			<Toaster />
			<Router>
				<Route path="/" component={Home} />
				<Route path="/rooms/:id" component={RoomGuard} />
			</Router>
		</>
	)
}

export default App
