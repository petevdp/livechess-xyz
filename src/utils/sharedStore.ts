import { createStore, produce, unwrap } from 'solid-js/store'
import { concatMap, endWith, firstValueFrom, merge, Observable, share, Subject, Subscription, tap } from 'rxjs'
import _ from 'lodash'
import { batch, createSignal, onCleanup } from 'solid-js'
import { until } from '@solid-primitives/promise'

//#region types

// TODO: strong typing for paths and values like in solid's setStore
export type StoreMutation = {
	path: (string | number)[]
	value: any
}

type NewSharedStoreOrderedTransaction = {
	index: number
	mutations: StoreMutation[]
}

type NewSharedStoreUnorderedTransaction = {
	index: null
	mutations: StoreMutation[]
}

type NewSharedStoreTransaction = NewSharedStoreOrderedTransaction | NewSharedStoreUnorderedTransaction
export type SharedStoreTransaction = NewSharedStoreTransaction & { mutationId: string }
export type SharedStoreOrderedTransaction = NewSharedStoreOrderedTransaction & { mutationId: string }

export type NewNetworkResponse = {
	networkId: string
}

export type Base64String = string

type ClientControlledState = { [key: string]: any | null } | null
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
			type: 'order-invariant-mutation-failed'
			mutationId: string
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

export type SharedStore<T extends object, CCS extends ClientControlledState = ClientControlledState> = ReturnType<
	typeof initSharedStore<T, CCS>
>

/**
 * Create a shared store that can be used to synchronize state between multiple clients, and can rollback any conflicting changes.
 * @param provider
 * @param startingState only used if we're the first client in the room
 * @param startingClientState only used if we're the first client in the room
 */
