import * as ws from 'ws'
import * as http from 'http'
import { NewNetworkResponse, WSMessage } from '../utils/sharedStore.ts'
import { BehaviorSubject, concatMap, EMPTY, firstValueFrom, Observable, share, switchMap } from 'rxjs'

const networks = new Map<string, Network>()
type Network = {
	cleanupAt: number | null
	leader$: BehaviorSubject<Client | undefined>
	leader?: Client
	followers: Client[]
}

type Client = {
	socket: ws.WebSocket
	clientId: string
	message$: Observable<WSMessage>
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

function getCleanupTime() {
	return Date.now() + 1000 * 30
}

function getMessage$(socket: ws.WebSocket, networkId: string, clientId: string): Observable<WSMessage> {
	return new Observable<WSMessage>((s) => {
		socket.on('message', (data) => {
			const message = JSON.parse(data.toString()) as WSMessage
			console.log(`${networkId}:${clientId} sent`, message)
			s.next(message)
		})
	}).pipe(share())
}

export function startServer(port: number) {
	console.log('start')
	const server = new http.Server()
	const wss = new ws.WebSocketServer({ server })

	server.on('request', (request, response) => {
		if (request.url === '/networks/new') {
			const networkId = createId(6)
			networks.set(networkId, {
				cleanupAt: getCleanupTime(),
				followers: [],
				leader$: new BehaviorSubject<Client | undefined>(undefined),
				get leader() {
					return this.leader$.value
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

	wss.on('connection', (socket, request) => {
		if (!request.url) return
		const match = request.url!.match(/networks\/(.+)/)
		if (!match) {
			socket.close()
			return
		}
		const networkId = match[1]

		const network = networks.get(networkId)
		if (!network) {
			socket.close()
			return
		}

		console.log('new socket connected to network ' + networkId)

		const isLeader = !network.leader

		const clientId = createId(6)
		const client: Client = {
			socket,
			clientId,
			message$: getMessage$(socket, networkId, clientId),
		}
		if (isLeader) {
			network.leader$.next(client)
		} else {
			network.followers.push(client)
		}

		const subscription = client.message$.subscribe(async (message) => {
			switch (message.type) {
				case 'mutation': {
					if (message.commit && !isLeader) {
						throw new Error('follower sent committed mutation')
					}

					if (!message.commit && isLeader) {
						throw new Error('leader sent non-committed mutation')
					}

					if (message.commit && isLeader) {
						for (let follower of network!.followers) {
							follower.socket.send(JSON.stringify(message))
						}
					}

					if (!message.commit && client.clientId !== network.leader!.clientId) {
						network.leader!.socket.send(JSON.stringify(message))
					}
					break
				}
				case 'request-network-details': {
					console.log('requesting network details')
					if (isLeader) console.warn('leader requesting state is redundant')
					network.leader!.socket.send(JSON.stringify({ type: 'request-state' } satisfies WSMessage))
					const stateResponse = await firstValueFrom(
						network.leader$.pipe(
							switchMap((leader) => {
								if (!leader) return EMPTY as Observable<WSMessage>
								return leader.message$
							}),
							concatMap((m) => (m.type === 'state' ? [m] : []))
						)
					)
					console.log('sending network details')
					const message: WSMessage = {
						type: 'network-details',
						details: {
							leader: isLeader,
							state: stateResponse.state,
							lastMutationIndex: stateResponse.lastMutationIndex,
							networkId,
						},
					}
					socket.send(JSON.stringify(message))
				}
			}
		})

		socket.on('close', () => {
			subscription.unsubscribe()
			if (network.leader?.clientId === client.clientId) {
			}
		})
	})

	// server.on('upgrade', (request, socket, head) => {
	// 	wss.handleUpgrade(request, socket, head, (ws) => {
	// 		wss.emit('connection', ws, request)
	// 	})
	// })

	server.listen(port, () => {
		console.log('server started on port ', port)
	})
}

startServer(8080)
