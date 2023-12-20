import { Route, Router } from '@solidjs/router'
import { createSignal, onMount, Show } from 'solid-js'
import * as P from './systems/player.ts'
import { RoomGuard } from './components/Room.tsx'
import { Home } from './components/Home.tsx'

function App() {
	const [init, setInit] = createSignal(false)
	onMount(async () => {
		await P.setupPlayer()
		setInit(true)
	})

	return (
		<Show when={init()} fallback={<div>loading...</div>}>
			<Router>
				<Route path="/" component={Home} />
				<Route path="/room/:id" component={RoomGuard} />
			</Router>
		</Show>
	)
}

export default App
