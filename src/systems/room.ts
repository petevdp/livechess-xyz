import * as P from './player.ts'
import * as GL from './game/gameLogic.ts'
import { PLAYER_TIMEOUT, SERVER_HOST } from '../config.ts'
import { initSharedStore, newNetwork, SharedStore, SharedStoreProvider, StoreMutation } from '~/utils/sharedStore.ts'
import { createEffect, createMemo, createRoot, createSignal, getOwner, onCleanup, Owner, runWithOwner, untrack } from 'solid-js'
import { until } from '@solid-primitives/promise'
import { trackDeep, trackStore } from '@solid-primitives/deep'
import { createIdSync } from '~/utils/ids.ts'
import { unwrap } from 'solid-js/store'
import { concatMap } from 'rxjs'

// TODO normalize language from "color swap" to "pieces swap"

export type RoomMember = P.Player & {
	disconnectedAt?: number
}

type GameParticipantDetails = {
	// just playerid
	id: string
	isReadyForGame: boolean
	agreeColorSwap: boolean
}

export type GameParticipant = RoomMember & GameParticipantDetails & { color: GL.Color }

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
	members: RoomMember[]
	status: 'pregame' | 'playing' | 'postgame'
	gameConfig: GL.GameConfig
	gameParticipants: Record<GL.Color, GameParticipantDetails>
	gameStates: Record<string, GL.GameState>
	activeGameId?: string
}

type ClientOwnedState = {
	playerId: string
}

export const [room, setRoom] = createSignal<Room | null>(null)

let disposePrevious = () => {}

export async function createRoom() {
	return await newNetwork(SERVER_HOST)
}

