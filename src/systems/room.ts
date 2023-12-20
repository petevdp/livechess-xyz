import {WebsocketProvider} from "y-websocket";
import {createId} from "../utils/ids.ts";
import * as G from "./game/game.ts";
import * as GL from "./game/gameLogic.ts";
import * as Y from "yjs";
import {YArrayEvent} from "yjs";
import * as P from "./player.ts";
import * as Modal from '../components/Modal.tsx'
import {WS_CONNECTION} from "../config.ts";
import {createEffect, createSignal, getOwner, onCleanup, Owner, untrack} from "solid-js";

export const ROOM_STATES = ['pregame', 'in-progress', 'postgame'] as const
export type RoomStatus = typeof ROOM_STATES[number]
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export type PlayerActionArgs = {
	type: 'move'
	move: GL.Move
} | {
	type: 'resign' | 'offer-draw' | 'accept-draw' | 'reject-draw'
} | {
	type: 'new-game'
	config: G.GameConfig
	players: [string, string]
};

export type PlayerAction = { playerId: string; } & PlayerActionArgs;

export type ChatMessage = {
	sender: string | null,
	text: string;
}

export type RoomParticipant = P.Player & { spectator: boolean }

export type Room = ReturnType<typeof initRoom>;

export const [room, setRoom] = createSignal<Room | null>(null)

// should be run with owner
export function setupRoom(roomId: string) {
	let _room = room() as Room;
	if (_room) {
		_room.doc.destroy();
		_room.wsProvider.destroy();
	}
	_room = initRoom(roomId);
	if (_room.details.get('host') === P.player().id) {
		// if we're the host, we need to send messages on behalf of the room
		observeActions(actions => {
			_room.doc.transact(() => {
				let msg = '';
				for (let action of actions) {
					switch (action.type) {
						case "resign":
							msg = `${P.player().name} has resigned`
							break;
						case 'new-game': {
							const player = _room.players.get(action.playerId);
							if (!player) {
								console.warn(`player not found when attempting to log message (${action.type}):`, action.playerId)
								return;
							}
							msg = `${player.name} has started a new game`
							break;
						}
					}
				}
				sendMessage(msg, true)
			})
		})
	}

	createEffect(() => {
		if (!_room.wsProvider) return
		_room.awareness.setLocalStateField('playerId', P.player().id)
	})

	setRoom(_room);
}

// reference room().wsProvider instead of this
const [wsProvider, setWsProvider] = createSignal<any | null>(null)

function initRoom(roomId: string) {
	const doc = new Y.Doc();

	return {
		roomId: roomId,
		doc,
		gameConfig: doc.getMap<string>('gameConfig'),
		details: doc.getMap<any>('details'),
		actions: doc.getArray<PlayerAction>('actions'),
		// for anything that both clients can figure out themselves, but we can save some time by caching it
		cache: doc.getMap<any>('cache'),
		chat: doc.getArray<ChatMessage>('chat'),
		players: doc.getMap<RoomParticipant>('players'),
		getPlayerByName(name: string) {
			return [...this.players.values()].find(p => p.name === name)
		},
		get wsProvider() {
			return wsProvider()
		},
		get connectedPlayers() {
			return [...new Set([...this.awareness.states.values()].map(s => s.playerId))]
		},
		get host() {
			return this.details.get('host') as string
		},
		get isHost() {
			return this.host === P.player().id
		},
		get guest() {
			return this.connectedPlayers.find(p => p !== this.host)
		},
		get awareness() {
			return this.wsProvider?.awareness;
		}
	}
}

export function dispatchAction(action: PlayerActionArgs) {
	console.log(`dispatching action of type '${action.type}'`)
	room()!.actions.push([{
		playerId: P.player().id,
		...action
	} as PlayerAction])
}

export function setRoomState(state: RoomStatus) {
	room()!.details.set('status', state)
}

export function sendMessage(message: string, isSystem: boolean) {
	room()!.chat.push([{sender: isSystem ? null : P.player().name, text: message}])
}

export function startGame() {
	dispatchAction({
		type: 'new-game',
		config: room()!.gameConfig.toJSON() as G.GameConfig,
		players: [room()!.host, room()!.guest]
	})
	setRoomState('in-progress')
}

export function observeActions(callback: (actions: PlayerAction[]) => void) {
	function listener(e: YArrayEvent<PlayerAction>) {
		const actions = e.changes.delta
			.filter(c => c.insert)
			.map(c => c.insert)
			.flat() as PlayerAction[];
		if (actions.length == 0) return;
		callback(actions);
	}

	createEffect(() => {
		room()?.actions.observe(listener)
	});

	onCleanup(() => {
		room()?.actions.unobserve(listener)
	})
}

// not the room's "owner", this is a solidjs thing
export async function createRoom(owner: Owner, id?: string) {
	const roomId = id || await createId(6);
	await connectToRoom(roomId, owner)
	room()!.details.set('host', P.player().id)
	room()!.doc.transact(() => {
		for (let [k, v] of Object.entries(G.defaultGameConfig)) {
			room()!.gameConfig.set(k, v)
		}
		room()!.details.set('status', 'pregame');
	})
}

export function connectToRoom(roomId: string, owner: Owner) {
	setupRoom(roomId)
	const _room = room() as Room;

	setWsProvider(new WebsocketProvider(WS_CONNECTION, roomId, _room.doc))
	return new Promise<boolean>((resolve) => {
		const listener = (e: any) => {
			if (e.status === 'connecting') {
				console.log('connecting...')
				return;
			}
			if (e.status === 'connected') {
				console.log('connected to ' + roomId)
				sendMessage(P.player().name + ` has connected ${_room.isHost ? '(Host)' : ''}`, true);
				_room.players.set(P.player().id, {
					id: P.player().id,
					name: P.player().name,
					spectator: _room.players.get(P.player().id)?.spectator ?? _room.players.size < 2
				})
				resolve(true)
			} else if (e.status() === 'disconnected') {
				console.log('disconnected from ' + roomId)
				resolve(false)
			}
			_room.wsProvider.off(listener)
		}
		_room.wsProvider.on('status', listener)
		_room.wsProvider.on('connection-error', (e: any) => {
			console.log('connection error', e)
			Modal.prompt(owner, 'Connection Error', () => 'There was an error connecting to the room. Please try again later.', true)
		});
	});
}

export function useRoomConnection(roomId: string) {
	const [connect, _setConnect] = createSignal(false)

	const [status, setStatus] = createSignal<ConnectionStatus>(room()?.wsProvider.status || 'disconnected')

	function statusListener(e: any) {
		setStatus(e.status)
	}

	createEffect(() => {
		if (!connect()) return
		untrack(() => {
			connectToRoom(roomId, getOwner()!)
			room()!.wsProvider.on('status', statusListener)
		})
	})

	onCleanup(() => {
		room()?.wsProvider.off('status', statusListener)
	})

	function setConnect() {
		if (status() === 'connected') return
		_setConnect(true)
	}

	return [status, setConnect] as const
}
