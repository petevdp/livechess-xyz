import { FastifyBaseLogger } from 'fastify';
import { BehaviorSubject, EMPTY, Observable, Subscription, concatMap, delay, endWith, first, firstValueFrom, interval, mergeMap, of, share, switchMap } from 'rxjs';
import * as ws from 'ws';



import { createId } from '~/utils/ids.ts';
import { Base64String, ClientConfig, NewNetworkResponse, SharedStoreMessage, encodeContent } from '~/utils/sharedStore.ts';


const NO_LEADER_MSG_WHITELIST = ['ack-promote-to-leader', 'promote-to-leader'] as SharedStoreMessage['type'][]
const NO_ACTIVITY_TIMEOUT = 1000 * 60 * 20

const networks = new Map<string, Network>()
type Network = {
	id: string
	timeoutAt: number | null
	leader$: BehaviorSubject<Client | null>
	nextLeader?: Client
	leader: Client | null
	clients: Client[]
	followers: Client[]
}

function printNetwork(network: Network) {
	return {
		networkId: network.id,
		cleanupAt: network.timeoutAt,
		leader: network.leader?.clientId,
		nextLeader: network.nextLeader?.clientId,
		clients: network.clients.map((c) => c.clientId),
		followers: network.followers.map((c) => c.clientId),
	}
}

class Client {
	message$: Observable<SharedStoreMessage>

	private log: FastifyBaseLogger
	private sub: Subscription

	constructor(
		public socket: ws.WebSocket,
		public clientId: string,
		public network: Network,
		log: FastifyBaseLogger
	) {
		this.log = log.child({ clientId })

		this.sub = this.network.leader$.subscribe(() => {
			this.log = log.child({ leader: network.leader?.clientId === clientId })
		})

		let msgBuffer: SharedStoreMessage[] = []
		this.message$ = new Observable<SharedStoreMessage>((s) => {
			socket.on('message', (data) => {
				const message = JSON.parse(data.toString()) as SharedStoreMessage
				if (this.network.leader) {
					msgBuffer.forEach((m) => {
						this.log.info('processing &s sent by client from message buffer', m.type)
						this.network.leader!.send(m)
					})
					msgBuffer = []
					this.log.info('%s sent by client', message.type)
					s.next(message)
				} else if (NO_LEADER_MSG_WHITELIST.includes(message.type)) {
					this.log.info(`%s sent by client`, message.type)
					s.next(message)
				} else {
					this.log.info(`%s sent by client (buffering)`, message.type)
					msgBuffer.push(message)
				}
			})
			socket.on('close', () => {
				s.complete()
			})
		}).pipe(share())
	}

	messageToSendBuffer: SharedStoreMessage[] = []
	send(msg: SharedStoreMessage) {
		if (this.network.leader) {
			this.messageToSendBuffer.forEach((m) => {
				this.log.info('sending %s to client from message buffer to')
				this.socket.send(JSON.stringify(m))
			})
			this.messageToSendBuffer = []
			this.log.info(`sending %s to client`, msg.type)
			this.socket.send(JSON.stringify(msg))
		} else if (NO_LEADER_MSG_WHITELIST.includes(msg.type)) {
			this.socket.send(JSON.stringify(msg))
		} else {
			this.log.info('sending to %s client from message buffer ')
			this.messageToSendBuffer.push(msg)
		}
	}

	destroy() {
		this.sub.unsubscribe()
	}
}

function thirtySecondsFromNow() {
	return Date.now() + 1000 * 30
}