export async function connectToRoom(
	roomId: string,
	playerId: string,
	initPlayer: (numPlayers: number) => Promise<{ player: P.Player; isSpectating: boolean }>,
	parentOwner: Owner,
	abort?: () => void
) {
	console.log('connecting to room')
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
			members: [],
			status: 'pregame',
			gameParticipants: {} as RoomState['gameParticipants'],
			gameConfig: GL.defaultGameConfig,
			gameStates: {},
		}
	}

	let store = null as unknown as SharedStore<RoomState, ClientOwnedState, RoomEvent>
	let instanceOwner = null as unknown as Owner
	disposePrevious()
	createRoot((_dispose) => {
		store = initSharedStore<RoomState, ClientOwnedState, RoomEvent>(provider, { playerId }, state)

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
	console.log('store initialized')
	if (!state.members.some((p) => p.id === playerId)) {
		const { player, isSpectating } = await initPlayer(Object.values(store.rollbackStore.gameParticipants).length)
		console.log('new player', player.id, 'isSpectating', isSpectating)
		//#region connect player
		await store.setStoreWithRetries((state) => {
			// leader will report player reconnection
			if (state.members.some((p) => p.id === playerId)) return []
			const mutations: StoreMutation[] = [
				{
					path: ['members', '__push__'],
					value: player satisfies RoomMember,
				},
			]

			if (!isSpectating) {
				let gameParticipant = {
					id: playerId,
					isReadyForGame: false,
					agreeColorSwap: false,
				} satisfies GameParticipantDetails
				if (state.gameParticipants.white) {
					mutations.push({ path: ['gameParticipants', 'black'], value: gameParticipant })
				} else if (state.gameParticipants.black) {
					mutations.push({ path: ['gameParticipants', 'white'], value: gameParticipant })
				} else {
					mutations.push({ path: ['gameParticipants', Math.random() < 0.5 ? 'white' : 'black'], value: gameParticipant })
				}
			}

			return { mutations, events: [{ type: 'player-connected', playerId: player.id }] }
		})
	}
	//#endregion

	const room = runWithOwner(instanceOwner, () => new Room(store, provider, store.rollbackStore.members.find((p) => playerId === p.id)!))!
	setRoom(room)
	return room
}

export class Room {
	get canStartGame() {
		// check both states because reasons
		return this.rollbackState.status === 'pregame' && this.leftPlayer?.id === this.player.id && !!this.rightPlayer?.isReadyForGame
	}

	constructor(
		public sharedStore: SharedStore<RoomState, ClientOwnedState, RoomEvent>,
		public provider: SharedStoreProvider<RoomEvent>,
		public player: RoomMember
	) {
		//#region track player events
		const connectedPlayers = createMemo(() => {
			trackDeep(this.sharedStore.clientControlledStates)
			let playerIds: string[] = Object.values(this.sharedStore.clientControlledStates).map((s) => s.playerId)
			console.log('changing connected players', playerIds)
			return this.members.filter((p) => playerIds.includes(p.id) && p.name)
		})

		const previouslyConnected = new Set<string>()
		createEffect(() => {
			const _connectedPlayers = unwrap(connectedPlayers())
			untrack(() => {
				console.log('connected players changed', _connectedPlayers)
				for (let player of this.members) {
					const isConnected = _connectedPlayers.some((p) => p.id === player.id)
					if (!previouslyConnected.has(player.id) && isConnected) {
						previouslyConnected.add(player.id)
						if (!this.sharedStore.isLeader()) return
						this.sharedStore.setStoreWithRetries((state) => {
							const playerIndex = state.members.findIndex((p) => p.id === player.id)
							if (playerIndex === -1 || !player.disconnectedAt) return []
							return {
								events: [{ type: 'player-reconnected', playerId: player.id }],
								mutations: [{ path: ['members', playerIndex, 'disconnectedAt'], value: undefined }],
							}
						})
					} else if (previouslyConnected.has(player.id) && !isConnected) {
						const disconnectedAt = Date.now()
						previouslyConnected.delete(player.id)
						if (!this.sharedStore.isLeader()) return
						this.sharedStore.setStoreWithRetries((state) => {
							const playerIndex = state.members.findIndex((p) => p.id === player.id)
							if (playerIndex === -1) return []
							console.log('player disconnected', player.id, 'at', disconnectedAt, 'state', state)
							return {
								events: [{ type: 'player-disconnected', playerId: player.id }],
								mutations: [{ path: ['members', playerIndex, 'disconnectedAt'], value: disconnectedAt }],
							}
						})
					}
				}
			})
		})
		//#endregion
	}

	//#region helpers
	get isPlayerParticipating() {
		return this.player.id === this.leftPlayer?.id
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

	get participants(): GameParticipant[] {
		return this.members
			.map((player): GameParticipant[] => {
				const gameParticipant = Object.values(this.rollbackState.gameParticipants).find((gp) => gp.id === player.id)
				if (!gameParticipant) return []
				return [{ ...player, ...gameParticipant, color: this.playerColor(gameParticipant.id)! }]
			})
			.flat()
	}

	get spectators() {
		return this.members.filter((p) => Object.values(this.rollbackState.gameParticipants).some((gp) => gp.id === p.id))
	}

	get rightPlayer() {
		return this.participants.find((p) => p.id !== this.player.id) || null
	}

	// the implementation here could potentially lead to bugs in multiple client per user scenarios where player details change on one client but not another. need to do something more clever for that
	get members() {
		return this.sharedStore.rollbackStore.members
	}

	get leftPlayer() {
		const participant = this.participants.find((p) => p.id === this.player.id)
		if (participant) return participant
		return this.participants.find((p) => p.id !== this.player.id && p.id !== this.rightPlayer?.id) || null
	}

	// players that are connected, or have been disconnected for less than the timeout window
	get activePlayers() {
		return this.members.filter((p) => !p.disconnectedAt || Date.now() - p.disconnectedAt < PLAYER_TIMEOUT)
	}

	get action$() {
		return this.sharedStore.action$.pipe(
			concatMap((a) => {
				let player = this.members.find((p) => p.id === a.playerId)!
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

	playerColor(playerId: string) {
		if (!playerId) throw new Error('playerId is missing')
		if (this.rollbackState.gameParticipants.white?.id === playerId) return 'white'
		if (this.rollbackState.gameParticipants.black?.id === playerId) return 'black'
		return null
	}

	//#endregion

	//#region actions
	setGameConfig(config: Partial<GL.GameConfig>) {
		this.sharedStore.setStore({ path: ['gameConfig'], value: config })
	}

	async setPlayerName(name: string) {
		this.sharedStore.setStoreWithRetries((state) => {
			let _name = name
			// name already set
			if (state.members.some((p) => p.id === this.player.id && p.name === name)) return []

			// check if name taken
			let duplicates = state.members.filter((p) => p.name === name)
			if (duplicates.length > 0) {
				_name = `${name} (${duplicates.length})`
			}

			return [{ path: ['members', state.members.findIndex((p) => p.id === this.player.id), 'name'], value: _name }]
		})
	}

	configureNewGame() {
		this.sharedStore.setStoreWithRetries(() => {
			if (!this.rightPlayer || !this.rollbackState.activeGameId) return
			return [
				{ path: ['members', this.members.findIndex((p) => p.id === this.player.id), 'isReadyForGame'], value: false },
				{
					path: ['members', this.members.findIndex((p) => p.id === this.rightPlayer!.id), 'isReadyForGame'],
					value: false,
				},
				{
					path: ['gameParticipants', 'white'],
					value: this.rollbackState.gameParticipants.black,
				},
				{
					path: ['gameParticipants', 'black'],
					value: this.rollbackState.gameParticipants.white,
				},
				{ path: ['status'], value: 'pregame' },
				{ path: ['activeGameId'], value: undefined },
			]
		})
	}

	initiatePieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame' || !this.isPlayerParticipating) return
			if (!this.rightPlayer) {
				return {
					events: [{ type: 'agree-piece-swap', playerId: this.player.id }],
					mutations: [
						{
							path: ['gameParticipants', this.playerColor(this.player.id)!],
							value: undefined,
						},
						{
							path: ['gameParticipants', GL.oppositeColor(this.playerColor(this.player.id)!)],
							value: this.player.id,
						},
					] satisfies StoreMutation[],
				}
			}
			if (this.rightPlayer.agreeColorSwap) return

			return {
				events: [{ type: 'initiate-piece-swap', playerId: this.player.id }],
				mutations: [
					{
						path: ['members', this.members.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'],
						value: true,
					},
				],
			}
		})
	}

	agreePieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return []
			if (!this.rightPlayer || !this.rightPlayer.agreeColorSwap) return []

			return {
				events: [{ type: 'agree-piece-swap', playerId: this.player.id }],
				mutations: [
					{ path: ['members', this.members.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'], value: false },
					{
						path: ['members', this.members.findIndex((p) => p.id === this.rightPlayer!.id), 'agreeColorSwap'],
						value: false,
					},
					{
						path: ['gameParticipants', 'white'],
						value: this.rollbackState.gameParticipants.black,
					},
					{
						path: ['gameParticipants', 'black'],
						value: this.rollbackState.gameParticipants.white,
					},
				],
			}
		})
	}

	declineOrCancelPieceSwap() {
		this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return []
			if (!this.rightPlayer) return []
			return {
				events: [{ type: 'decline-or-cancel-piece-swap', playerId: this.player.id }],
				mutations: [
					{ path: ['members', this.members.findIndex((p) => p.id === this.player.id), 'agreeColorSwap'], value: false },
					{
						path: ['members', this.members.findIndex((p) => p.id === this.rightPlayer!.id), 'agreeColorSwap'],
						value: false,
					},
				],
			}
		})
	}

	toggleReady() {
		if (!this.isPlayerParticipating) return
		if (!this.leftPlayer!.isReadyForGame) {
			this.sharedStore.setStoreWithRetries(() => {
				if (!this.isPlayerParticipating || this.leftPlayer!.isReadyForGame) return []
				if (this.rightPlayer?.isReadyForGame) {
					const gameState = GL.newGameState(this.rollbackState.gameConfig, {
						[this.leftPlayer!.id]: this.leftPlayer!.id === this.rollbackState.gameParticipants.white.id ? 'white' : 'black',
						[this.rightPlayer.id]: this.rightPlayer.id === this.rollbackState.gameParticipants.white.id ? 'white' : 'black',
					})
					const gameId = createIdSync(6)
					return [
						{ path: ['gameParticipants', this.leftPlayer!.color, 'isReadyForGame'], value: false },
						{ path: ['gameParticipants', this.rightPlayer!.color, 'isReadyForGame'], value: false },
						{ path: ['status'], value: 'playing' },
						{ path: ['activeGameId'], value: gameId },
						{ path: ['gameStates', gameId], value: gameState },
					] satisfies StoreMutation[]
				} else {
					return [{ path: ['gameParticipants', this.leftPlayer!.color, 'isReadyForGame'], value: true }]
				}
			})
		} else {
			this.sharedStore.setStoreWithRetries(() => {
				if (!this.isPlayerParticipating || !this.leftPlayer!.isReadyForGame) return []
				return [{ path: ['gameParticipants', this.leftPlayer!.color, 'isReadyForGame'], value: false }]
			})
		}
	}

	//#endregion
}
