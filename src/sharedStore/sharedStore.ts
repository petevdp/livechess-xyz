import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Observable, Subject, Subscription, concatMap, endWith, filter, first, firstValueFrom } from 'rxjs'
import { Accessor, batch, createSignal, onCleanup } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

import { ClientOwnedState } from '~/systems/room.ts'

//#region types

// TODO: strong typing for paths and values like in solid's setStore
export type StoreMutation = {
	path: (string | number)[]
	value: any
}

type NewSharedStoreOrderedTransaction<Event> = {
	index: number
	mutations: StoreMutation[]
	events: Event[]
}

type NewSharedStoreTransaction<Event> = NewSharedStoreOrderedTransaction<Event>
export type SharedStoreTransaction<Event> = NewSharedStoreTransaction<Event> & {
	mutationId: string
}
export type SharedStoreOrderedTransaction<Event> = NewSharedStoreOrderedTransaction<Event> & {
	mutationId: string
}

export type NewNetworkResponse = {
	networkId: string
}

export type Json = string

export type ClientControlledState = { [key: string]: any | null }
export type ClientControlledStates<T extends ClientControlledState> = {
	[key: string]: T
}

export type ClientControlledStatesUpdate<S extends ClientControlledState> = {
	[key: string]: null | S
}

export type ClientConfig<T, CCS extends ClientControlledState> = {
	clientId: string
	initialState: T
	clientControlledStates: ClientControlledStates<CCS>
	lastMutationIndex: number
}

export type SharedStoreMessage<Event, State = any, CCS extends ClientControlledState = ClientControlledState> =
	| {
			type: 'mutation'
			mutation: SharedStoreTransaction<Event>
	  }
	| {
			type: 'order-invariant-mutation-failed'
			mutationId: string
	  }
	| {
			type: 'client-config'
			config: ClientConfig<State, CCS>
	  }
	| {
			type: 'state'
			state: State
			lastMutationIndex: number
	  }
	| {
			type: 'client-controlled-states'
			forClient?: string
			states: ClientControlledStatesUpdate<CCS>
	  }
	| SharedStoreTimeoutMessage

type SharedStoreTimeoutMessage = {
	type: 'message-timeout'
	idleTime: number
}

export type ClientControlledStateNode<CCS extends ClientControlledState> = ReturnType<typeof initClientControlledStateNode<CCS>>

export interface SharedStore<State extends object, CCS extends ClientControlledState = ClientControlledState, Event = any> {
	lockstepState: State
	rollbackState: State
	clientControlled: ClientControlledStateNode<CCS>
	setStore(
		mutation: StoreMutation,
		transactionBuilder?: SharedStoreTransactionBuilder<Event>,
		events?: Event[]
	): Promise<boolean | undefined>
	setStoreWithRetries(
		fn: (s: State) => StoreMutation[] | { mutations: StoreMutation[]; events: Event[] } | void,
		numRetries?: number
	): Promise<boolean>
	event$: Observable<Event>
	initialized: Accessor<boolean>
	config: Accessor<ClientConfig<State, CCS> | null>
	lastMutationIndex: number
}
//#endregion

function applyMutationsToStore(mutations: StoreMutation[], setStore: (...args: any[]) => any, store: any) {
	for (const mutation of mutations) {
		const container = unwrap(resolveValue(mutation.path.slice(0, -1), store))
		if (mutation.value === DELETE && container instanceof Array) {
			setStore(
				...mutation.path.slice(0, -1),
				(container as any[]).filter((_, i) => i !== mutation.path[mutation.path.length - 1])
			)
			return
		} else if (mutation.value === DELETE && typeof container === 'object') {
			setStore(
				produce((store) => {
					const container = resolveValue(mutation.path.slice(0, -1), store)
					delete container[mutation.path[mutation.path.length - 1]]
				})
			)
			return
		} else if (mutation.value === DELETE) {
			throw new Error('unhandled type ' + typeof container)
		}
		setStore(...mutation.path, mutation.value)
	}
}

async function setStoreWithRetries<State, Event>(
	fn: (s: State) =>
		| StoreMutation[]
		| {
				mutations: StoreMutation[]
				events: Event[]
		  }
		| void,
	applyTransaction: (transaction: NewSharedStoreOrderedTransaction<Event>) => Promise<boolean>,
	appliedTransactions: NewSharedStoreOrderedTransaction<Event>[],
	rollbackStore: State,
	numRetries = 5
) {
	for (let i = 0; i < numRetries + 1; i++) {
		const res = fn(rollbackStore)
		if (!res) return true
		let transaction: NewSharedStoreOrderedTransaction<Event>
		if ('mutations' in res) {
			transaction = {
				index: appliedTransactions.length,
				events: res.events,
				mutations: res.mutations,
			}
		} else {
			transaction = {
				mutations: res,
				events: [],
				index: appliedTransactions.length,
			}
		}
		if (transaction.mutations.length === 0) return true
		const success = await applyTransaction(transaction)
		if (success) {
			return true
		}
	}
	return false
}

