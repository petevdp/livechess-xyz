import { createStore } from 'solid-js/store'
import { concatMap, firstValueFrom, Observable, share, Subscription } from 'rxjs'
import * as _ from 'lodash'
import { isEmpty } from 'lodash'
import { createSignal, onCleanup } from 'solid-js'

export function createSharedStore<T extends object>(
	provider: WebsocketNetProvider,
	details?: NetworkDetailsResponse,
	startingState?: T
) {
	startingState ||= {} as T
	const [initialized, setInitialized] = createSignal(false)
	const appliedMutations = [] as StoreMutation[]
	if (details && startingState) {
		appliedMutations.length = details.lastMutationIndex
		setInitialized(true)
	} else if (details) {
		throw new Error('Cannot initialize new shared store without starting state')
	}

	const [rollbackStore, setRollbackStore] = createStore<T>(startingState)
	// mutations currently applied to the rollback store
	const previousValues = new Map<number, any>()
	const [lockstepStore, setLockstepStore] = createStore<T>(startingState)

	const setStore = (path: (string | number)[], value: any) => {
		if (!initialized()) return
		let mutation = getStoreMutation(path, value, rollbackStore, appliedMutations.length)
		previousValues.set(mutation.index, resolvePath(mutation.path, rollbackStore))
		//@ts-ignore
		setRollbackStore(...path, value)
		appliedMutations.push(mutation)
		if (details!.leader) {
			//@ts-ignore
			setLockstepStore(...path, value)
			provider.broadcastAsCommitted(mutation)
		} else {
			provider.sendToLeader(mutation)
		}
	}

	let subscription = new Subscription()
	//#region handle mutations
	subscription.add(
		provider.observeMutations().subscribe((mutation) => {
			if (!initialized()) return
			if (details!.leader) {
				//#region reconcile createdRoom
				if (mutation.index == appliedMutations.length) {
					//@ts-ignore
					setLockstepStore(...mutation.path, mutation.value)
					appliedMutations.push(mutation)
				} else {
					// ignore, client should soon be receiving any mutations that they missed
					return
				}
				//#endregion
			} else {
				//#region reconcile follower
				const args = [...mutation.path, mutation.value]
				//@ts-ignore
				setLockstepStore(...args)
				if (appliedMutations.length >= mutation.index + 1) {
					const mutationToCompare = appliedMutations[mutation.index]

					if (_.isEqual(mutationToCompare, mutation)) {
						// everything is fine, we don't need to store the previous value anymore
						previousValues.delete(mutation.index)
						return
					}

					// rollback
					for (let mut of appliedMutations.reverse()) {
						if (mut.index === mutation.index) {
							//@ts-ignore
							setRollbackStore(...mut.path, mutation.value)
							previousValues.delete(mut.index)
							break
						} else {
							//@ts-ignore
							setRollbackStore(...mut.path, previousValues.get(mut.index))
							previousValues.delete(mut.index)
						}
					}
					appliedMutations.length = mutation.index
				} else {
					appliedMutations.push(mutation)
					//@ts-ignore
					setRollbackStore(...mutation.path, mutation.value)
				}
				//#endregion
			}
		})
	)
	//#endregion

	//#region handle state dump requests
	subscription.add(
		provider.observeRequestState().subscribe(() => {
			provider.send({ type: 'state', state: encodeContent(rollbackStore), lastMutationIndex: appliedMutations.length })
		})
	)
	//#endregion

	onCleanup(() => {
		subscription.unsubscribe()
	})
	;(async () => {
		console.log('attempting to initialize')
		if (initialized()) return
		await provider.waitForConnected()
		let state: T = startingState!
		if (isEmpty(state)) {
			console.log('getting network details')
			details = await provider.getNetworkDetails()
			state = parseContent(details!.state!)
			console.log({ state })
		}
		setRollbackStore(state as T)
		setLockstepStore(state as T)
		console.log('initialized')
		setInitialized(true)
		console.log('after initialized')
	})()
	return { rollbackStore, lockstepStore, setStore, initialized }
}

