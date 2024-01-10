import * as P from './player.ts'
import * as GL from './game/gameLogic.ts'
import {PLAYER_TIMEOUT, SERVER_HOST} from '../config.ts'
import {initSharedStore, newNetwork, SharedStore, SharedStoreProvider, StoreMutation} from '~/utils/sharedStore.ts'
import {
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	getOwner,
	onCleanup,
	Owner,
	runWithOwner,
	untrack
} from 'solid-js'
import {until} from '@solid-primitives/promise'
import {trackDeep, trackStore} from '@solid-primitives/deep'
import {createIdSync} from '~/utils/ids.ts'
import {unwrap} from 'solid-js/store'
import {concatMap} from 'rxjs'

// TODO normalize language from "color swap" to "pieces swap"

export type RoomParticipant = P.Player & {
	isSpectator: boolean
	isReadyForGame: boolean
	agreeColorSwap: boolean
	disconnectedAt?: number
}

// not exhaustive of all state mutations, just the ones we want to name for convenience
export type RoomEvent = {
	type:
		| 'initiate-piece-swap'
		| 'agree-piece-swap'
		| 'decline-or-cancel-piece-swap'
		| 'player-connected'
		| 'player-disconnected'
		| 'player-reconnected'
	playerId: string
}

export type RoomState = {
	players: RoomParticipant[]
	status: 'pregame' | 'playing' | 'postgame'
	gameConfig: GL.GameConfig
	whitePlayerId?: string
	gameStates: Record<string, GL.GameState>
	activeGameId?: string
}

type ClientOwnedState = {
	playerId: string
}

export const [room, setRoom] = createSignal<Room | null>(null)

let disposePrevious = () => {
}

export async function createRoom() {
	return await newNetwork(SERVER_HOST)
}

export async function connectToRoom(roomId: string, player: P.Player, parentOwner: Owner, abort?: () => void) {
	const provider = new SharedStoreProvider<RoomEvent>(SERVER_HOST, roomId)
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
			gameStates: {},
		}
	}

	let store = null as unknown as SharedStore<RoomState, ClientOwnedState, RoomEvent>
	let instanceOwner = null as unknown as Owner
	disposePrevious()
	createRoot((_dispose) => {
		store = initSharedStore<RoomState, ClientOwnedState, RoomEvent>(provider, {playerId: player.id}, state)

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
		instanceOwner = getOwner()!

		disposePrevious = () => {
			window.removeEventListener('beforeunload', unloadListener)
			setRoom(null)
			_dispose()
		}
	})

	runWithOwner(parentOwner, () => {
		onCleanup(disposePrevious)
	})

	await until(() => store.initialized())

	//#region connect player
	await store.setStoreWithRetries((state) => {
		// leader will report player reconnection
		if (state.players.some((p) => p.id === player.id)) return []
		const mutations: StoreMutation[] = [
			{
				path: ['players', '__push__'],
				value: {id: player.id, name: P.playerName(), isReadyForGame: false, agreeColorSwap: false},
			},
		]

		if (!state.whitePlayerId && state.players.length > 0) {
			mutations.push({path: ['whitePlayerId'], value: player.id})
		} else if (!state.whitePlayerId && state.players.length === 0 && Math.random() < 0.5) {
			mutations.push({path: ['whitePlayerId'], value: player.id})
		}

		return {mutations, events: [{type: 'player-connected', playerId: player.id}]}
	})
	//#endregion

	const room = runWithOwner(instanceOwner, () => new Room(store, provider, store.rollbackStore.players.find((p) => player.id === p.id)!))!
	setRoom(room)
	return room
}

export class Room {
	get canStartGame() {
		// check both states because reasons
		return this.rollbackState.status === 'pregame' && !!this.opponent?.isReadyForGame
	}