// magical strings wooooo
export const DELETE = '__DELETE__'

export const PUSH = '__PUSH__'

export function initLeaderStore<State extends object, CCS extends ClientControlledState = ClientControlledState, Event = any>(
	transport: Transport<SharedStoreMessage<Event, State, CCS>>,
	startingState: State = {} as State
): SharedStore<State, CCS, Event> {
	const [store, _setStore] = createStore<State>(startingState)
	const config: ClientConfig<State, CCS> = {
		clientControlledStates: {},
		clientId: 'LEADER',
		initialState: startingState,
		lastMutationIndex: -1,
	}

	function setStoreWithPath(...args: any[]) {
		const path = args.slice(0, -1)
		//@ts-expect-error
		_setStore(...interpolatePath(path, store), args[args.length - 1])
	}

	const subscription = new Subscription()

	//#region events
	const event$ = new Subject<Event>()
	subscription.add(event$)
	subscription.add(
		event$.subscribe((event) => {
			console.debug(`dispatching action: ${event}`)
		})
	)

	const appliedTransactions = [] as NewSharedStoreOrderedTransaction<Event>[]
	const transactionsBeingBuilt = new Set<SharedStoreTransactionBuilder<Event>>()
	const clientControlled = initClientControlledStateNode(() => config, transport, null)
	let nextAtomId = config.lastMutationIndex + 1

	//#endregion

	subscription.add(
		observeIncomingMutations(transport).subscribe(async (_receivedAtom) => {
			// annoying but we have both receivedAtom and _receivedAtom for type narrowing reasons,
			const receivedAtom = _receivedAtom as SharedStoreOrderedTransaction<Event>
			if (receivedAtom.index == null) {
				throw new Error('impossible')
			}
			for (const mut of receivedAtom.mutations) {
				mut.path = interpolatePath(mut.path, store)
			}

			// we've received the first valid mutation with this index
			if (receivedAtom.index === appliedTransactions.length) {
				batch(() => {
					applyMutationsToStore(receivedAtom.mutations, setStoreWithPath, store)
				})
				appliedTransactions.push(receivedAtom)
				// this is now canonical state, and we can broadcast it
				broadcastAsCommitted(receivedAtom, receivedAtom.mutationId)
				for (const action of receivedAtom.events) {
					event$.next(action)
				}
			} else {
				// TODO what to do here
				console.warn(
					'received mutation with index that is not the next index',
					receivedAtom.index,
					appliedTransactions.length,
					receivedAtom
				)
			}
		})
	)

	async function setStore(mutation: StoreMutation, transactionBuilder?: SharedStoreTransactionBuilder<Event>, events: Event[] = []) {
		let transaction: NewSharedStoreOrderedTransaction<Event>
		if (transactionBuilder) {
			transactionBuilder.push(mutation)
			if (transactionsBeingBuilt.has(transactionBuilder)) {
				return false
			}
			transactionsBeingBuilt.add(transactionBuilder)

			const completed = await transactionBuilder.completed()
			transactionsBeingBuilt.delete(transactionBuilder)
			if (!completed) {
				return false
			}

			transaction = transactionBuilder.build(appliedTransactions.length, events)
		} else {
			transaction = {
				index: appliedTransactions.length,
				events: events,
				mutations: [mutation],
			}
		}
		return await applyTransaction(transaction)
	}

	function broadcastAsCommitted(newAtom: NewSharedStoreOrderedTransaction<Event>, mutationId?: string) {
		const atom: SharedStoreTransaction<Event> = {
			...newAtom,
			mutationId: mutationId || `${config.clientId}:${nextAtomId}`,
		}
		nextAtomId++
		const message: SharedStoreMessage<Event, State, CCS> = {
			type: 'mutation',
			mutation: atom,
		}
		transport.send(message)
	}

	async function _setStoreWithRetries(
		fn: (s: State) =>
			| StoreMutation[]
			| {
					mutations: StoreMutation[]
					events: Event[]
			  }
			| void,
		numRetries = 5
	) {
		return setStoreWithRetries(fn, applyTransaction, appliedTransactions, store, numRetries)
	}

	function applyTransaction(transaction: NewSharedStoreTransaction<Event>) {
		for (const mut of transaction.mutations) {
			mut.path = interpolatePath(mut.path, store)
		}
		let orderedTransaction: SharedStoreOrderedTransaction<Event>
		if (transaction.index == null) {
			orderedTransaction = {
				...transaction,
				index: appliedTransactions.length,
				mutationId: `${config.clientId}:${appliedTransactions.length}`,
			}
		} else {
			orderedTransaction = {
				...transaction,
				mutationId: `${config.clientId}:${transaction.index}`,
			}
		}
		broadcastAsCommitted(orderedTransaction)
		appliedTransactions.push(orderedTransaction)
		batch(() => {
			applyMutationsToStore(transaction.mutations, setStoreWithPath, store)
		})
		for (const mut of orderedTransaction.mutations) {
			mut.path = interpolatePath(mut.path, store)
		}
		for (const action of orderedTransaction.events) {
			event$.next(action)
		}
		return Promise.resolve(true)
	}

	return {
		setStore,
		setStoreWithRetries: _setStoreWithRetries,
		lockstepState: store,
		rollbackState: store,
		event$,
		config: () => config,
		clientControlled: clientControlled,
		get lastMutationIndex() {
			return nextAtomId - 1
		},
		initialized: clientControlled.initialized,
	}
}