export function createNetwork() {
	const networkId = createId(6)
	networks.set(networkId, {
		id: networkId,
		timeoutAt: thirtySecondsFromNow(),
		followers: [],
		leader$: new BehaviorSubject<Client | null>(null),
		get leader() {
			return this.leader$.value
		},
		get clients() {
			const clients = [...this.followers]
			if (this.leader) clients.push(this.leader)
			return clients
		},
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
	const client = new Client(socket, createId(6), network, log)
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

	log = log.child({ clientId: client.clientId })
	log.info(`client connecting to network %s`, networkId, printNetwork(network))
	//#endregion

	//#region dispatch initial events
	;(async () => {
		// if we're the only client, we're the leader. otherwise, there's already a leader or we're waiting for one to be elected
		if (network.clients.length === 0) {
			network.leader$.next(client)
		} else {
			network.followers.push(client)
		}

		//#region get config for new client
		let initialState: Base64String
		let lastMutationIndex: number
		if (network.leader?.clientId === client.clientId) {
			// if we're the leader and we're just connecting, it means we're the first client
			initialState = encodeContent({})
			lastMutationIndex = -1
		} else {
			const stateResponsePromise = firstValueFrom(
				network.leader$.pipe(
					switchMap((leader) => {
						if (!leader) return EMPTY as Observable<SharedStoreMessage>
						leader.send({ type: 'request-state' })
						return leader.message$
					}),
					concatMap((m) => (m.type === 'state' ? [m] : [])),
					endWith(null)
				)
			)

			const stateResponse = await stateResponsePromise
			if (!stateResponse) throw new Error('did not receive state from leader')
			lastMutationIndex = stateResponse.lastMutationIndex
			initialState = stateResponse.state
		}
		const config: ClientConfig<Base64String> = {
			clientId: client.clientId,
			initialState,
			leader: network.leader?.clientId === client.clientId,
			lastMutationIndex,
		}
		//#endregion

		client.send({ type: 'client-config', config })

		//#region send client-controlled-states to new client
		if (network.leader?.clientId !== client.clientId) {
        for (const otherClient of network.clients) {
					if (otherClient.clientId === client.clientId) continue
					const state$ = firstValueFrom(
						otherClient.message$.pipe(
							mergeMap((m) => {
								return m.type === 'client-controlled-states' && m.forClient === client.clientId ? [m.states] : []
							}),
							endWith(null)
						)
					)
					state$
						.catch(() => {
							log.info(`error getting client-controlled-states from client ${otherClient.clientId}, ignoring`)
						})
						.then((state) => {
							if (!state) return
							client.send({ type: 'client-controlled-states', states: state })
						})
					otherClient.send({
						type: 'request-client-controlled-states',
						forClient: client.clientId,
					})
				}
		}

		//#endregion
	})().then(() => {})

	//#endregion

	//#region client message handling

	//#region passing messages to leader
	let leaderMsgBuffer: SharedStoreMessage[] = []
	network.leader$.subscribe((leader) => {
		if (!leader) return
      for (const msg of leaderMsgBuffer) {
			leader.send(msg)
		}
		leaderMsgBuffer = []
	})

	function sendToLeaderBuffered(message: SharedStoreMessage) {
		if (!network.leader) {
			leaderMsgBuffer.push(message)
			return
		}
		network.leader.send(message)
	}

	//#endregion
	async function handleMessageFromClient(message: SharedStoreMessage, sender: Client) {
		const isLeader = sender.clientId === network.leader?.clientId
		switch (message.type) {
			case 'mutation': {
				if (message.commit && !isLeader) {
					throw new Error('follower sent committed mutation')
				}

				if (!message.commit && isLeader) {
					// this is possible if there was still a message in flight when a new leader was elected
					// just pretend that it was from a regular follower and send it back to be committed
					message.commit = false
				}

				if (message.commit && isLeader) {
					for (const follower of network!.followers) {
						follower.send(message)
					}
				}

				if (!message.commit && !isLeader) {
					sendToLeaderBuffered(message)
				}
				break
			}
			case 'ack-promote-to-leader': {
				if (isLeader) {
					throw new Error('leader acking promote to leader is redundant, figure out why this happened')
				}
				if (!network.nextLeader) {
					throw new Error('nextLeader was not set when ack-promote-to-leader was received')
				}
				if (network.nextLeader?.clientId !== sender.clientId) {
					// another client has already become the leader, ignore
					break
				}
				delete network.nextLeader
				network.followers = network.followers.filter((c) => c.clientId !== sender.clientId)
				network.leader$.next(sender)
				break
			}
			case 'client-controlled-states': {
				// we handle this in the initial dispatch
				if (message.forClient) break
          for (const client of network.clients) {
					if (client.clientId === sender.clientId) continue
					client.send(message)
				}
				break
			}
			// we may get message types that are known that end up here, like 'client-controlled-states',
			// because we don't need them outside a particular context. If this happens though, we should probably know about it
			default: {
				console.warn('received unhandled message type', message)
			}
		}
	}

	const subscription = client.message$.subscribe(async (message) => {
		handleMessageFromClient(message, client)
	})
	//#endregion

	//#region client cleanup
	socket.on('close', async () => {
		log.info(`client %s disconnected`, client.clientId)
		subscription.unsubscribe()
		network.followers = network.followers.filter((c) => c.clientId !== client.clientId)
		if (network.leader?.clientId === client.clientId) {
			network.leader$.next(null)
			network.nextLeader = network.followers[0]
			network.nextLeader?.send({ type: 'promote-to-leader' })
		} else if (network.nextLeader?.clientId === client.clientId) {
			network.nextLeader = network.followers[0]
			network.nextLeader?.send({ type: 'promote-to-leader' })
		}

		if (network.clients.length === 0) {
			network.timeoutAt = thirtySecondsFromNow()
		} else {
			// asks clients to remove the disconnected client from their copy of client-controlled-states

			// wait for the new leader to be elected, otherwise we may throw off userspace logic that depends on a leader being set at all times
			await firstValueFrom(network.leader$.pipe(first((l) => !!l)))
			log.info(`nulling out client-controlled-states for disconnected client %s`, client.clientId)
			const states = encodeContent({ [client.clientId]: null })
			const message: SharedStoreMessage = {
				type: 'client-controlled-states',
				states,
			}
			for (const clt of network.clients) {
				if (clt.clientId === client.clientId) continue
				clt.send(message)
			}
		}
		client.destroy()
	})
	//#endregion
}

export function setupSharedStoreSystem(log: FastifyBaseLogger) {
	//#region clean up networks marked for deletion
	interval(1000).subscribe(() => {
      for (const [networkId, network] of networks) {
				if (network.timeoutAt && network.timeoutAt < Date.now()) {
					log.info(`cleaning up network %s`, networkId, printNetwork(network))
					const sockets = [network.leader, ...network.followers]
					sockets.forEach((s) => s?.socket.close())
					network.leader$.next(null)
					networks.delete(networkId)
				}
			}
	})
	//#endregion
}