export function initSharedStore<S extends object, CCS extends ClientControlledState = ClientControlledState>(
	provider: SharedStoreProvider,
	startingClientState = {} as CCS,
	startingState: S = {} as S
) {
	//#region statuses
	const [initialized, setInitialized] = createSignal(false)
	const [isLeader, setIsLeader] = createSignal(false)
	//#endregion

	//#region stores
	const [rollbackStore, _setRollbackStore] = createStore<S>({} as S)
	const setRollbackStore = (...args: any[]) => {
		const path = args.slice(0, -1)
		//@ts-ignore
		_setRollbackStore(...interpolatePath(path, rollbackStore), args[args.length - 1])
	}

	const [lockstepStore, _setLockstepStore] = createStore<S>({} as S)
	const setLockstepStore = (...args: any[]) => {
		const path = args.slice(0, -1)
		//@ts-ignore
		_setLockstepStore(...interpolatePath(path, lockstepStore), args[args.length - 1])
	}
	//#endregion

	let subscription = new Subscription()

	//#region transactions
	const previousValues = new Map<number, any[]>()
	const transactionsBeingBuilt = new Set<SharedStoreTransactionBuilder>()
	const appliedTransactions = [] as NewSharedStoreOrderedTransaction[]
	const setStore = async (mutation: StoreMutation, transactionBuilder?: SharedStoreTransactionBuilder, rollback = true) => {
		await until(initialized)
		let transaction: NewSharedStoreOrderedTransaction
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

			transaction = transactionBuilder.build(appliedTransactions.length)
		} else {
			transaction = {
				index: appliedTransactions.length,
				mutations: [mutation],
			}
		}
		let _transaction: NewSharedStoreUnorderedTransaction | NewSharedStoreOrderedTransaction
		if (rollback) {
			_transaction = transaction
		} else {
			_transaction = {
				mutations: transaction.mutations,
				index: null,
			}
		}

		return await applyTransaction(_transaction)
	}

	const applyTransaction = async (transaction: NewSharedStoreTransaction): Promise<boolean> => {
		if (isLeader()) {
			for (let mut of transaction.mutations) {
				mut.path = interpolatePath(mut.path, lockstepStore)
			}
			batch(() => {
				applyMutationsToStore(transaction.mutations, setRollbackStore)
				applyMutationsToStore(transaction.mutations, setLockstepStore)
			})
			let orderedTransaction: SharedStoreOrderedTransaction
			if (transaction.index == null) {
				orderedTransaction = {
					...transaction,
					index: appliedTransactions.length,
					mutationId: `${provider.clientId}:${appliedTransactions.length}`,
				}
			} else {
				orderedTransaction = {
					...transaction,
					mutationId: `${provider.clientId}:${transaction.index}`,
				}
			}
			for (let mut of orderedTransaction.mutations) {
				mut.path = interpolatePath(mut.path, lockstepStore)
			}
			appliedTransactions.push(orderedTransaction)
			provider.broadcastAsCommitted(orderedTransaction)
			return true
		} else {
			let previous: any[] = []
			// only update rollback store if this transaction must be applied on a particular transaction index, otherwise the history could end up irreconcilable
			if (transaction.index) {
				batch(() => {
					for (let mutation of transaction.mutations) {
						mutation.path = interpolatePath(mutation.path, rollbackStore)
						previous.push(resolvePath(mutation.path, rollbackStore))
						setRollbackStore(...mutation.path, mutation.value)
						if (isLeader()) {
							setLockstepStore(...mutation.path, mutation.value)
						}
					}
				})
				appliedTransactions.push(transaction)
				previousValues.set(transaction.index!, previous)
			}
			return await provider.tryCommit(transaction)
		}
	}

	const setStoreWithRetries = async (fn: (s: S) => StoreMutation[], numRetries = 5) => {
		await until(initialized)
		for (let i = 0; i < numRetries + 1; i++) {
			const transaction: NewSharedStoreOrderedTransaction = {
				mutations: fn(rollbackStore),
				index: appliedTransactions.length,
			}
			if (transaction.mutations.length === 0) return true
			const success = await applyTransaction(transaction)
			if (success) {
				return true
			}
		}
		return false
	}
	//#endregion

	//#region handle incoming mutations
	const applyMutationsToStore = (mutations: StoreMutation[], setStore: (...args: any[]) => any) => {
		for (let mutation of mutations) {
			setStore(...mutation.path, mutation.value)
		}
	}

	function handleReceivedTransaction(receivedAtom: SharedStoreOrderedTransaction) {
		console.debug(`processing atom (${provider.clientId})`, receivedAtom, appliedTransactions.length)
		for (let mut of receivedAtom.mutations) {
			mut.path = interpolatePath(mut.path, lockstepStore)
		}

		if (isLeader()) {
			//#region we're a leader, listening to mutations from followers

			// we've received the first valid mutation with this index
			if (receivedAtom.index === appliedTransactions.length) {
				applyMutationsToStore(receivedAtom.mutations, setRollbackStore)
				applyMutationsToStore(receivedAtom.mutations, setLockstepStore)
				appliedTransactions.push(receivedAtom)
				// this is now canonical state, and we can broadcast it
				provider.broadcastAsCommitted(receivedAtom, receivedAtom.mutationId)
			} else {
				console.warn('received mutation with index that is not the next index', receivedAtom.index, appliedTransactions.length, receivedAtom)
			}
			return
			//#endregion
		}
		//#region  we're a follower, listening to mutations from the leader
		applyMutationsToStore(receivedAtom.mutations, setLockstepStore)
		if (appliedTransactions.length >= receivedAtom.index + 1) {
			const mutationToCompare = appliedTransactions[receivedAtom.index]

			if (_.isEqual(mutationToCompare, receivedAtom)) {
				// everything is fine, we don't need to store the previous value anymore
				previousValues.delete(receivedAtom.index)
				return
			}

			// rollback
			for (let i = appliedTransactions.length - 1; i >= 0; i--) {
				const atomToRollback = appliedTransactions[i]
				if (i === receivedAtom.index) {
					// we're done, set the new head of the applied mutations
					applyMutationsToStore(receivedAtom.mutations, setRollbackStore)
					previousValues.delete(atomToRollback.index)
					break
				} else {
					for (let i = atomToRollback.mutations.length - 1; i >= 0; i--) {
						const mutation = atomToRollback.mutations[i]
						setRollbackStore(...mutation.path, previousValues.get(atomToRollback.index)![i])
					}
					previousValues.delete(atomToRollback.index)
				}
			}

			appliedTransactions.length = receivedAtom.index
			appliedTransactions.push(receivedAtom)
		} else {
			appliedTransactions.push(receivedAtom)
			applyMutationsToStore(receivedAtom.mutations, setRollbackStore)
		}
		//#endregion
	}

	subscription.add(
		provider.observeComittedMutations().subscribe(async (_receivedAtom) => {
			await until(initialized)
			// annoying but we have both receivedAtom and _receivedAtom for type narrowing reasons,
			let receivedAtom = _receivedAtom as SharedStoreOrderedTransaction
			if (isLeader() && _receivedAtom.index === null) {
				receivedAtom.index = appliedTransactions.length
			} else if (!isLeader() && receivedAtom.index === null) {
				console.warn('received order invariant mutation as non-leader')
				return
			}
			if (receivedAtom.index == null) {
				throw new Error('impossible')
			}

			batch(() => {
				handleReceivedTransaction(receivedAtom)
			})
		})
	)

	//#endregion

	//#region handle state dump requests
	subscription.add(
		provider.observeRequestState().subscribe(async () => {
			await until(initialized)
			provider.send({
				type: 'state',
				state: encodeContent(unwrap(rollbackStore)),
				lastMutationIndex: appliedTransactions.length - 1,
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
			provider.broadcastAsCommitted({ index: appliedTransactions.length, mutations: [] })
		})
	)
	//#endregion

	//#region client controlled state
	const setClientControlledState = async (state: Partial<CCS>) => {
		await until(initialized)
		setClientControlledStates(produce(updateLocalClientControlledState(provider.clientId!, state)))
		provider.broadcastClientControlledState(state)
	}

	const [clientControlledStates, setClientControlledStates] = createStore<ClientControlledStates<CCS>>()
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
			if (isLeader()) {
				setRollbackStore(startingState)
				setLockstepStore(startingState)
			} else {
				setRollbackStore(clientConfig.initialState as S)
				setLockstepStore(clientConfig.initialState as S)
			}
			setClientControlledState(startingClientState)
			provider.broadcastClientControlledState(clientControlledStates[provider.clientId!])
		})
		appliedTransactions.length = clientConfig.lastMutationIndex + 1
		setInitialized(true)
	})()
	//#endregion

	//#region cleanup
	const dispose = () => {
		subscription.unsubscribe()
	}

	onCleanup(() => {
		subscription.unsubscribe()
	})
	//#endregion

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

