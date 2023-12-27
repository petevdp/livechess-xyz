import { createStore, unwrap } from 'solid-js/store'
import { concatMap, firstValueFrom, Observable, share, Subject, Subscription, tap } from 'rxjs'
import * as _ from 'lodash'
import { batch, createSignal, onCleanup } from 'solid-js'
import { until } from '@solid-primitives/promise'

//#region types

// TODO: strong typing for paths and values like in solid's setStore
type StoreMutation = {
	path: (string | number)[]
	value: any
}

type StoreMutationAtom = {
	index: number
	mutations: StoreMutation[]
}
export type NewNetworkResponse = {
	networkId: string
}

type Base64String = string

export type NetworkClientConfig<T> = {
	networkId: string
	leader: boolean
	state: T
	lastMutationIndex: number
}

export type NetworkDetailsResponse = NetworkClientConfig<Base64String>

export type SharedStoreMessage =
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
	| {
			type: 'promote-to-leader'
	  }
	| {
			type: 'ack-promote-to-leader'
	  }

//#endregion

export function createSharedStore<T extends object>(provider: SharedStoreProvider, config?: NetworkClientConfig<T>) {
	if (config) {
		if (!config.leader) {
			throw new Error('Cannot initialize shared store with non-leader config')
		}
		// clone details so we don't mutate the original(we won't mutate config.state, I promise
		config = { ...config }
	}
	const [initialized, setInitialized] = createSignal(false)
	const appliedAtoms = [] as StoreMutationAtom[]

	const [rollbackStore, setRollbackStore] = createStore<T>({} as T)
	// mutations currently applied to the rollback store
	const previousValues = new Map<number, any[]>()
	const [lockstepStore, setLockstepStore] = createStore<T>({} as T)
	const [isLeader, setIsLeader] = createSignal(config?.leader || false)

	const trackedTransactions = new Set<SharedStoreTransaction>()

	const setStore = async (mutationArgs: StoreMutation, transaction?: SharedStoreTransaction) => {
		await until(initialized)
		let mutation = getStoreMutation(mutationArgs, rollbackStore)
		if (transaction) {
			transaction.push(mutation)
			if (trackedTransactions.has(transaction)) {
				return
			}

			firstValueFrom(transaction.commit$).then((commit) => {
				trackedTransactions.delete(transaction)
				if (!commit) {
					return
				}
				const atom: StoreMutationAtom = {
					index: appliedAtoms.length,
					mutations: transaction.mutations,
				}
				applyLocallyCreatedAtom(atom)
			})

			trackedTransactions.add(transaction)
			return
		}

		const atom: StoreMutationAtom = {
			index: appliedAtoms.length,
			mutations: [mutation],
		}
		applyLocallyCreatedAtom(atom)
	}

	const applyLocallyCreatedAtom = (atom: StoreMutationAtom) => {
		let previous: any[] = []
		batch(() => {
			for (let mutation of atom.mutations) {
				previous.push(resolvePath(mutation.path, rollbackStore))
				//@ts-ignore
				setRollbackStore(...mutation.path, mutation.value)
				if (isLeader()) {
					//@ts-ignore
					setLockstepStore(...mutation.path, mutation.value)
				}
			}
		})

		previousValues.set(atom.index, previous)

		if (isLeader()) {
			provider.broadcastAsCommitted(atom)
		} else {
			provider.sendToLeader(atom)
		}
	}

	//#region handle incoming mutations
	const applyAtomToStore = (atom: StoreMutationAtom, store: (...args: any[]) => any) => {
		for (let mutation of atom.mutations) {
			//@ts-ignore
			store(...mutation.path, mutation.value)
		}
	}

	let subscription = new Subscription()
	subscription.add(
		provider.observeComittedMutations().subscribe(async (receivedAtom) => {
			await until(initialized)
			batch(() => {
				console.debug(`processing atom (${provider.id})`, receivedAtom, appliedAtoms.length)
				if (isLeader()) {
					//#region we're a leader, listening to mutations from followers

					// we've received the first valid mutation with this index
					if (receivedAtom.index == appliedAtoms.length) {
						applyAtomToStore(receivedAtom, setLockstepStore)
						applyAtomToStore(receivedAtom, setRollbackStore)
						appliedAtoms.push(receivedAtom)
						// this is now canonical state, and we can broadcast it
						provider.broadcastAsCommitted(receivedAtom)
					}
					return
					//#endregion
				}
				//#region  we're a follower, listening to mutations from the leader
				applyAtomToStore(receivedAtom, setLockstepStore)
				if (appliedAtoms.length >= receivedAtom.index + 1) {
					const mutationToCompare = appliedAtoms[receivedAtom.index]

					if (_.isEqual(mutationToCompare, receivedAtom)) {
						// everything is fine, we don't need to store the previous value anymore
						previousValues.delete(receivedAtom.index)
						return
					}

					// rollback
					for (let i = appliedAtoms.length - 1; i >= 0; i--) {
						const atomToRollback = appliedAtoms[i]
						if (i === receivedAtom.index) {
							// we're done, set the new head of the applied mutations
							//@ts-ignore
							applyAtomToStore(receivedAtom, setRollbackStore)
							previousValues.delete(atomToRollback.index)
							break
						} else {
							for (let i = atomToRollback.mutations.length - 1; i >= 0; i--) {
								const mutation = atomToRollback.mutations[i]
								//@ts-ignore
								setRollbackStore(...mutation.path, previousValues.get(atomToRollback.index)[i])
							}
							previousValues.delete(atomToRollback.index)
						}
					}

					appliedAtoms.length = receivedAtom.index
					appliedAtoms.push(receivedAtom)
				} else {
					appliedAtoms.push(receivedAtom)
					//@ts-ignore
					applyAtomToStore(receivedAtom, setRollbackStore)
				}
				//#endregion
			})
		})
	)

	onCleanup(() => {
		subscription.unsubscribe()
	})
	//#endregion

	//#region handle state dump requests
	subscription.add(
		provider.observeRequestState().subscribe(async () => {
			await until(initialized)
			console.log('sending state', JSON.stringify(rollbackStore))
			provider.send({
				type: 'state',
				state: encodeContent(unwrap(rollbackStore)),
				lastMutationIndex: appliedAtoms.length,
			})
		})
	)
	//#endregion

	//#region handle leader promotion
	subscription.add(
		provider.observeLeaderPromotion().subscribe(() => {
			setIsLeader(true)
			// we don't have to do any manual handling of the store at this point, because if there is anything that's already inflight from this store it will come back here and be processed once the leader has been updated
			provider.send({ type: 'ack-promote-to-leader' })
			provider.broadcastAsCommitted({ index: appliedAtoms.length, mutations: [] })
		})
	)
	//#endregion

	//#region initialize store
	;(async () => {
		if (config) {
			appliedAtoms.length = config.lastMutationIndex
			setLockstepStore(config.state)
			setRollbackStore(config.state)
			setInitialized(true)
			console.debug(provider.id + ' initialized')
			return
		} else {
			await provider.waitForConnected()
			config = await provider.getNetworkDetails()
			console.log('received initial state', config.state)
			setRollbackStore(config!.state as T)
			setLockstepStore(config!.state as T)
			console.debug(provider.id + ' initialized')
			setInitialized(true)
		}
	})()
	//#endregion

	return { rollbackStore, lockstepStore, setStore, initialized, isLeader }
}

