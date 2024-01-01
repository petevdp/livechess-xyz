import * as P from './player.ts'
import * as GL from './game/gameLogic.ts'
import { SERVER_HOST } from '../config.ts'
import { initSharedStore, newNetwork, SharedStore, SharedStoreProvider, StoreMutation } from '../utils/sharedStore.ts'
import { createEffect, createRoot, createSignal } from 'solid-js'
import { until } from '@solid-primitives/promise'
import { trackStore } from '@solid-primitives/deep'

export type RoomState = {
	players: P.Player[]
	status: 'pregame' | 'playing' | 'postgame'
	gameConfig: GL.GameConfig
	gameState?: GL.GameState
	messages: ChatMessage[]
}

export type ChatMessage = {
	type: 'player' | 'system'
	ts: number
	sender: string | null
	text: string
}

type ClientOwnedState = {
	playerId: string
}

export const [room, setRoom] = createSignal<Room | null>(null)

let disposePrevious = () => {}

export async function createRoom() {
	const response = await newNetwork(SERVER_HOST)
	await connectToRoom(response.networkId)
}

export async function connectToRoom(roomId: string, abort?: () => void) {
	const player = P.player()
	if (!player) {
		throw new Error('No player set')
	}
	const provider = new SharedStoreProvider(SERVER_HOST, roomId)
	provider.disconnected$.then(() => abort && abort())

	// will only be used if the room is new
	let state: RoomState

	// we always keep/track snapshots because we never know when we're going to become the leader. It may happen after a reconnect or w/e.
	let lastSnaphotTs: number = -1
	const snapshot = localStorage.getItem(`roomSnapshot`)
	const snapshotRoomId = localStorage.getItem(`roomSnapshot:roomId`)
	if (snapshot && snapshotRoomId === roomId) {
		state = JSON.parse(snapshot)
		lastSnaphotTs = Date.now()
	} else {
		state = {
			players: [player],
			status: 'pregame',
			gameConfig: GL.defaultGameConfig,
			messages: [],
		}
	}

	let store: SharedStore<RoomState, ClientOwnedState> = null as unknown as SharedStore<RoomState, ClientOwnedState>
	disposePrevious()
	createRoot((_dispose) => {
		store = initSharedStore<RoomState, ClientOwnedState>(provider, { playerId: player.id }, state)

		//#region try to take state snapshot on page unload
		createEffect(() => {
			trackStore(store.lockstepStore)
			const now = Date.now()
			if (lastSnaphotTs === -1 || now - lastSnaphotTs > 5000) {
				localStorage.setItem(`roomSnapshot:roomId`, roomId)
				localStorage.setItem(`roomSnapshot`, JSON.stringify(store.lockstepStore))
				lastSnaphotTs = now
			}
		})

		function unloadListener() {
			localStorage.setItem(`roomSnapshot`, JSON.stringify(store.lockstepStore))
			localStorage.setItem(`roomSnapshot:roomId`, roomId)
		}

		window.addEventListener('beforeunload', unloadListener)
		//#endregion

		disposePrevious = () => {
			window.removeEventListener('beforeunload', unloadListener)
			room.sendMessage(`${P.player()?.name} has disconnected`, true)
			_dispose()
		}
	})
	await until(() => store.initialized())
	let room = new Room(store, provider)
	setRoom(room)
	until(() => P.player()?.name).then(() => {
		room.ensurePlayerAdded(P.player()!).then(() => {
			room.sendMessage(`${P.player()!.name} has joined the room`, true)
		})
	})
}

export class Room {
	constructor(
		public sharedStore: SharedStore<RoomState, ClientOwnedState>,
		public provider: SharedStoreProvider
	) {
		this.setupListeners()
	}

	get roomId() {
		return this.provider.networkId
	}

	get rollbackState() {
		return this.sharedStore.rollbackStore
	}

	get state() {
		return this.sharedStore.lockstepStore
	}

	// the implementation here could potentially lead to bugs in multiple client per user scenarios where player details change on one client but not another. need to do something more clever for that
	get players() {
		return this.sharedStore.rollbackStore.players
	}

	get connectedPlayers() {
		console.log('states', this.sharedStore.clientControlledStates)
		trackStore(this.sharedStore.clientControlledStates)
		let playerIds: string[] = []
		Object.values(this.sharedStore.clientControlledStates).forEach((state) => {
			playerIds.push(state.playerId)
		})
		return this.players.filter((p) => playerIds.includes(p.id))
	}

	get setState() {
		return this.sharedStore.setStore
	}

	get chatMessages() {
		this.state.messages.length
		return [...this.state.messages].sort((a, b) => a.ts - b.ts)
	}

	dispose: Function = () => {}

	async startGame() {
		let errors: string[] = []
		await this.sharedStore.setStoreWithRetries((state: RoomState) => {
			if (state.status !== 'pregame') {
				errors.push('Not pregame')
				return []
			}
			if (state.players.length < 2) {
				errors.push('Not enough players')
				return []
			}

			const gameState = GL.newGameState(state.gameConfig, {
				[state.players[0].id]: 'white',
				[state.players[1].id]: 'black',
			})

			return [
				{ path: ['status'], value: 'playing' },
				{ path: ['gameState'], value: gameState },
			]
		}, 2)
		if (errors) {
			for (const error of errors) {
				console.error(error)
			}
		}
	}

	setGameConfig(config: Partial<GL.GameConfig>) {
		this.sharedStore.setStore({ path: ['gameConfig'], value: config })
	}

	canStart() {
		// check both states because reasons
		for (let state of [this.sharedStore.lockstepStore, this.sharedStore.rollbackStore]) {
			if (state.status !== 'pregame' || this.connectedPlayers.length < 2) return false
		}
		return true
	}

	async ensurePlayerAdded(player: P.Player) {
		await this.sharedStore.setClientControlledState({ playerId: player.id })
		await this.sharedStore.setStoreWithRetries((state: RoomState) => {
			if (state.players.find((p) => p.id === player.id)) return []
			return [{ path: ['players', '__push__'], value: player }] as StoreMutation[]
		})
	}

	async sendMessage(text: string, isSystem = false) {
		const newMessage: ChatMessage = {
			type: isSystem ? 'system' : 'player',
			sender: P.player()!.name,
			text: text,
			ts: Date.now(),
		}

		await this.sharedStore.setStore({ path: ['messages', '__push__'], value: newMessage }, undefined, false)
	}

	configureNewGame() {
		this.setState({ path: ['status'], value: 'pregame' })
	}

	private setupListeners() {
		createRoot((dispose) => {
			this.dispose = dispose
		})
	}
}
