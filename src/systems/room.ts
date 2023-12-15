import {WebsocketProvider} from "y-websocket";
import {createId} from "../utils/ids.ts";
import * as G from "./game.ts";
import * as Y from "yjs";
import * as P from "./player.ts";
import * as Modal from '../components/Modal.tsx'
import {WS_CONNECTION} from "../config.ts";
import {createEffect, createSignal, getOwner, onCleanup, Owner} from "solid-js";
import {yMapToSignal} from "../utils/yjs.ts";


export const ROOM_STATES = ['pregame', 'in-progress', 'postgame'] as const
export type RoomState = typeof ROOM_STATES[number]
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export const room = (() => {
    const doc = new Y.Doc();

    let players = doc.getMap<P.Player>('players');
    return {
        roomId: null as string | null,
        wsProvider: null as any | null,
        doc,
        details: doc.getMap<any>('details'),
        players: players,
        get otherPlayers() {
            return Array.from(players.values()).filter(p => p.id != P.player().id)
        },
        get config() {
            return this.details.get('config') as G.GameConfig
        },
        get gameState() {
            return this.details.get('status') as RoomState
        },
        get initialized() {
            return !!this.roomId
        }
    }
})();

export async function createRoom(config: G.GameConfig) {
    const roomId = await createId(6);
    await connectToRoom(roomId)
    room.details.set("config", config)
    room.details.set("host", P.player().id)
    room.details.set('status', 'pregame')
    console.log(room.wsProvider.awareness)
}

export function connectToRoom(roomId: string, owner: Owner) {
    if (room.initialized && room.roomId === roomId) {
        throw new Error('already connected to room ' + room.roomId)
    }
    console.log('connecting to room ' + roomId)
    room.roomId = roomId
    room.wsProvider?.destroy()
    room.wsProvider = new WebsocketProvider(WS_CONNECTION, roomId, room.doc)
    return new Promise<boolean>((resolve) => {
        const listener = (e: any) => {
            if (e.status === 'connecting') {
                console.log('connecting...')
                return;
            }
            if (e.status === 'connected') {
                console.log('connected')
                resolve(true)
            } else if (e.status() === 'disconnected') {
                console.log('disconnected')
                resolve(false)
            }
            room.wsProvider.off(listener)
        }
        room.wsProvider.on('status', listener)
        room.wsProvider.on('connection-error', (e: any) => {
            console.log('connection error', e)
            Modal.prompt(owner, 'Connection Error', () => 'There was an error connecting to the room. Please try again later.', true)
        });
    });
}

let watchingAwareness = false

export function useRoomConnection(roomId: string) {

    if (!room.initialized) {
        connectToRoom(roomId, getOwner()!).then(() => {
            console.log('connected to room ' + roomId)
        })
    }

    const [status, setStatus] = createSignal<ConnectionStatus>(room.wsProvider.status)
    const [host,] = yMapToSignal(room.details, 'host')

    room.wsProvider.on('status', (e: any) => {
        console.log({statusEvent: e})
        setStatus(e.status)
    })

    function awarenessListener(e: any) {
        for (let [id, player] of room.players) {
            for (let removed of e.removed) {
                if (player.clientIds.includes(removed.clientId)) {
                    player.clientIds = player.clientIds.filter(id => id !== removed.clientId)
                    if (player.clientIds.length === 0) {
                        room.players.delete(id)
                    } else {
                        room.players.set(id, player)
                    }
                }
            }
        }
    }


    // keep room player state up to date with awareness
    createEffect(() => {
        if (status() === 'connected' && !!host() && host() === P.player().id && !watchingAwareness) {
            watchingAwareness = true
            for (let [id, player] of room.players) {
                for (let clientId of player.clientIds) {
                    if (!room.wsProvider.awareness.states.has(clientId)) {
                        player.clientIds = player.clientIds.filter(id => id !== clientId)
                        if (player.clientIds.length === 0) {
                            room.players.delete(id)
                        } else {
                            room.players.set(id, player)
                        }
                    }
                }
            }
            room.wsProvider.awareness.on('change', awarenessListener)
        }
    })

    onCleanup(() => {
        if (watchingAwareness) {
            room.wsProvider.awareness.off('change', awarenessListener)
            watchingAwareness = false
        }
    })


    return {
        status
    }
}