// TODO: usages are this function are messy, should clean up at some point
function interpolatePath(path: (string | number)[], store: any) {
	let current = store
	const _path = [...path]
	for (let i = 0; i < _path.length; i++) {
		const elt = _path[i]
		if (elt === '__push__') {
			if (!Array.isArray(current)) throw new Error("can't push to non-array")
			if (i !== _path.length - 1) throw new Error("can't push to non-terminal path")
			_path[i] = current.length
			break
		}
		current = current[_path[i]]
	}

	return _path
}

export class SharedStoreProvider {
	private message$: Observable<SharedStoreMessage>
	public ws: WebSocket
	disconnected$: Promise<undefined>
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
				console.debug(`client:${this.clientId} received message`, message)

				subscriber.next(message)
			}

			this.ws.addEventListener('close', () => {
				subscriber.complete()
			})

			this.ws.addEventListener('message', listener)
			return () => {
				this.ws.removeEventListener('message', listener)
			}
		}).pipe(share())

		this.disconnected$ = firstValueFrom(
			this.message$.pipe(
				concatMap(() => [] as undefined[]),
				endWith(undefined)
			)
		)

		document.addEventListener('beforeunload', () => {
			this.ws.close()
		})
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

	async tryCommit(newTransaction: NewSharedStoreTransaction) {
		const transaction: SharedStoreTransaction = {
			...newTransaction,
			mutationId: `${this.clientId}:${this.nextAtomId}`,
		}
		this.nextAtomId++
		const message: SharedStoreMessage = {
			type: 'mutation',
			commit: false,
			mutation: encodeContent(transaction),
		}
		this.send(message)
		if (transaction.index == null) {
			const failed$ = this.observeOrderInvariantMutationFailed().pipe(
				concatMap((mutationId) => (mutationId === transaction.mutationId ? [false] : []))
			)
			const success$ = this.observeComittedMutations().pipe(concatMap((m) => (m.mutationId === transaction.mutationId ? [true] : [])))

			return await firstValueFrom(merge(failed$, success$))
		}

		return await firstValueFrom(
			this.observeComittedMutations().pipe(
				concatMap((m) => {
					if (m.index !== newTransaction.index) return []
					return [m.mutationId === transaction.mutationId]
				}),
				endWith(false)
			)
		)
	}

	// TODO a lot of these methods should be consolidated

	broadcastAsCommitted(newAtom: NewSharedStoreOrderedTransaction, mutationId?: string) {
		const atom: SharedStoreTransaction = {
			...newAtom,
			mutationId: mutationId || `${this.clientId}:${this.nextAtomId}`,
		}
		this.nextAtomId++
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
	}

	observeOrderInvariantMutationFailed(): Observable<string> {
		return this.message$.pipe(
			concatMap((message: SharedStoreMessage) => {
				if (message.type === 'order-invariant-mutation-failed') return [message.mutationId]
				return []
			})
		)
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
		).catch((e) => {
			throw new Error('Failed to connect to server')
		})
	}

	send(message: SharedStoreMessage) {
		console.trace(`${this.clientId} sending message`, message)
		this.ws.send(JSON.stringify(message))
	}
}

export function encodeContent(content: any) {
	return btoa(JSON.stringify(content))
}

function parseContent(content: Base64String) {
	return JSON.parse(atob(content))
}

export class SharedStoreTransactionBuilder {
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

	build(index: number): NewSharedStoreOrderedTransaction {
		return {
			index,
			mutations: this.mutations,
		}
	}
}

export async function buildTransaction(fn: (t: SharedStoreTransactionBuilder) => Promise<void>) {
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
