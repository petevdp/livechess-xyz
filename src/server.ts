import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import path from 'node:path'
import { fileURLToPath } from 'url'
import fastifyStatic from '@fastify/static'
import { Base64String, ClientConfig, encodeContent, NewNetworkResponse, SharedStoreMessage } from './utils/sharedStore.ts'
import { BehaviorSubject, concatMap, EMPTY, endWith, first, firstValueFrom, interval, mergeMap, Observable, share, switchMap } from 'rxjs'
import * as ws from 'ws'
import fastifyCors from '@fastify/cors'

const networks = new Map<string, Network>()
type Network = {
	id: string
	cleanupAt: number | null
	leader$: BehaviorSubject<Client | null>
	nextLeader?: Client
	leader: Client | null
	clients: Client[]
	followers: Client[]
}

function printNetwork(network: Network) {
	return {
		cleanupAt: network.cleanupAt,
		leader: network.leader?.clientId,
		nextLeader: network.nextLeader?.clientId,
		clients: network.clients.map((c) => c.clientId),
		followers: network.followers.map((c) => c.clientId),
	}
}

const NO_LEADER_MSG_WHITELIST = ['ack-promote-to-leader', 'promote-to-leader'] as SharedStoreMessage['type'][]

class Client {
	message$: Observable<SharedStoreMessage>

	messageToSendBuffer: SharedStoreMessage[] = []

	constructor(
		public socket: ws.WebSocket,
		public clientId: string,
		public network: Network
	) {
		let msgBuffer: SharedStoreMessage[] = []
		this.message$ = new Observable<SharedStoreMessage>((s) => {
			socket.on('message', (data) => {
				const message = JSON.parse(data.toString()) as SharedStoreMessage
				if (this.network.leader) {
					msgBuffer.forEach((m) => {
						console.log(`${this.network.id}:${clientId} sent by client from message buffer`, m)
						this.network.leader!.send(m)
					})
					msgBuffer = []
					console.log(`${this.network.id}:${clientId} sent by client`, message)
					s.next(message)
				} else if (NO_LEADER_MSG_WHITELIST.includes(message.type)) {
					console.log(`${this.network.id}:${clientId} sent by client`, message)
					s.next(message)
				} else {
					console.log(`${this.network.id}:${clientId} sent by client buffered`, message)
					msgBuffer.push(message)
				}
			})
			socket.on('close', () => {
				s.complete()
			})
		}).pipe(share())
	}

	send(msg: SharedStoreMessage) {
		if (this.network.leader) {
			this.messageToSendBuffer.forEach((m) => {
				console.log(`sending to client from message buffer to ${this.network.id}:${this.clientId}`, m)
				this.socket.send(JSON.stringify(m))
			})
			this.messageToSendBuffer = []
			console.log(`sending to client ${this.network.id}:${this.clientId}`, msg)
			this.socket.send(JSON.stringify(msg))
		} else if (NO_LEADER_MSG_WHITELIST.includes(msg.type)) {
			this.socket.send(JSON.stringify(msg))
		} else {
			console.log(`sending to client from message buffer to ${this.network.id}:${this.clientId}`, msg)
			this.messageToSendBuffer.push(msg)
		}
	}
}

function createId(size: number) {
	let result = ''
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	const charactersLength = characters.length
	let counter = 0
	while (counter < size) {
		// TODO use crypto.randomBytes instead
		result += characters.charAt(Math.floor(Math.random() * charactersLength))
		counter += 1
	}
	return result
}

function thirtySecondsFromNow() {
	return Date.now() + 1000 * 30
}

const envToLogger = {
	development: {
		transport: {
			target: 'pino-pretty',
			options: {
				translateTime: 'HH:MM:ss Z',
				ignore: 'pid,hostname',
				color: true,
			},
		},
	},
	production: true,
	test: false,
}
const server = Fastify({ logger: envToLogger.development })

server.register(fastifyWebsocket)
server.register(fastifyCors, () => {
	//@ts-ignore
	return (req, callback) => {
		const corsOptions = {
			// This is NOT recommended for production as it enables reflection exploits
			origin: true,
		}

		// do not include CORS headers for requests from localhost
		if (/^localhost$/m.test(req.headers.origin)) {
			corsOptions.origin = false
		}

		// callback expects two parameters: error and options
		callback(null, corsOptions)
	}
})
server.register(fastifyStatic, { root: path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist') })
//#region websocket routes
server.register(async function () {
	server.get('/networks/:networkId', { websocket: true }, (connection, request) => {
		const socket = connection.socket as unknown as ws.WebSocket
		let network: Network
		//@ts-ignore
		let networkId = request.params.networkId
		//#region retrieve network
		network = networks.get(networkId)!
		if (!network) {
			request.log.info('network not found, closing newly connected client', networkId)
			socket.close()
			return
		}
		//#endregion

		network.cleanupAt = null
		const client = new Client(socket, createId(6), network)

		console.log(`new socket connected to network ${networkId} with clientId ${client.clientId}`)
		console.log(`network before client init: ${client.clientId}`, printNetwork(network))

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
			console.log(`network before client-config: ${client.clientId}`, printNetwork(network))
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
				for (let otherClient of network.clients) {
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
							console.log(`error getting client-controlled-states from client ${otherClient.clientId}, ignoring`)
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
			for (let msg of leaderMsgBuffer) {
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
						console.log('leader committing mutation', message)
						for (let follower of network!.followers) {
							follower.send(message)
						}
					}

					if (!message.commit && !isLeader) {
						console.log('follower sending mutation to leader', message)
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
					for (let client of network.clients) {
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
			console.log(`socket closed for network ${networkId} with clientId ${client.clientId}`)
			subscription.unsubscribe()
			console.log(`network before ws closed: ${client.clientId}`, printNetwork(network))
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
				network.cleanupAt = thirtySecondsFromNow()
			} else {
				// asks clients to remove the disconnected client from their copy of client-controlled-states

				// wait for the new leader to be elected, otherwise we may throw off userspace logic that depends on a leader being set at all times
				// TODO check if we should do this sort of validation elsewhere
				await firstValueFrom(network.leader$.pipe(first((l) => !!l)))
				console.log(`nulling out client-controlled-states for disconnected client (${client.clientId})`)
				const states = encodeContent({ [client.clientId]: null })
				const message: SharedStoreMessage = { type: 'client-controlled-states', states }
				for (let clt of network.clients) {
					if (clt.clientId === client.clientId) continue
					clt.send(message)
				}
			}

			console.log(`network after ws closed: ${client.clientId}`, printNetwork(network))
		})
		//#endregion
	})
})
//#endregion

server.post('/networks', () => {
	const networkId = createId(6)
	networks.set(networkId, {
		id: networkId,
		cleanupAt: thirtySecondsFromNow(),
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
})

//#region clean up networks marked for deletion
interval(1000).subscribe(() => {
	for (let [networkId, network] of networks) {
		if (network.cleanupAt && network.cleanupAt < Date.now()) {
			const sockets = [network.leader, ...network.followers]
			sockets.forEach((s) => s?.socket.close())
			network.leader$.next(null)
			networks.delete(networkId)
		}
	}
})
//#endregion

//@ts-ignore
const port: number = parseInt(process.env.PORT) || 8080
server.listen({port}, (err, address) => {
	if (err) {
		server.log.error(err)
		process.exit(1)
	}
	server.log.info(`server listening on ${address}`)
})
