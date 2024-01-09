import * as P from './player.ts'
import * as GL from './game/gameLogic.ts'
import { PLAYER_TIMEOUT, SERVER_HOST } from '../config.ts'
import { initSharedStore, newNetwork, SharedStore, SharedStoreProvider, StoreMutation } from '../utils/sharedStore.ts'
import { createEffect, createRoot, createSignal, on, onCleanup } from 'solid-js'
import { until } from '@solid-primitives/promise'
import { trackStore } from '@solid-primitives/deep'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { createIdSync } from '../utils/ids.ts'

// TODO normalize language from "color swap" to "pieces swap"

export type RoomParticipant = P.Player & {
	isSpectator: boolean
	isReadyForGame: boolean
	agreeColorSwap: boolean
	disconnectedAt?: number
}

export type RoomActionType = 'initiate-piece-swap' | 'agree-piece-swap' | 'decline-or-cancel-piece-swap'

export type RoomState = {
	players: RoomParticipant[]
	status: 'pregame' | 'playing' | 'postgame'
	gameConfig: GL.GameConfig
	whitePlayerId?: string
	gameStates: Record<string, GL.GameState>
	activeGameId?: string
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

type RoomAction = {
	type: RoomActionType
	origin: RoomParticipant
}

export const [room, setRoom] = createSignal<Room | null>(null)

let disposePrevious = () => {}

export async function createRoom() {
	return await newNetwork(SERVER_HOST)
}

export async function connectToRoom(roomId: string, player: P.Player, abort?: () => void) {
	const provider = new SharedStoreProvider<RoomActionType>(SERVER_HOST, roomId)
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
			gameStates: {},
		}
	}

	let store = null as unknown as SharedStore<RoomState, ClientOwnedState, RoomActionType>
	disposePrevious()
	createRoot((_dispose) => {
		store = initSharedStore<RoomState, ClientOwnedState, RoomActionType>(provider, { playerId: player.id }, state)

		//#region try to take state snapshot on page unload
		// createEffect(() => {
		// 	trackStore(store.lockstepStore)
		// 	const now = Date.now()
		// 	if (lastSnaphotTs === -1 || now - lastSnaphotTs > 5000) {
		// 		localStorage.setItem(`roomSnapshot:roomId`, roomId)
		// 		localStorage.setItem(`roomSnapshot`, JSON.stringify(store.lockstepStore))
		// 		lastSnaphotTs = now
		// 	}
		// })

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
	console.log('initializing store')
	await until(() => store.initialized())
	console.log('store initialized')
	await store.setStoreWithRetries((state) => {
		if (state.players.some((p) => p.id === player.id)) return []
		const mutations: StoreMutation[] = [
			{
				path: ['players', '__push__'],
				value: { id: player.id, name: P.playerName(), isReadyForGame: false, agreeColorSwap: false },
			},
			{
				path: ['messages', '__push__'],
				value: { type: 'system', text: `${player.name} has joined`, sender: null, ts: Date.now() },
			},
		]

		if (!state.whitePlayerId && state.players.length > 0) {
			mutations.push({ path: ['whitePlayerId'], value: player.id })
		} else if (!state.whitePlayerId && state.players.length === 0 && Math.random() < 0.5) {
			mutations.push({ path: ['whitePlayerId'], value: player.id })
		}

		return mutations
	})
	return new Room(store, provider, store.rollbackStore.players.find((p) => player.id === p.id)!)
}

export class Room {
	get canStartGame() {
		// check both states because reasons
		return this.rollbackState.status === 'pregame' && !!this.opponent?.isReadyForGame
	}

	constructor(
		public sharedStore: SharedStore<RoomState, ClientOwnedState, RoomActionType>,
		public provider: SharedStoreProvider<RoomActionType>,
		public player: RoomParticipant
	) {
		this.setupListeners()
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

	get opponent() {
		return this.activePlayers.find((p) => p.id !== this.player.id) || null
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

	get action$(): Observable<RoomAction> {
		return this.sharedStore.action$.pipe(
			map((a) => {
				const playerId = this.sharedStore.clientControlledStates[a.origin].playerId
				return {
					type: a.type,
					origin: this.players.find((p) => p.id === playerId)!,
				}
			})
		)
	}

	destroy: Function = () => {}

	//#endregion

	//#region actions
	setGameConfig(config: Partial<GL.GameConfig>) {
		this.sharedStore.setStore({ path: ['gameConfig'], value: config })
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

		await this.sharedStore.setStore({ path: ['messages', '__push__'], value: newMessage }, undefined, [], false)
	}

	configureNewGame() {
		this.sharedStore.setStoreWithRetries(() => {
			if (!this.opponent || !this.rollbackState.activeGameId) return
			return [
				{ path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'isReadyForGame'], value: false },
				{ path: ['players', this.players.findIndex((p) => p.id === this.opponent!.id), 'isReadyForGame'], value: false },
				{
					path: ['whitePlayerId'],
					value: this.rollbackState.whitePlayerId === this.player.id ? this.opponent!.id : this.player.id,
				},
				{ path: ['status'], value: 'pregame' },
				{ path: ['activeGameId'], value: undefined },
			]
		})
	}

	initiatePieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return
			if (!this.opponent) {
				return {
					actions: ['agree-piece-swap'],
					mutations: [
						{
							path: ['whitePlayerId'],
							value: this.player.id === this.rollbackState.whitePlayerId ? undefined : this.player.id,
						},
					],
				}
			}
			if (this.opponent.agreeColorSwap) return

			return {
				actions: ['initiate-piece-swap'],
				mutations: [
					{
						path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'],
						value: true,
					},
				],
			}
		})
	}

	agreePieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return []
			if (!this.opponent || !this.opponent.agreeColorSwap) return []

			return {
				actions: ['agree-piece-swap'],
				mutations: [
					{ path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'], value: false },
					{
						path: ['players', this.players.findIndex((p) => p.id === this.opponent!.id), 'agreeColorSwap'],
						value: false,
					},
					{
						path: ['whitePlayerId'],
						value: this.rollbackState.whitePlayerId === this.player.id ? this.opponent.id : this.player.id,
					},
				],
			}
		})
	}

	declineOrCancelPieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return []
			if (!this.opponent) return []
			return {
				actions: ['decline-or-cancel-piece-swap'],
				mutations: [
					{ path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'], value: false },
					{
						path: ['players', this.players.findIndex((p) => p.id === this.opponent!.id), 'agreeColorSwap'],
						value: false,
					},
				],
			}
		})
	}

	toggleReady() {
		if (!this.player.isReadyForGame) {
			this.sharedStore.setStoreWithRetries(() => {
				if (this.player.isReadyForGame) return []
				const playerIndex = this.players.findIndex((p) => p.id === this.player.id)
				if (this.opponent?.isReadyForGame) {
					const opponentIndex = this.players.findIndex((p) => p.id === this.opponent!.id)
					const gameState = GL.newGameState(this.rollbackState.gameConfig, {
						[this.player.id]: this.player.id === this.rollbackState.whitePlayerId ? 'white' : 'black',
						[this.opponent.id]: this.opponent.id === this.rollbackState.whitePlayerId ? 'white' : 'black',
					})
					const gameId = createIdSync(6)
					return [
						{ path: ['players', playerIndex, 'isReadyForGame'], value: false },
						{ path: ['players', opponentIndex, 'isReadyForGame'], value: false },
						{ path: ['whitePlayerId'], value: undefined },
						{ path: ['status'], value: 'playing' },
						{ path: ['activeGameId'], value: gameId },
						{ path: ['gameStates', gameId], value: gameState },
					]
				} else {
					return [{ path: ['players', playerIndex, 'isReadyForGame'], value: true }]
				}
			})
		} else {
			this.sharedStore.setStoreWithRetries(() => {
				if (!this.player.isReadyForGame) return []

				const playerIndex = this.players.findIndex((p) => p.id === this.player.id)

				return [{ path: ['players', playerIndex, 'isReadyForGame'], value: false }]
			})
		}
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

			const checkActiveConnections = () => {
				const hasPreviouslyDisconnected = (player: P.Player, state: RoomState) => {
					return state.messages.some((m) => m.text.match(`${player.name} has disconnected`))
				}

				// make sure we're the only client sending these messages
				if (!this.sharedStore.isLeader()) return
				for (let player of this.activePlayers) {
					if (!prevActivePlayers.has(player.id) && hasPreviouslyDisconnected(player, this.state)) {
						this.sendMessage(`${player.name} has reconnected`, true)
					}
					prevActivePlayers.add(player.id)
				}
				for (let playerId of prevActivePlayers.values()) {
					const player = this.players.find((p) => p.id === playerId)!
					if (!this.activePlayers.some((p) => p.id === playerId)) {
						prevActivePlayers.delete(playerId)
						this.sendMessage(`${player.name} has disconnected`, true)
					}
				}
			}

			until(() => this.activePlayers.length).then(checkActiveConnections)
			const interval = setInterval(checkActiveConnections, 1000)
			onCleanup(() => {
				clearInterval(interval)
			})
			//#endregion
		})
	}
}
