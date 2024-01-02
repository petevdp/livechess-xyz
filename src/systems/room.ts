import * as P from './player.ts'
import * as GL from './game/gameLogic.ts'
import { PLAYER_TIMEOUT, SERVER_HOST } from '../config.ts'
import { initSharedStore, newNetwork, SharedStore, SharedStoreProvider, StoreMutation } from '../utils/sharedStore.ts'
import { createEffect, createRoot, createSignal, on } from 'solid-js'
import { until } from '@solid-primitives/promise'
import { trackStore } from '@solid-primitives/deep'

export type RoomParticipant = P.Player & { disconnectedAt?: number }

export type RoomState = {
	players: RoomParticipant[]
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
	return await newNetwork(SERVER_HOST)
}

export async function connectToRoom(roomId: string, player: P.Player, abort?: () => void) {
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
			players: [],
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
			_dispose()
		}
	})
	await until(() => store.initialized())
	await store.setStoreWithRetries((state) => {
		if (state.players.some((p) => p.id === player.id)) return []
		return [{ path: ['players', '__push__'], value: { id: player.id, name: P.playerName() } }]
	})
	let room = new Room(store, provider, player)
	setRoom(room)
}

export class Room {
	get canStartGame() {
		// check both states because reasons
		for (let state of [this.sharedStore.lockstepStore, this.sharedStore.rollbackStore]) {
			if (state.status !== 'pregame' || this.connectedPlayers.length < 2) return false
		}
		return true
	}

	constructor(
		public sharedStore: SharedStore<RoomState, ClientOwnedState>,
		public provider: SharedStoreProvider,
		public player: P.Player
	) {
		this.setupListeners()
		this.ensurePlayerAdded()
	}

	//#region helpers

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

	// players with an active websocket connection
	get connectedPlayers() {
		trackStore(this.sharedStore.clientControlledStates)
		let playerIds: string[] = Object.values(this.sharedStore.clientControlledStates).map((s) => s.playerId)
		return this.players.filter((p) => playerIds.includes(p.id) && p.name)
	}

	// players that are connected, or have been disconnected for less than the timeout window
	get activePlayers() {
		return this.connectedPlayers.filter((p) => !p.disconnectedAt || Date.now() - p.disconnectedAt < PLAYER_TIMEOUT)
	}

	get setState() {
		return this.sharedStore.setStore
	}

	get chatMessages() {
		this.state.messages.length
		return [...this.state.messages].sort((a, b) => a.ts - b.ts)
	}

	destroy: Function = () => {}

	//#endregion

	//#region actions

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

	async ensurePlayerAdded() {
		await this.sharedStore.setClientControlledState({ playerId: this.player.id })
		let added = false
		const success = await this.sharedStore.setStoreWithRetries((state: RoomState) => {
			let index: number = state.players.findIndex((p) => p.id === this.player.id)
			if (index !== -1) return
			added = true
			return [
				{
					path: ['players', '__push__'],
					value: { id: this.player.id, name: null } as RoomParticipant,
				},
			] as StoreMutation[]
		})

		if (!success) {
			throw new Error('Failed to add player')
		}
	}

	async setPlayerName(name: string) {
		this.sharedStore.setStoreWithRetries((state) => {
			let _name = name
			// name already set
			if (state.players.some((p) => p.id === this.player.id && p.name === name)) return []

			// check if name taken
			let duplicates = state.players.filter((p) => p.name === name)
			if (duplicates.length > 0) {
				_name = `${name} (${duplicates.length})`
			}

			return [{ path: ['players', state.players.findIndex((p) => p.id === this.player.id), 'name'], value: _name }]
		})
	}

	async sendMessage(text: string, isSystem = false) {
		const newMessage: ChatMessage = {
			type: isSystem ? 'system' : 'player',
			sender: this.player.name,
			text: text,
			ts: Date.now(),
		}

		await this.sharedStore.setStore({ path: ['messages', '__push__'], value: newMessage }, undefined, false)
	}

	configureNewGame() {
		this.sharedStore.setStoreWithRetries(() => {
			return [
				{ path: ['gameState'], value: undefined },
				{ path: ['status'], value: 'pregame' },
			]
		}, 0)
	}

	//#endregion

	private setupListeners() {
		createRoot((dispose) => {
			this.destroy = dispose

			//#region track player disconnects
			const previouslyConnected = new Set<string>()
			createEffect(() => {
				on(
					() => this.connectedPlayers.length,
					() => {
						for (let player of this.players) {
							const isConnected = this.connectedPlayers.some((p) => p.id === player.id)
							if (!previouslyConnected.has(player.id) && isConnected) {
								previouslyConnected.add(player.id)
								this.sharedStore.setStoreWithRetries((state) => {
									const playerIndex = state.players.findIndex((p) => p.id === player.id)
									if (playerIndex === -1) return []
									return [{ path: ['players', playerIndex, 'disconnectedAt'], value: undefined }]
								})
							} else if (previouslyConnected.has(player.id) && !isConnected) {
								const disconnectedAt = Date.now()
								previouslyConnected.delete(player.id)
								this.sharedStore.setStoreWithRetries((state) => {
									const playerIndex = state.players.findIndex((p) => p.id === player.id)
									if (playerIndex === -1) return []
									return [{ path: ['players', playerIndex, 'disconnectedAt'], value: disconnectedAt }]
								})
							}
						}
					}
				)
			})
			//#endregion

			//#region messages on active player change
			let prevActivePlayers = new Set<string>(this.activePlayers.map((p) => p.id))
			let seenPlayers = new Set<string>(this.players.map((p) => p.id))

			// TODO this is a big buggy, fix
			const checkActiveCnnections = () => {
				// make sure we're the only client sending these messages
				if (!this.sharedStore.isLeader()) return
				for (let player of this.players) {
					const isActive = this.activePlayers.some((p) => p.id === player.id)
					if (!prevActivePlayers.has(player.id) && isActive) {
						prevActivePlayers.add(player.id)
						if (seenPlayers.has(player.id)) {
							this.sendMessage(`${player.name} has reconnected`, true)
						} else {
							this.sendMessage(`${player.name} has joined`, true)
							seenPlayers.add(player.id)
						}
					} else if (prevActivePlayers.has(player.id) && !isActive) {
						prevActivePlayers.delete(player.id)
						this.sendMessage(`${player.name} has disconnected`, true)
					}
				}
			}

			until(() => this.player).then(checkActiveCnnections)
			setInterval(checkActiveCnnections, 1000)
			//#endregion
		})
	}
}