	constructor(
		public sharedStore: SharedStore<RoomState, ClientOwnedState, RoomEvent>,
		public provider: SharedStoreProvider<RoomEvent>,
		public player: RoomParticipant
	) {
		//#region track player events
		const connectedPlayers = createMemo(() => {
			trackDeep(this.sharedStore.clientControlledStates)
			let playerIds: string[] = Object.values(this.sharedStore.clientControlledStates).map((s) => s.playerId)
			console.log('changing connected players', playerIds)
			return this.players.filter((p) => playerIds.includes(p.id) && p.name)
		})

		const previouslyConnected = new Set<string>()
		createEffect(() => {
			const _connectedPlayers = unwrap(connectedPlayers())
			untrack(() => {
				console.log('connected players changed', _connectedPlayers)
				for (let player of this.players) {
					const isConnected = _connectedPlayers.some((p) => p.id === player.id)
					if (!previouslyConnected.has(player.id) && isConnected) {
						previouslyConnected.add(player.id)
						if (!this.sharedStore.isLeader()) return
						this.sharedStore.setStoreWithRetries((state) => {
							const playerIndex = state.players.findIndex((p) => p.id === player.id)
							if (playerIndex === -1 || !player.disconnectedAt) return []
							return {
								events: [{type: 'player-reconnected', playerId: player.id}],
								mutations: [{path: ['players', playerIndex, 'disconnectedAt'], value: undefined}],
							}
						})
					} else if (previouslyConnected.has(player.id) && !isConnected) {
						const disconnectedAt = Date.now()
						previouslyConnected.delete(player.id)
						if (!this.sharedStore.isLeader()) return
						this.sharedStore.setStoreWithRetries((state) => {
							const playerIndex = state.players.findIndex((p) => p.id === player.id)
							if (playerIndex === -1) return []
							console.log('player disconnected', player.id, 'at', disconnectedAt, 'state', state)
							return {
								events: [{type: 'player-disconnected', playerId: player.id}],
								mutations: [{path: ['players', playerIndex, 'disconnectedAt'], value: disconnectedAt}],
							}
						})
					}
				}
			})
		})
		//#endregion
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

	// players that are connected, or have been disconnected for less than the timeout window
	get activePlayers() {
		return this.players.filter((p) => !p.disconnectedAt || Date.now() - p.disconnectedAt < PLAYER_TIMEOUT)
	}

	get action$() {
		return this.sharedStore.action$.pipe(
			concatMap((a) => {
				let player = this.players.find((p) => p.id === a.playerId)!
				if (!player) {
					console.warn('unknown player id in action', a)
					return []
				}
				return [
					{
						type: a.type as RoomEvent['type'],
						player: unwrap(player),
					},
				]
			})
		)
	}

	//#endregion

	//#region actions
	setGameConfig(config: Partial<GL.GameConfig>) {
		this.sharedStore.setStore({path: ['gameConfig'], value: config})
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

			return [{path: ['players', state.players.findIndex((p) => p.id === this.player.id), 'name'], value: _name}]
		})
	}

	configureNewGame() {
		this.sharedStore.setStoreWithRetries(() => {
			if (!this.opponent || !this.rollbackState.activeGameId) return
			return [
				{path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'isReadyForGame'], value: false},
				{path: ['players', this.players.findIndex((p) => p.id === this.opponent!.id), 'isReadyForGame'], value: false},
				{
					path: ['whitePlayerId'],
					value: this.rollbackState.whitePlayerId === this.player.id ? this.opponent!.id : this.player.id,
				},
				{path: ['status'], value: 'pregame'},
				{path: ['activeGameId'], value: undefined},
			]
		})
	}

	initiatePieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return
			if (!this.opponent) {
				return {
					events: [{type: 'agree-piece-swap', playerId: this.player.id}],
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
				events: [{type: 'initiate-piece-swap', playerId: this.player.id}],
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
				events: [{type: 'agree-piece-swap', playerId: this.player.id}],
				mutations: [
					{path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'], value: false},
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
				events: [{type: 'decline-or-cancel-piece-swap', playerId: this.player.id}],
				mutations: [
					{path: ['players', this.players.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'], value: false},
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
						{path: ['players', playerIndex, 'isReadyForGame'], value: false},
						{path: ['players', opponentIndex, 'isReadyForGame'], value: false},
						{path: ['whitePlayerId'], value: undefined},
						{path: ['status'], value: 'playing'},
						{path: ['activeGameId'], value: gameId},
						{path: ['gameStates', gameId], value: gameState},
					]
				} else {
					return [{path: ['players', playerIndex, 'isReadyForGame'], value: true}]
				}
			})
		} else {
			this.sharedStore.setStoreWithRetries(() => {
				if (!this.player.isReadyForGame) return []

				const playerIndex = this.players.findIndex((p) => p.id === this.player.id)

				return [{path: ['players', playerIndex, 'isReadyForGame'], value: false}]
			})
		}
	}

	//#endregion
}