function initClientControlledStateNode<CCS extends ClientControlledState>(
	config: () => ClientConfig<unknown, CCS> | null,
	transport: Transport<SharedStoreMessage<any, any, CCS>>,
	initialLocalState: CCS | null
) {
	const [store, setStore] = createStore<ClientControlledStates<CCS>>({})
	const subscription = new Subscription()

	async function setClientControlledState(state: Partial<CCS>) {
		await transport.waitForConnected()
		const { clientId } = await until(config)
		setStore(produce(updateLocalClientControlledState(clientId, state)))
		transport.send({
			type: 'client-controlled-states',
			states: {
				[clientId]: store[clientId],
			},
		})
	}

	const updateAllLocalClientControlledState =
		(newStates: ClientControlledStatesUpdate<CCS>): ((states: ClientControlledStates<CCS>) => void) =>
		(states: ClientControlledStates<CCS>) => {
			if (!newStates) return
			for (const [clientId, state] of Object.entries(newStates)) {
				updateLocalClientControlledState(clientId, state)(states)
			}
		}

	const updateLocalClientControlledState =
		(clientId: string, newState: ClientControlledState | null) => (states: ClientControlledStates<any>) => {
			if (newState == null) {
				delete states[clientId]
				return
			}
			for (const [key, value] of Object.entries(newState)) {
				if (value == null && states[clientId]) {
					delete states[clientId]![key]
				} else {
					states[clientId] ||= {}
					states[clientId]![key] = value
				}
			}
		}

	subscription.add(
		transport.message$.subscribe({
			next: (msg) => {
				if (msg.type !== 'client-controlled-states') return
				const out = produce(updateAllLocalClientControlledState(msg.states))
				setStore(out)
			},
		})
	)

	const [initialized, setInitialized] = createSignal(false)

	;(async () => {
		await transport.waitForConnected()
		const { clientId, clientControlledStates } = await until(config)
		if (initialLocalState !== null) {
			setStore(clientId, initialLocalState)
			transport.send({
				type: 'client-controlled-states',
				states: { [clientId]: initialLocalState },
			})
		}

		batch(() => {
			for (const [id, state] of Object.entries(clientControlledStates)) {
				if (id === clientId) continue
				setStore(produce(updateLocalClientControlledState(id, state)))
			}
		})
		setInitialized(true)
	})()

	onCleanup(() => {
		subscription.unsubscribe()
	})

	return {
		updateState: setClientControlledState,
		states: store,
		localState: () => (config()?.clientId ? store[config()!.clientId] : null),
		initialized,
	}
}