function getStoreMutation({path, value}: StoreMutation, state: any): StoreMutation {
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
	}
}

function resolvePath(path: (string | number)[], store: any) {
	let current = store
	for (let elt of path) {
		current = store[elt]
	}
	return current
}

export class SharedStoreProvider {
	private message$: Observable<SharedStoreMessage>
	public ws: WebSocket

	constructor(
		serverHost: string,
		public networkId: string,
		public id: string
	) {
		this.ws = new WebSocket(`ws://${serverHost}/networks/${networkId}`)

		this.message$ = new Observable<SharedStoreMessage>((subscriber) => {
			const listener = (event: MessageEvent) => {
				const message = JSON.parse(event.data) as SharedStoreMessage
				// if (message.type === 'mutation') {
				// 	if (!message.commit && !this.leader) {
				// 		throw new Error('Non host received non-committed mutation')
				// 	} else if (message.commit && this.leader) {
				// 		throw new Error('Host received committed mutation')
				// 	}
				// }
				console.debug(`client:${this.id} received message`, message)

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

	sendToLeader(mutation: StoreMutationAtom) {
		console.debug('sending mutation to leader: ', mutation)
		const message: SharedStoreMessage = {
			type: 'mutation',
			commit: false,
			mutation: encodeContent(mutation),
		}
		this.send(message)
	}

	broadcastAsCommitted(mutation: StoreMutationAtom) {
		console.debug('broadcasting mutation: ', mutation)
		const message: SharedStoreMessage = {
			type: 'mutation',
			commit: true,
			mutation: encodeContent(mutation),
		}
		this.send(message)
	}

	observeComittedMutations(): Observable<StoreMutationAtom> {
		// we assume all mutations we receive are committed
		return this.message$
			.pipe(
				concatMap((message: SharedStoreMessage) => {
					if (message.type === 'mutation') return [parseContent(message.mutation)]
					return []
				})
			)
			.pipe(tap((mutation) => console.debug('received mutation: ', mutation)))
	}

	observeRequestState(): Observable<void> {
		return this.message$.pipe(
			concatMap((message: SharedStoreMessage) => {
				if (message.type === 'request-state') return [undefined]
				return []
			})
		)
	}

	observeLeaderPromotion(): Observable<void> {
		return this.message$.pipe(
			concatMap((message: SharedStoreMessage) => {
				if (message.type === 'promote-to-leader') return [undefined]
				return []
			})
		)
	}

	async getNetworkDetails<T>(): Promise<NetworkClientConfig<T>> {
		await this.send({ type: 'request-network-details' })

		return firstValueFrom(
			this.message$.pipe(
				concatMap((message: SharedStoreMessage) => {
					if (message.type === 'network-details') {
						const config = message.details
						config.state = parseContent(config.state)
						return [config as NetworkClientConfig<T>]
					}
					return [] as NetworkClientConfig<T>[]
				})
			)
		)
	}

	async send(message: SharedStoreMessage) {
		console.debug(`client:${this.id} sending message`, message)
		await this.waitForConnected()
		this.ws.send(JSON.stringify(message))
	}
}

function encodeContent(content: any) {
	return btoa(JSON.stringify(content))
}

function parseContent(content: Base64String) {
	return JSON.parse(atob(content))
}

class SharedStoreTransaction {
	mutations: StoreMutation[]
	commit$: Subject<boolean>

	constructor() {
		this.mutations = []
		this.commit$ = new Subject()
	}

	push(mutation: StoreMutation) {
		this.mutations.push(mutation)
	}

	commit() {
		this.commit$.next(true)
		this.commit$.complete()
	}

	abort() {
		this.commit$.next(false)
		this.commit$.complete()
	}
}

export async function runOnTransaction(fn: (t: SharedStoreTransaction) => Promise<void>) {
	const transaction = new SharedStoreTransaction()
	try {
		await fn(transaction)
		transaction.commit()
	} catch {
		transaction.abort()
	}
}

export async function newNetwork(host: string) {
	return (await fetch(`http://${host}/networks/new`).then((res) => res.json())) as NewNetworkResponse
}
