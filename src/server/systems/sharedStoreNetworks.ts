import { FastifyBaseLogger } from 'fastify'
import { Observable, Subject, Subscription, delay, endWith, filter, first, firstValueFrom, interval, of, share, switchMap } from 'rxjs'
import { createRoot } from 'solid-js'
import * as ws from 'ws'

import { initServerSideRoomLogic } from '~/server/serverSideRoomLogic.ts'
import { ClientConfig, type NewNetworkResponse, SharedStore, Transport, initLeaderStore } from '~/sharedStore/sharedStore.ts'
import type * as R from '~/systems/room.ts'
import { createId } from '~/utils/ids.ts'

const NO_ACTIVITY_TIMEOUT = 1000 * 60 * 20

const networks = new Map<string, Network<Msg>>()

type Event = unknown
type State = R.RoomState
type CCS = R.ClientOwnedState
type Msg = R.RoomMessage

type Network<Msg extends R.RoomMessage> = {
	id: string
	timeoutAt: number | null
	message$: Subject<Msg>
	dispose: () => void
	store: SharedStore<State, CCS, Event>
	clients: Map<string, Client<Msg>>
}

function printNetwork(network: Network<Msg>) {
	return {
		networkId: network.id,
		cleanupAt: network.timeoutAt,
		followers: [...network.clients.keys()],
	}
}

function thirtySecondsFromNow() {
	return Date.now() + 1000 * 30
}

class Client<_Msg extends Msg> {
	message$: Observable<_Msg>

	log: FastifyBaseLogger
	sub: Subscription = new Subscription()

	constructor(
		public socket: ws.WebSocket,
		public clientId: string,
		log: FastifyBaseLogger
	) {
		this.log = log.child({ clientId })
		this.message$ = new Observable<_Msg>((s) => {
			const onMessage = (data: ws.Data) => {
				const message = JSON.parse(data.toString()) as _Msg
				this.log.info(`%s sent by client`, message.type)
				s.next(message)
			}
			const onClose = () => {
				s.complete()
			}
			socket.on('message', onMessage)
			socket.on('close', onClose)

			return () => {
				socket.off('message', onMessage)
				socket.off('close', onClose)
			}
		}).pipe(share())
	}

	send(msg: _Msg) {
		this.log.info('sending to %s client ', this.clientId)
		this.socket.send(JSON.stringify(msg))
	}

	destroy() {
		this.socket.close()
		this.sub.unsubscribe()
	}
}

export function createNetwork(log: FastifyBaseLogger) {
	const networkId = createId(6)
	const message$ = new Subject<Msg>()
	const clients = new Map<string, Client<Msg>>()
	log = log.child({ networkId })
	const disposed$ = new Subject<void>()
	message$.subscribe((msg) => {
		if (msg.type === 'mutation') {
			log.info('%s received %s: %s', networkId, msg.mutation.mutationId, msg.mutation.events.map((e) => e.type).join(', '))
			log.trace('updated paths: %s', msg.mutation.mutations.map((m) => m.path).join(','), msg.mutation.mutations)
		}
	})
	message$.subscribe({
		complete: () => {
			log.info('message complete')
		},
	})
	createRoot((disposeRoot) => {
		const leaderTransport: Transport<Msg> = {
			message$,
			networkId,
			send(message: Msg) {
				for (const client of clients.values()) {
					client.send(message)
				}
			},
			dispose() {
				for (const client of clients.values()) {
					client.destroy()
				}
				message$.complete()
				disposeRoot()
				disposed$.next()
				disposed$.complete()
			},
			waitForConnected(): Promise<void> {
				return Promise.resolve()
			},
			disposed$: firstValueFrom(disposed$),
		}
		const store = initLeaderStore(leaderTransport) as R.RoomStore
		initServerSideRoomLogic(store, leaderTransport)
		networks.set(networkId, {
			id: networkId,
			message$,
			dispose() {
				leaderTransport.dispose()
			},
			timeoutAt: thirtySecondsFromNow(),
			store: store,
			clients,
		})
	})
	return { networkId } satisfies NewNetworkResponse
}

export function getNetwork(networkId: string) {
	return networks.get(networkId) || null
}

export function handleNewConnection(socket: ws.WebSocket, networkId: string, log: FastifyBaseLogger) {
	//#region retrieve network and create client
	const network = networks.get(networkId)!
	if (!network) {
		log.info('network not found, closing newly connected client', networkId)
		socket.close()
		return
	}

	network.timeoutAt = null
	const client = new Client(socket, createId(6), log)
	network.clients.set(client.clientId, client)
	client.message$
		.pipe(
			// if we don't receive any messages for a while, close the connection
			switchMap(() => delay(NO_ACTIVITY_TIMEOUT)(of(undefined))),
			endWith(null),
			first()
		)
		.subscribe((msg) => {
			if (!msg) return
			client.send({ type: 'message-timeout', idleTime: NO_ACTIVITY_TIMEOUT })
			// cleanup handled in socket.on('close')
			client.socket.close()
		})

	log = client.log
	log.info(`client connecting to network %s`, networkId, printNetwork(network))
	//#endregion

	//#region client message handling

	// have leader process client messages
	client.sub.add(client.message$.subscribe((msg) => network.message$.next(msg)))

	// forward client-controlled-states to all clients
	client.sub.add(
		client.message$.pipe(filter((msg) => msg.type === 'client-controlled-states')).subscribe((msg) => {
			for (const otherClient of network.clients.values()) {
				if (otherClient.clientId === client.clientId) continue
				otherClient.send(msg)
			}
		})
	)
	//#endregion

	//#region client cleanup
	socket.on('close', async () => {
		log.info(`client %s disconnected`, client.clientId)
		network.clients.delete(client.clientId)

		if (network.clients.size === 0) {
			network.timeoutAt = thirtySecondsFromNow()
		} else {
			// asks clients to remove the disconnected client from their copy of client-controlled-states
			log.info(`nulling out client-controlled-states for disconnected client %s`, client.clientId)
			const message: Msg = {
				type: 'client-controlled-states',
				states: { [client.clientId]: null },
			}
			for (const clt of network.clients.values()) {
				clt.send(message)
			}
		}
		client.destroy()
	})
	//#endregion

	const config: ClientConfig<State, CCS> = {
		clientId: client.clientId,
		initialState: network.store.lockstepState,
		lastMutationIndex: network.store.lastMutationIndex,
		clientControlledStates: network.store.clientControlled.states,
	}

	log.info(`sending client-config to client %s`, client.clientId, config)
	client.send({ type: 'client-config', config })
}

export function setupSharedStoreSystem(log: FastifyBaseLogger) {
	//#region clean up networks marked for deletion
	interval(1000).subscribe(() => {
		for (const [networkId, network] of networks) {
			if (network.timeoutAt && network.timeoutAt < Date.now()) {
				log.info(`cleaning up network %s`, networkId, printNetwork(network))
				network.dispose()
				networks.delete(networkId)
			}
		}
	})
	//#endregion
}
