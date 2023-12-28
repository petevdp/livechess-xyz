import { createStore, produce, unwrap } from 'solid-js/store'
import { concatMap, endWith, firstValueFrom, Observable, share, Subject, Subscription, tap } from 'rxjs'
import _ from 'lodash'
import { batch, createSignal, onCleanup } from 'solid-js'
import { until } from '@solid-primitives/promise'

//#region types

// TODO: strong typing for paths and values like in solid's setStore
type StoreMutation = {
	path: (string | number)[]
	value: any
}

type NewSharedStoreTransaction = {
	index: number
	mutations: StoreMutation[]
}

type SharedStoreTransaction = NewSharedStoreTransaction & { mutationId: string }

export type NewNetworkResponse = {
	networkId: string
}

export type Base64String = string

type ClientControlledState = { [key: string]: string | null } | null
export type ClientControlledStates<T extends ClientControlledState> = { [key: string]: T }

export type ClientConfig<T> = {
	clientId: string
	leader: boolean
	initialState: T
	lastMutationIndex: number
}

export type SharedStoreMessage =
	| {
			type: 'mutation'
			commit: boolean
			mutation: Base64String
	  }
	| {
			type: 'client-config'
			config: ClientConfig<Base64String>
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
	| {
			// request that the client sends its controlled state
			type: 'request-client-controlled-states'
			// in case we're being asked to update a particular client's state
			forClient?: string
	  }
	| {
			type: 'client-controlled-states'
			forClient?: string
			states: Base64String
	  }

//#endregion

export function createSharedStore<S extends object, CCS extends ClientControlledState>(
	provider: SharedStoreProvider,
	startingClientState = {} as CCS
) {
	const [initialized, setInitialized] = createSignal(false)
	const appliedAtoms = [] as SharedStoreTransaction[]

	const [rollbackStore, setRollbackStore] = createStore<S>({} as S)
	// mutations currently applied to the rollback store
	const previousValues = new Map<number, any[]>()
	const [lockstepStore, setLockstepStore] = createStore<S>({} as S)
	const [isLeader, setIsLeader] = createSignal(false)

	const [clientControlledStates, setClientControlledStates] = createStore<ClientControlledStates<CCS>>({
		[provider.clientId!]: { ...startingClientState },
	})

	const setClientControlledState = async (state: CCS) => {
		await until(initialized)
		setClientControlledStates(produce(updateLocalClientControlledState(provider.clientId!, state)))
		provider.broadcastClientControlledState(state)
	}

	const transactionsBeingBuilt = new Set<SharedStoreTransactionBuilder>()

	// if you set a transaction, you can't await this function or it will lock up
	const setStore = async (mutation: StoreMutation, transactionBuilder?: SharedStoreTransactionBuilder) => {
		await until(initialized)
		let transaction: NewSharedStoreTransaction
		if (transactionBuilder) {
			transactionBuilder.push(mutation)
			if (transactionsBeingBuilt.has(transactionBuilder)) {
				return
			}
			transactionsBeingBuilt.add(transactionBuilder)

			const completed = await transactionBuilder.completed()
			transactionsBeingBuilt.delete(transactionBuilder)
			if (!completed) {
				return
			}

			transaction = transactionBuilder.build(appliedAtoms.length)
		} else {
			transaction = {
				index: appliedAtoms.length,
				mutations: [mutation],
			}
		}

		await applyTransaction(transaction)
	}

	const applyTransaction = async (transaction: NewSharedStoreTransaction): Promise<boolean> => {
		let previous: any[] = []
		batch(() => {
			for (let mutation of transaction.mutations) {
				previous.push(resolvePath(mutation.path, rollbackStore))
				//@ts-ignore
				setRollbackStore(...mutation.path, mutation.value)
				if (isLeader()) {
					//@ts-ignore
					setLockstepStore(...mutation.path, mutation.value)
				}
			}
		})

		previousValues.set(transaction.index, previous)

		if (isLeader()) {
			provider.broadcastAsCommitted(transaction)
			return true
		} else {
			return await provider.tryCommit(transaction)
		}
	}

	const setStoreWithRetries = async (fn: (s: S) => StoreMutation[], numRetries = 3) => {
		await until(initialized)
		for (let i = 0; i < numRetries; i++) {
			const transaction: NewSharedStoreTransaction = {
				mutations: fn(rollbackStore),
				index: appliedAtoms.length,
			}
			const success = await applyTransaction(transaction)
			if (success) {
				return true
			}
		}
		return false
	}

	//#region handle incoming mutations
	const applyAtomToStore = (atom: SharedStoreTransaction, store: (...args: any[]) => any) => {
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
				console.log(`processing atom (${provider.clientId})`, receivedAtom, appliedAtoms.length)
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

	//#region handle client controlled state
	subscription.add(
		provider.observeRequestClientControlledState().subscribe(() => {
			provider.broadcastClientControlledState(clientControlledStates[provider.clientId!])
		})
	)

	const updateAllLocalClientControlledState =
		(newStates: ClientControlledStates<CCS>): ((states: ClientControlledStates<CCS>) => void) =>
		(states: ClientControlledStates<CCS>) => {
			if (!newStates) return
			for (let [clientId, state] of Object.entries(newStates)) {
				updateLocalClientControlledState(clientId, state)(states)
			}
		}

	const updateLocalClientControlledState = (clientId: string, newState: ClientControlledState) => (states: ClientControlledStates<any>) => {
		if (newState == null) {
			delete states[clientId]
			return
		}
		for (let [key, value] of Object.entries(newState)) {
			if (value == null && states[clientId]) {
				delete states[clientId]![key]
			} else {
				states[clientId] ||= {}
				states[clientId]![key] = value
			}
		}
	}

	subscription.add(
		provider.observeClientControlledStates<CCS>().subscribe((states) => {
			// assume correct typing
			const out = produce(updateAllLocalClientControlledState(states))
			setClientControlledStates(out)
		})
	)
	//#endregion

	//#region initialize store
	;(async () => {
		const clientConfigPromise = provider.awaitClientConfig<S>()
		await provider.waitForConnected()
		const clientConfig = await clientConfigPromise
		provider.clientId = clientConfig.clientId
		setIsLeader(clientConfig.leader)
		batch(() => {
			setRollbackStore(clientConfig.initialState as S)
			setLockstepStore(clientConfig.initialState as S)
		})
		console.log(provider.clientId + ' initialized')
		setInitialized(true)
	})()
	//#endregion
	const dispose = () => {
		subscription.unsubscribe()
	}

	return {
		rollbackStore,
		lockstepStore,
		setStore,
		setStoreWithRetries,
		clientControlledStates,
		initialized,
		setClientControlledState,
		isLeader,
		dispose,
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
	clientId?: string
	private nextAtomId = 0

	constructor(
		serverHost: string,
		public networkId: string
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
				console.log(`client:${this.clientId} received message`, message)

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

	async tryCommit(newAtom: NewSharedStoreTransaction) {
		console.log('sending newAtom to leader: ', newAtom)
		const atom: SharedStoreTransaction = {
			...newAtom,
			mutationId: `${this.clientId}:${this.nextAtomId}}`,
		}
		this.nextAtomId++
		const message: SharedStoreMessage = {
			type: 'mutation',
			commit: false,
			mutation: encodeContent(atom),
		}
		this.send(message)

		return await firstValueFrom(
			this.observeComittedMutations().pipe(
				concatMap((m) => {
					if (m.index !== newAtom.index) return []
					return [m.mutationId === atom.mutationId]
				}),
				endWith(false)
			)
		)
	}

	// TODO a lot of these methods should be consolidated

	broadcastAsCommitted(newAtom: NewSharedStoreTransaction) {
		console.log('broadcasting newAtom: ', newAtom)
		const atom: SharedStoreTransaction = {
			...newAtom,
			mutationId: `${this.clientId}:${this.nextAtomId}}`,
		}
		const message: SharedStoreMessage = {
			type: 'mutation',
			commit: true,
			mutation: encodeContent(atom),
		}
		this.send(message)
	}

	observeComittedMutations(): Observable<SharedStoreTransaction> {
		// we assume all mutations we receive are committed
		return this.message$
			.pipe(
				concatMap((message: SharedStoreMessage) => {
					if (message.type === 'mutation') return [parseContent(message.mutation)]
					return []
				})
			)
			.pipe(tap((mutation) => console.log('received mutation: ', mutation)))
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

	observeRequestClientControlledState(): Observable<void> {
		return this.message$.pipe(
			concatMap((message: SharedStoreMessage) => {
				if (message.type === 'request-client-controlled-states') return [undefined]
				return []
			})
		)
	}

	observeClientControlledStates<C extends ClientControlledState>(): Observable<ClientControlledStates<C>> {
		return this.message$.pipe(
			concatMap((message: SharedStoreMessage) => {
				if (message.type === 'client-controlled-states') return [parseContent(message.states)]
				return []
			})
		)
	}

	broadcastClientControlledState(values: ClientControlledState) {
		this.send({
			type: 'client-controlled-states',
			states: encodeContent({
				[this.clientId!]: values,
			}),
		})
	}

	async awaitClientConfig<T>(): Promise<ClientConfig<T>> {
		return firstValueFrom(
			this.message$.pipe(
				concatMap((message: SharedStoreMessage): ClientConfig<T>[] => {
					if (message.type === 'client-config') {
						// we leach off of this event which is always run when the client is initialized. a bit hacky but works
						this.clientId = message.config.clientId
						const config: ClientConfig<T> = {
							...message.config,
							initialState: parseContent(message.config.initialState) as T,
						}
						return [config]
					}
					return []
				})
			)
		)
	}

	send(message: SharedStoreMessage) {
		console.log(`client:${this.clientId} sending message`, message)
		this.ws.send(JSON.stringify(message))
	}
}

export function encodeContent(content: any) {
	return btoa(JSON.stringify(content))
}

function parseContent(content: Base64String) {
	return JSON.parse(atob(content))
}

class SharedStoreTransactionBuilder {
	mutations: StoreMutation[] = []
	private commit$ = new Subject<boolean>()

	constructor() {}

	commit() {
		this.commit$.next(true)
		this.commit$.complete()
	}

	abort() {
		this.commit$.next(false)
		this.commit$.complete()
	}

	completed() {
		return firstValueFrom(this.commit$)
	}

	push(mutation: StoreMutation) {
		this.mutations.push(mutation)
	}

	build(index: number): NewSharedStoreTransaction {
		return {
			index,
			mutations: this.mutations,
		}
	}
}

export async function runOnTransaction(fn: (t: SharedStoreTransactionBuilder) => Promise<void>) {
	const transaction = new SharedStoreTransactionBuilder()
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