type StoreMutationPath = (string | number | ((t: any) => boolean))[]

type StoreMutation = {
	path: (string | number)[]
	value: any
	index: number
}

function getStoreMutation(path: StoreMutationPath, value: any, state: any, index: number) {
	const serializedPath = [] as (string | number)[]
	for (let part of path) {
		if (typeof part === 'function') {
			serializedPath.push(resolvePath(serializedPath, state).findIndex(part))
		} else {
			serializedPath.push(part)
		}
	}
	return {
		path: serializedPath,
		value,
		index,
	}
}

function resolvePath(path: (string | number)[], store: any) {
	let current = store
	for (let elt of path) {
		current = store[elt]
	}
	return current
}

type Base64String = string

export type NewNetworkResponse = {
	networkId: string
}

export type NetworkDetailsResponse = {
	networkId: string
	leader: boolean
	state?: Base64String
	lastMutationIndex: number
}

export type WSMessage =
	| {
			type: 'mutation'
			commit: boolean
			mutation: Base64String
	  }
	| {
			type: 'network-details'
			details: NetworkDetailsResponse
	  }
	| {
			type: 'request-network-details'
	  }
	| {
			type: 'request-state'
	  }
	| {
			type: 'state'
			state: Base64String
			lastMutationIndex: number
	  }

export class WebsocketNetProvider {
	public ws: WebSocket
	private message$: Observable<WSMessage>
	private connected$: Promise<void>

	constructor(
		private ws: WebSocket,
		public id: string
	) {
		this.message$ = new Observable<WSMessage>((subscriber) => {
			const listener = (event: MessageEvent) => {
				const message = JSON.parse(event.data) as WSMessage
				// if (message.type === 'mutation') {
				// 	if (!message.commit && !this.leader) {
				// 		throw new Error('Non host received non-committed mutation')
				// 	} else if (message.commit && this.leader) {
				// 		throw new Error('Host received committed mutation')
				// 	}
				// }
				console.log(`client:${this.id} received message`, message)

				subscriber.next(message)
			}

			this.ws.addEventListener('message', listener)
			return () => {
				this.ws.removeEventListener('message', listener)
			}
		}).pipe(share())
	}

	waitForConnected() {
		return new Promise<void>((resolve) => {
			if (this.ws.readyState === WebSocket.OPEN) {
				resolve()
				return
			}
			const listener = () => {
				this.ws.removeEventListener('open', listener)
				resolve()
			}
			this.ws.addEventListener('open', listener)
		})
	}

	sendToLeader(mutation: StoreMutation) {
		const message: WSMessage = {
			type: 'mutation',
			commit: false,
			mutation: encodeContent(mutation),
		}
		this.send(message)
	}

	broadcastAsCommitted(mutation: StoreMutation) {
		const message: WSMessage = {
			type: 'mutation',
			commit: true,
			mutation: encodeContent(mutation),
		}
		this.send(message)
	}

	observeMutations(): Observable<StoreMutation> {
		return this.message$.pipe(
			concatMap((message: WSMessage) => {
				if (message.type === 'mutation') return [parseContent(message.mutation)]
				return []
			})
		)
	}

	observeRequestState(): Observable<void> {
		return this.message$.pipe(
			concatMap((message: WSMessage) => {
				if (message.type === 'request-state') return [undefined]
				return []
			})
		)
	}

	async getNetworkDetails(): Promise<NetworkDetailsResponse> {
		this.send({ type: 'request-network-details' })

		return firstValueFrom(
			this.message$.pipe(
				concatMap((message: WSMessage) => {
					console.log('network details: ', message)
					if (message.type === 'network-details') return [message.details]
					return [] as NetworkDetailsResponse[]
				})
			)
		)
	}

	send(message: WSMessage) {
		console.log(`client:${this.id} sending message`, message)
		this.ws.send(JSON.stringify(message))
	}
}

function encodeContent(content: any) {
	return btoa(JSON.stringify(content))
}

function parseContent(content: Base64String) {
	return JSON.parse(atob(content))
}
