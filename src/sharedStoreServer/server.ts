import * as ws from 'ws'
import * as http from 'http'
import { Base64String, ClientConfig, encodeContent, NewNetworkResponse, SharedStoreMessage } from '../utils/sharedStore.ts'
import {
	BehaviorSubject,
	concatMap,
	EMPTY,
	endWith,
	first,
	firstValueFrom,
	from,
	interval,
	mergeAll,
	Observable,
	share,
	switchMap,
} from 'rxjs'
import { map } from 'rxjs/operators'

// TODO add tld support

const networks = new Map<string, Network>()
type Network = {
	cleanupAt: number | null
	leader$: BehaviorSubject<Client | undefined>
	nextLeader?: Client
	leader?: Client
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

class Client {
	message$: Observable<SharedStoreMessage>

	constructor(
		public socket: ws.WebSocket,
		public clientId: string,
		public networkId: string
	) {
		this.message$ = new Observable<SharedStoreMessage>((s) => {
			socket.on('message', (data) => {
				const message = JSON.parse(data.toString()) as SharedStoreMessage
				console.log(`${networkId}:${clientId} sent`, message)
				s.next(message)
			})
			socket.on('close', () => {
				s.complete()
			})
		}).pipe(share())
	}

	send(msg: SharedStoreMessage) {
		console.log(`sending to ${this.networkId}:${this.clientId}`, msg)
		this.socket.send(JSON.stringify(msg))
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

export function startServer(port: number) {
	const server = new http.Server()
	const wss = new ws.WebSocketServer({ server })

	//#region rest api
	server.on('request', (request, response) => {
		if (request.url === '/networks/new') {
			const networkId = createId(6)
			networks.set(networkId, {
				cleanupAt: thirtySecondsFromNow(),
				followers: [],
				leader$: new BehaviorSubject<Client | undefined>(undefined),
				get leader() {
					return this.leader$.value
				},
				get clients() {
					const clients = [...this.followers]
					if (this.leader) clients.push(this.leader)
					return clients
				},
			})

			response.writeHead(200, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			})
			const body: NewNetworkResponse = { networkId }

			response.end(JSON.stringify(body))
			return
		}
	})
	//#endregion

	//#region websocket events
	wss.on('connection', async (socket, request) => {
		let network: Network
		let networkId: string
		//#region retrieve network
		if (!request.url) return
		{
			const match = request.url!.match(/networks\/(.+)/)
			if (!match) {
				socket.close()
				return
			}
			networkId = match[1]
			network = networks.get(networkId)!
			if (!network) {
				console.log('network not found, closing newly connected client', networkId)
				socket.close()
				return
			}
		}
		//#endregion

		network.cleanupAt = null

		const client = new Client(socket, createId(6), networkId)

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
							return leader.message$
						}),
						concatMap((m) => (m.type === 'state' ? [m] : [])),
						endWith(null)
					)
				)
				console.log('requesting state from leader')
				network.leader$
					.pipe(
						concatMap((leader) => (!!leader ? [leader] : [])),
						first()
					)
					.subscribe((leader) => {
						leader.send({ type: 'request-state' })
					})

				const stateResponse = await stateResponsePromise
				if (!stateResponse) throw new Error('did not receive state from leader')
				lastMutationIndex = stateResponse.lastMutationIndex
				initialState = stateResponse.state
			}
			console.log({ clientId: client.clientId })
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
				let states$: Promise<Base64String | null>[] = []
				for (let _client of network.clients) {
					if (_client.clientId === client.clientId) continue
					const state$ = _client.message$.pipe(
						map((m) => {
							return m.type === 'client-controlled-states' && m.forClient === client.clientId ? m.states : null
						}),
						endWith(null)
					)
					try {
						await firstValueFrom(state$)
					} catch (e) {
						console.warn('did not receive client-controlled-states from client', _client.clientId)
						console.error(e)
					}
					_client.send({
						type: 'request-client-controlled-states',
						forClient: client.clientId,
					})
				}

				from(states$)
					.pipe(
						mergeAll(),
						concatMap((s) => (!!s ? [s] : []))
					)
					.subscribe((states) => {
						client.send({ type: 'client-controlled-states', states })
					})
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

		//#region socket cleanup
		socket.on('close', () => {
			console.log(`socket closed for network ${networkId} with clientId ${client.clientId}`)
			subscription.unsubscribe()
			console.log(`network before ws closed: ${client.clientId}`, printNetwork(network))
			network.followers = network.followers.filter((c) => c.clientId !== client.clientId)
			if (network.leader?.clientId === client.clientId) {
				network.leader$.next(undefined)
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
				const states = encodeContent({ [client.clientId]: null })
				const message: SharedStoreMessage = { type: 'client-controlled-states', states }
				for (let client of network.clients) {
					if (client.clientId === client.clientId) continue
					client.send(message)
				}
			}

			console.log(`network after ws closed: ${client.clientId}`, printNetwork(network))
		})
		//#endregion
	})
	//#endregion

	//#region clean up networks marked for deletion
	interval(1000).subscribe(() => {
		for (let [networkId, network] of networks) {
			if (network.cleanupAt && network.cleanupAt < Date.now()) {
				const sockets = [network.leader, ...network.followers]
				sockets.forEach((s) => s?.socket.close())
				network.leader$.complete()
				networks.delete(networkId)
			}
		}
	})
	//#endregion

	server.listen(port, () => {
		console.log('server started on port ', port)
	})
}

startServer(8080)