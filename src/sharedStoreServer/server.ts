import * as ws from 'ws'
import * as http from 'http'
import { NewNetworkResponse, SharedStoreMessage } from '../utils/sharedStore.ts'
import { BehaviorSubject, concatMap, EMPTY, firstValueFrom, interval, Observable, share, switchMap } from 'rxjs'

// TODO add tld support

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
	message$: Observable<SharedStoreMessage>
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

function thirtySeconsFromNow() {
	return Date.now() + 1000 * 30
}

function getMessage$(socket: ws.WebSocket, networkId: string, clientId: string): Observable<SharedStoreMessage> {
	return new Observable<SharedStoreMessage>((s) => {
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

export function startServer(port: number) {
	const server = new http.Server()
	const wss = new ws.WebSocketServer({ server })

	//#region rest api
	server.on('request', (request, response) => {
		if (request.url === '/networks/new') {
			const networkId = createId(6)
			networks.set(networkId, {
				cleanupAt: thirtySeconsFromNow(),
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
	//#endregion

	//#region websockets
	wss.on('connection', (socket, request) => {
		if (!request.url) return
		const match = request.url!.match(/networks\/(.+)/)
		if (!match) {
			socket.close()
			return
		}
		const networkId = match[1]

		const network = networks.get(networkId)!
		if (!network) {
			socket.close()
			return
		}
		network.cleanupAt = null


		const clientId = createId(6)
		console.log(`new socket connected to network ${networkId} with clientId ${clientId}`)
		const client: Client = {
			socket,
			clientId,
			message$: getMessage$(socket, networkId, clientId),
		}

		// If there are existing followers then a new leader is already being elected
		if (!network.leader && network.followers.length === 0) {
			network.leader$.next(client)
		} else {
			network.followers.push(client)
		}

		async function handleMessage(
			message: SharedStoreMessage,
			sender: Client,
			leader: Client
		) {
			const isLeader = sender.clientId === leader.clientId
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
							follower.socket.send(JSON.stringify(message))
						}
					}

					if (!message.commit && !isLeader) {
						console.log('follower sending mutation to leader', message)
						leader.socket.send(JSON.stringify(message))
					}
					break
				}
				case 'request-network-details': {
					console.log('requesting network details')
					if (isLeader) console.warn('leader requesting state is redundant')
					leader.socket.send(JSON.stringify({type: 'request-state'} satisfies SharedStoreMessage))
					const stateResponse = await firstValueFrom(
						network.leader$.pipe(
							switchMap((leader) => {
								if (!leader) return EMPTY as Observable<SharedStoreMessage>
								return leader.message$
							}),
							concatMap((m) => (m.type === 'state' ? [m] : []))
						)
					)
					console.log('sending network details')
					const message: SharedStoreMessage = {
						type: 'network-details',
						details: {
							leader: isLeader,
							state: stateResponse.state,
							lastMutationIndex: stateResponse.lastMutationIndex,
							networkId,
						},
					}
					sender.socket.send(JSON.stringify(message))
					break
				}
				case 'ack-promote-to-leader': {
					if (isLeader) {
						throw new Error('leader acking promote to leader is redundant')
					}
					network.leader$.next(client)
					break
				}
			}
		}

		let missingLeaderBuffer: SharedStoreMessage[] = []
		const subscription = client.message$
			.subscribe(async (message) => {
				if (!network.leader) {
					missingLeaderBuffer.push(message)
					return
				}
				for (let msg of missingLeaderBuffer) {
					await handleMessage(msg, client, network.leader!)
				}
				missingLeaderBuffer = []
				handleMessage(message, client, network.leader!)
			})

		socket.on('close', () => {
			subscription.unsubscribe()
			if ((network.leader ? 1 : 0) + network.followers.length === 0) {
				network.cleanupAt = thirtySeconsFromNow()
				return
			}

			if (network.leader?.clientId === client.clientId) {
				network.leader$.next(undefined)
				const nextLeader = network.followers.shift()
				if (nextLeader) {
					nextLeader.socket.send(JSON.stringify({type: 'promote-to-leader'}))
				}
			}
		})
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