export function initFollowerStore<State extends object, CCS extends ClientControlledState = ClientControlledState, Event = any>(
	transport: Transport<SharedStoreMessage<Event, State, CCS>>,
	startingClientState = {} as CCS
): SharedStore<State, CCS, Event> {
	let nextAtomId = -1

	//#region statuses
	const [initialized, setInitialized] = createSignal(false)
	type Config = ClientConfig<State, CCS>
	const [config, setConfig] = createSignal(null as Config | null)
	const subscription = new Subscription()
	subscription.add(
		transport.message$
			.pipe(
				filter((msg) => msg.type === 'client-config'),
				endWith(null),
				first()
			)
			.subscribe((msg) => {
				if (!msg) return
				nextAtomId = msg.config.lastMutationIndex + 1
				setConfig(msg.config)
			})
	)

	//#endregion

	//#region stores
	const [lockstepStore, _setLockstepStore] = createStore<State>({} as State)
	const setLockstepStore = (...args: any[]) => {
		const path = args.slice(0, -1)
		//@ts-expect-error
		_setLockstepStore(...interpolatePath(path, lockstepStore), args[args.length - 1])
	}

	const [rollbackStore, _setRollbackStore] = createStore<State>({} as State)
	const setRollbackStore = (...args: any[]) => {
		const path = args.slice(0, -1)
		//@ts-expect-error
		_setRollbackStore(...interpolatePath(path, rollbackStore), args[args.length - 1])
	}

	//#endregion

	//#region actions
	const event$ = new Subject<Event>()
	subscription.add(event$)
	subscription.add(
		event$.subscribe((action) => {
			console.debug(`dispatching action: ${action}`)
		})
	)

	/**
	 * Dispatches action with no attached mutations
	 */
	function dispatchEvents(events: Event[]) {
		return _setStoreWithRetries(() => ({ events: events, mutations: [] }))
	}

	//#endregion

	//#region outgoing transactions
	const previousValues = new Map<number, any[]>()
	const transactionsBeingBuilt = new Set<SharedStoreTransactionBuilder<Event>>()
	const appliedTransactions = [] as NewSharedStoreOrderedTransaction<Event>[]
	const setStore = async (mutation: StoreMutation, transactionBuilder?: SharedStoreTransactionBuilder<Event>, events: Event[] = []) => {
		await until(initialized)
		let transaction: NewSharedStoreOrderedTransaction<Event>
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

			transaction = transactionBuilder.build(appliedTransactions.length, events)
		} else {
			transaction = {
				index: appliedTransactions.length,
				events: events,
				mutations: [mutation],
			}
		}
		return await applyTransaction(transaction)
	}

	async function applyTransaction(newTransaction: NewSharedStoreTransaction<Event>): Promise<boolean> {
		const previous: any[] = []
		const _config = await until(config)
		const transaction: SharedStoreTransaction<Event> = {
			...newTransaction,
			mutationId: `${_config.clientId!}:${nextAtomId}`,
		}
		nextAtomId++
		const message: SharedStoreMessage<Event, State, CCS> = {
			type: 'mutation',
			mutation: transaction,
		}
		transport.send(message)

		batch(() => {
			applyMutationsToStore(newTransaction.mutations, setRollbackStore, rollbackStore)
		})
		appliedTransactions.push(newTransaction)
		previousValues.set(newTransaction.index!, previous)

		return await firstValueFrom(
			observeIncomingMutations(transport).pipe(
				concatMap((m) => {
					if (m.index !== newTransaction.index) return []
					return [m.mutationId === transaction.mutationId]
				}),
				endWith(false)
			)
		)
	}

	async function _setStoreWithRetries(
		fn: (s: State) =>
			| StoreMutation[]
			| {
					mutations: StoreMutation[]
					events: Event[]
			  }
			| void,
		numRetries = 5
	) {
		await until(initialized)
		return setStoreWithRetries(fn, applyTransaction, appliedTransactions, rollbackStore, numRetries)
	}

	//#endregion

	//#region handle incoming transactions
	function handleReceivedTransaction(receivedAtom: SharedStoreOrderedTransaction<Event>) {
		const _config = config()!
		console.debug(`processing atom (${_config.clientId})`, receivedAtom, appliedTransactions.length)
		for (const mut of receivedAtom.mutations) {
			mut.path = interpolatePath(mut.path, lockstepStore)
		}

		applyMutationsToStore(receivedAtom.mutations, setLockstepStore, lockstepStore)
		if (appliedTransactions.length >= receivedAtom.index + 1) {
			const mutationToCompare = appliedTransactions[receivedAtom.index]

			// TODO we're handling this in a strange way. we're not handling cases where this client is multiple transactions ahead
			if (areTransactionsEqual(mutationToCompare, receivedAtom)) {
				// everything is fine, we don't need to store the previous value anymore
				previousValues.delete(receivedAtom.index)
				console.debug(_config.clientId, 'dispatching events')
				for (const action of receivedAtom.events) {
					event$.next(action)
				}
				return
			}

			// rollback
			for (let i = appliedTransactions.length - 1; i >= 0; i--) {
				const atomToRollback = appliedTransactions[i]
				if (i === receivedAtom.index) {
					// we're done, set the new head of the applied mutations
					applyMutationsToStore(receivedAtom.mutations, setRollbackStore, rollbackStore)
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
			applyMutationsToStore(receivedAtom.mutations, setRollbackStore, rollbackStore)
		}
		console.debug(_config.clientId, 'dispatching events')
		for (const action of receivedAtom.events) {
			event$.next(action)
		}
	}

	subscription.add(
		observeIncomingMutations(transport).subscribe(async (_receivedAtom) => {
			await until(config)
			// annoying but we have both receivedAtom and _receivedAtom for type narrowing reasons,
			const receivedAtom = _receivedAtom as SharedStoreOrderedTransaction<Event>
			if (receivedAtom.index == null) {
				throw new Error('order invariant transactions are deprecated')
			}

			batch(() => {
				handleReceivedTransaction(receivedAtom)
			})
		})
	)

	//#endregion
	const ccs = initClientControlledStateNode(config, transport, startingClientState)

	//#region initialize store
	;(async () => {
		const _config = await until(config)
		batch(() => {
			setRollbackStore(_config.initialState as State)
			setLockstepStore(_config.initialState as State)
		})
		appliedTransactions.length = _config.lastMutationIndex + 1
		console.debug('Initialized shared store for network ' + transport.networkId)
		await until(ccs.initialized)
		setInitialized(true)
	})()
	//#endregion

	onCleanup(() => {
		subscription.unsubscribe()
	})

	return {
		rollbackState: rollbackStore,
		lockstepState: lockstepStore,
		setStore,
		setStoreWithRetries: _setStoreWithRetries,
		clientControlled: ccs,
		config,
		initialized,
		event$,
		get lastMutationIndex() {
			return nextAtomId - 1
		},
	}
}

// TODO: usages are this function are messy, should clean up at some point
function interpolatePath(path: (string | number)[], store: any) {
	let current = store
	const _path = [...path]
	for (let i = 0; i < _path.length; i++) {
		const elt = _path[i]
		if (elt === PUSH) {
			if (!Array.isArray(current)) throw new Error("can't push to non-array")
			if (i !== _path.length - 1) throw new Error("can't push to non-terminal path")
			_path[i] = current.length
			break
		}
		if (!current) {
			console.error('attempted to resolve invalid path for store', path, store)
			throw new Error('invalid path')
		}
		current = current[_path[i]]
	}

	return _path
}

function resolveValue(path: (string | number)[], store: any) {
	let current = store
	for (let i = 0; i < path.length; i++) {
		const elt = path[i]
		if (!current) {
			console.error('attempted to resolve invalid path for store', path, store)
			throw new Error('invalid path')
		}
		current = current[elt]
	}
	return current
}

function areTransactionsEqual(a: NewSharedStoreTransaction<any>, b: NewSharedStoreTransaction<any>) {
	const _a = { mutations: a.mutations, index: a.index }
	const _b = { mutations: b.mutations, index: b.index }
	return deepEquals(_a, _b)
}

export interface Transport<Msg extends SharedStoreMessage<unknown>> {
	networkId: string
	message$: Observable<Msg>

	send(message: Msg): void

	waitForConnected(): Promise<void>

	dispose(): void

	disposed$: Promise<void>
}
function observeIncomingMutations<Event>(transport: Transport<SharedStoreMessage<Event>>) {
	return new Observable<SharedStoreTransaction<Event>>((subscriber) => {
		const subscription = transport.message$.subscribe((message) => {
			if (message.type === 'mutation') {
				subscriber.next(message.mutation)
			}
		})
		return () => {
			subscription.unsubscribe()
		}
	})
}

export function observeTimedOut(transport: Transport<SharedStoreMessage<any>>) {
	return new Observable<number>((subscriber) => {
		const subscription = transport.message$.subscribe((message) => {
			if (message.type === 'message-timeout') {
				subscriber.next(message.idleTime)
				subscriber.complete()
			}
		})
		return () => {
			subscription.unsubscribe()
		}
	})
}

export class SharedStoreTransactionBuilder<Event> {
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

	build(index: number, events: Event[]): NewSharedStoreOrderedTransaction<Event> {
		return {
			index,
			events,
			mutations: this.mutations,
		}
	}
}

export async function buildTransaction<Event>(fn: (t: SharedStoreTransactionBuilder<Event>) => Promise<void>) {
	const transaction = new SharedStoreTransactionBuilder<Event>()
	try {
		await fn(transaction)
		transaction.commit()
	} catch {
		transaction.abort()
	}
}
