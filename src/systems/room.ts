import { WebsocketProvider } from 'y-websocket'
import { createId } from '../utils/ids.ts'
import * as GL from './game/gameLogic.ts'
import { BoardHistoryEntry } from './game/gameLogic.ts'
import * as Y from 'yjs'
import * as P from './player.ts'
import { WS_CONNECTION } from '../config.ts'
import { createSignal } from 'solid-js'
import { until } from '@solid-primitives/promise'
import {
	combineLatest,
	concatAll,
	distinctUntilChanged,
	first,
	firstValueFrom,
	mergeAll,
	Subscription,
	takeUntil,
} from 'rxjs'
import * as YU from '../utils/yjs.ts'
import { filter, map } from 'rxjs/operators'
import { isEqual } from 'lodash'

export const ROOM_STATES = ['pregame', 'in-progress', 'postgame'] as const
export type RoomStatus = (typeof ROOM_STATES)[number]

export type RoomActionArgs =
	| {
			type: 'move'
			move: GL.Move
	  }
	| {
			type: 'offer-draw'
	  }
	| {
			type: 'cancel-draw'
	  }
	| {
			type: 'game-finished'
			outcome: GL.GameOutcome
			winnerId: string | null
	  }
	| {
			type: 'new-game'
			gameConfig: GL.GameConfig
			playerColors: GL.GameState['players']
	  }
	| {
			type: 'play-again'
	  }

// actions are events that need to be replicated, though chat messages are handled separately
export type RoomAction = {
	playerId: string
} & RoomActionArgs

// can be sent by either players or the room(on host)
export type ChatMessage = {
	type: 'player' | 'system'
	sender: string | null
	text: string
}

export type RoomParticipant = P.Player & { spectator: boolean; joinTs: number }

const roomYWrapperDef = {
	entities: {
		player: {
			key: (p: RoomParticipant) => p.id,
			startingValues: [] as RoomParticipant[],
		},
		processedRoomActions: {
			key: (index: number) => index.toString(),
			startingValues: [] as number[],
		},
		boardHistory: {
			key: (entry: GL.BoardHistoryEntry) => entry.index.toString(),
			startingValues: [] as BoardHistoryEntry[],
		},
	},
	events: {
		roomAction: {
			example: { type: 'move', move: { from: 'a1', to: 'a2' } } as RoomAction,
		},
		chatMessage: {
			example: {} as unknown as ChatMessage,
		},
	},
	values: {
		status: {
			default: 'pregame' as RoomStatus,
		},
		gameConfig: {
			default: GL.defaultGameConfig,
		},
		drawOfferedBy: {
			default: null as string | null, // playerId
		},
	},
	awareness: {
		playerId: 'empty',
	},
} satisfies YU.DataConfig
type RoomStateDef = typeof roomYWrapperDef

export const [room, setRoom] = createSignal<Room | null>(null)

export class Room {
	public yClient: YU.YState<RoomStateDef>
	private subscription: Subscription
	private wsProvider: any

	constructor(
		public readonly roomId: string,
		private playerId: string,
		isNewRoom: boolean
	) {
		const doc = new Y.Doc()
		this.wsProvider = new WebsocketProvider(WS_CONNECTION, roomId, doc, {
			connect: false,
		})

		this.yClient = new YU.YState(doc, this.wsProvider, roomYWrapperDef, this.wsProvider.awareness, isNewRoom)

		this.subscription = new Subscription()

		this.setupListeners().then(async () => {
			this.wsProvider.connect()
			const playerName = await until(() => P.player()?.name)
			await this.yClient.dispatchEvent('chatMessage', {
				type: 'system',
				sender: null,
				text: `${playerName} has connected`,
			})
		})
	}

	get players() {
		return this.yClient.getAllEntities('player')
	}

	async connectedPlayers() {
		return await firstValueFrom(this.observeConnectedPlayers()).catch((e) => {
			console.error('error getting connected players: ', e)
			return []
		})
	}

	observeConnectedPlayers() {
		let player$ = this.yClient.observeEntityChanges('player', true).pipe(
			map(() => this.players),
			mergeAll()
		)
		return combineLatest([player$, this.yClient.observeAwareness(true)]).pipe(
			map(async ([players, awareness]) => {
				const connectedPlayerIds = [...awareness.values()].map((s) => s.playerId)
				return players.filter((p) => connectedPlayerIds.includes(p.id))
			}),
			concatAll(),
			distinctUntilChanged<RoomParticipant[]>(isEqual)
		)
	}

	async host() {
		return resolveHost(await this.connectedPlayers())
	}

	async roomStatus() {
		return await this.yClient.getValue('status')
	}

	observeRoomStatus() {
		return this.yClient.observeValue('status', true)
	}

	canStart() {}

	observeHost() {
		return this.yClient.observeEntityChanges('player', true).pipe(
			map(() => this.host()),
			concatAll()
		)
	}

	observeCanStart() {
		const player$ = this.observeConnectedPlayers()
		const status$ = this.observeRoomStatus()
		return combineLatest([player$, status$]).pipe(
			map(([players, status]) => {
				return status === 'pregame' && players.length >= 2
			})
		)
	}

