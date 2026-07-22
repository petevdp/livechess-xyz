import { FastifyBaseLogger } from 'fastify'
import { Logger } from 'pino'
import { Observable, Subject, Subscription, delay, endWith, filter, first, firstValueFrom, interval, of, share, switchMap } from 'rxjs'
import { createRoot } from 'solid-js'
import * as ws from 'ws'

import { initServerSideRoomLogic } from '~/server/serverSideRoomLogic.ts'
import {
	ClientConfig,
	type NewNetworkResponse,
	type OpsRejectedReason,
	SharedStore,
	type SharedStoreMessage,
	Transport,
	initLeaderStore,
} from '~/sharedStore/sharedStore.ts'
import * as RO from '~/systems/roomOps.ts'
import { createId } from '~/utils/ids.ts'

const NO_ACTIVITY_TIMEOUT = 1000 * 60 * 20

const networks = new Map<string, Network>()

type State = RO.RoomState
type CCS = RO.ClientOwnedState
type Msg = SharedStoreMessage<RO.RoomOp, State, CCS>

type Network = {
	id: string
	timeoutAt: number | null
	message$: Subject<Msg>
	dispose: () => void
	store: SharedStore<State, RO.RoomOp, RO.RoomEvent, CCS>
	clients: Map<string, Client<Msg>>
}

function printNetwork(network: Network) {
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

	log: Logger
	sub: Subscription = new Subscription()

	constructor(
		public socket: ws.WebSocket,
		public clientId: string,
		log: Logger
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
		if (msg.type === 'ops') {
			log.info('%s received ops: %s', networkId, msg.ops.map((op) => `${op.opId}:${op.code}`).join(', '))
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
		const store = initLeaderStore<State, RO.RoomOp, RO.RoomEvent, CCS>(
			leaderTransport,
			RO.roomStoreDefinition,
			{ log: log as Logger },
			RO.getInitialRoomState()
		)
		initServerSideRoomLogic(store)
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

export function handleNewConnection(socket: ws.WebSocket, networkId: string, log: Logger) {
	//#region retrieve network and create client
	const network = networks.get(networkId)!
	if (!network) {
		log.info('network not found, closing newly connected client', networkId)
		socket.close()
		return
	}

	network.timeoutAt = null
	const client = new Client(socket, createId(6), log as Logger)
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

	// have leader process client messages. op batches are validated first: server-only codes are
	// never accepted from clients, an op claiming to act as a player must come from a client
	// registered (via client-controlled-states) as that player, and client-reported timestamps must
	// be plausible on the server's clock. a failing batch is rejected whole (batches are
	// all-or-nothing): the originator is told so it can roll back its optimistic copy.
	client.sub.add(
		client.message$.subscribe((msg) => {
			if (msg.type === 'ops') {
				const reject = (reason: OpsRejectedReason) => {
					client.log.warn(reason, 'rejecting op batch: %s', reason.code)
					client.send({ type: 'ops-rejected', opIds: msg.ops.map((op) => op.opId), reason })
				}
				const registeredPlayerId = network.store.clientControlled.states[client.clientId]?.playerId
				const unauthorized = msg.ops.find((op) => {
					if (RO.SERVER_AUTHORED_OP_CODES.has(op.code)) return true
					const author = RO.opAuthor(op)
					return author !== null && author !== registeredPlayerId
				})
				if (unauthorized) {
					reject({ code: 'unauthorized', message: 'Action rejected: you are not allowed to perform it.' })
					return
				}
				const timeReason = RO.validateOpTimestamps(network.store.snapshot(), msg.ops, Date.now())
				if (timeReason) {
					reject(timeReason)
					return
				}
			}
			network.message$.next(msg)
		})
	)

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
		}
		// removes the disconnected client from every copy of client-controlled-states. this also has
		// to go through the leader's own message stream: the leader's copy seeds the config snapshot
		// for (re)connecting clients and drives the server-side connection tracking, so a stale entry
		// there leaks to late joiners and masks disconnects
		log.info(`nulling out client-controlled-states for disconnected client %s`, client.clientId)
		const message: Msg = {
			type: 'client-controlled-states',
			states: { [client.clientId]: null },
		}
		network.message$.next(message)
		for (const clt of network.clients.values()) {
			clt.send(message)
		}
		client.destroy()
	})
	//#endregion

	const config: ClientConfig<State, RO.RoomOp, CCS> = {
		clientId: client.clientId,
		state: network.store.snapshot(),
		ops: network.store.history(),
		clientControlledStates: network.store.clientControlled.states,
		serverTime: Date.now(),
	}

	log.info(`sending client-config to client %s`, client.clientId)
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
