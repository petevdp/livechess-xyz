import { Route, Router } from '@solidjs/router'
import { onMount } from 'solid-js'
import * as P from './systems/player.ts'
import { RoomGuard } from './components/Room.tsx'
import { Home } from './components/Home.tsx'
import { Toaster } from 'solid-toast'

function App() {
	onMount(async () => {
		await P.setupPlayer()
	})

	return (
		<>
			<Toaster />
			<Router>
				<Route path="/" component={Home} />
				<Route path="/room/:id" component={RoomGuard} />
			</Router>
		</>
	)
}

export default App