	async guest() {
		return (await this.players).sort((a, b) => a.joinTs - b.joinTs)[1]
	}

	async sendMessage(message: string, isSystem: boolean) {
		await this.yClient.dispatchEvent('chatMessage', {
			type: isSystem ? 'system' : 'player',
			sender: await until(() => P.player()?.name),
			text: message,
		})
	}

	async gameConfig() {
		return await this.yClient.getValue('gameConfig')
	}

	async dispatchRoomAction(action: RoomActionArgs, t?: YU.Transaction) {
		await this.yClient.dispatchEvent(
			'roomAction',
			{
				playerId: this.playerId,
				...action,
			},
			t
		)
	}

	async destroy() {
		this.subscription.unsubscribe()
		await this.yClient.destroy()
	}

	observeIsHost() {
		return this.observeConnectedPlayers().pipe(
			map(resolveHost),
			filter((p) => !!p),
			map((host) => host.id === this.playerId),
			distinctUntilChanged()
		)
	}

	private async setupListeners() {
		//#region handle actions originating from this client
		this.subscription.add(
			this.yClient
				.observeEvent('roomAction', true)
				.pipe(
					// handle events that were created by this client
					filter((a) => a.playerId !== this.playerId)
				)
				.subscribe(async (action) => {
					let processedActionIdx = await this.yClient.getEntity('processedRoomActions', action.index.toString())
					if (processedActionIdx !== undefined) return
					console.log('processing action ', action)

					await this.yClient.setEntity('processedRoomActions', action.index.toString(), action.index)
					let roomStatus = await this.roomStatus()

					if (action.type === 'game-finished' && roomStatus === 'in-progress') {
						await this.yClient.setValue('status', 'postgame')
						const winner = action.winnerId && (await this.yClient.getEntity('player', action.winnerId))
						await this.sendMessage(`Game Ended: ${action.outcome.reason}: (${winner ? winner.name : 'draw'})`, true)
						return
					}

					if (action.type === 'new-game' && roomStatus === 'pregame') {
						const player = await this.yClient.getEntity('player', action.playerId)
						if (!player) {
							console.warn(`player not found when attempting to log message (${action.type}):`, action.playerId)
							return
						}
						await this.yClient.setValue('status', 'in-progress')
						await this.sendMessage(`${player.name!} has started a new game`, true)
						return
					}
					if (action.type === 'play-again' && roomStatus === 'postgame') {
						await this.yClient.setValue('status', 'pregame')
						return
					}
				})
		)
		//#endregion

		//#region check if any players have DCed
		const host$ = this.observeHost().pipe(
			map((p) => p.id === this.playerId),
			distinctUntilChanged()
		)
		const clientIsNotHost$ = host$.pipe(
			filter((isHost) => !isHost),
			first()
		)

		host$
			.pipe(
				filter((isHost) => isHost),
				map(() => {
					return this.yClient.observeAwareness(true).pipe(takeUntil(clientIsNotHost$))
				}),
				concatAll()
			)
			.subscribe(async (awareness) => {
				const connectedPlayerIds = [...awareness.values()].map((s) => s.playerId)
				for (let player of await this.players) {
					if (connectedPlayerIds.includes(player.id)) continue
					await this.sendMessage(`${player.name} has disconnected`, true)
				}
			})
		// this.subscription.add(
		// 	this.yClient
		// 		.observeAwareness(true)
		// 		.pipe(
		// 			map(async (a) => {
		// 				const host = await this.host()
		// 				let playerId = until(() => P.player()?.id)
		// 				if (!host || host.id !== (await playerId)) return []
		// 				return [a]
		// 			}),
		// 			mergeAll(), // merge promise
		// 			mergeAll() // merge arrays
		// 		)
		// 		.subscribe(async () => {
		// 			for (let player of await this.players) {
		// 				if ((await this.connectedPlayers()).map((p) => p.id).includes(player.id)) continue
		// 				await this.sendMessage(`${player.name} has disconnected`, true)
		// 			}
		// 		})
		// )
		//#endregion

		this.wsProvider.once('connection-error', (e: any) => {
			console.error('connection error: ', e)
		})
	}
}

export async function connectToRoom(roomId: string | null, isNewRoom = false) {
	let _room = room()
	if (_room && roomId && _room.roomId === roomId) {
		throw new Error(`already in room ${roomId}`)
	}
	if (!roomId) {
		roomId = await createId(6)
	}

	_room && (await _room.destroy())

	_room = new Room(roomId, await until(() => P.player()?.id), isNewRoom)
	setRoom(_room)

	const status = await firstValueFrom(_room.yClient.connectionStatus$.pipe(filter((s) => s === 'connected')))
	console.log({ status })

	return status
}

// TODO we should realy be resolving host to a client, not to a player, as a player can have multiple clients
function resolveHost(players: RoomParticipant[]) {
	return players.sort((a, b) => a.joinTs - b.joinTs)[0]
}
