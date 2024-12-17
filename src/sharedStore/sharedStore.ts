import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Logger } from 'pino'
import { Observable, Subject, Subscription, concatMap, endWith, filter, first, firstValueFrom, map, mapTo } from 'rxjs'
import { Accessor, batch, createSignal, onCleanup } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

//#region types

// TODO: strong typing for paths and values like in solid's setStore
export type StoreMutation = {
	path: (string | number)[]
	value: any
}

type NewSharedStoreOrderedTransaction<Event extends BaseEvent = BaseEvent> = {
	index: number
	mutations: StoreMutation[]
	events: Event[]
}
export type BaseEvent = { type: string }
export type ClientTaggedEvent<Event extends BaseEvent> = Event & { clientId: string | 'LEADER' }

type NewSharedStoreTransaction<Event extends BaseEvent> = NewSharedStoreOrderedTransaction<Event>
export type SharedStoreTransaction<Event extends BaseEvent> = NewSharedStoreTransaction<Event> & {
	mutationId: string
}
export type SharedStoreOrderedTransaction<Event extends BaseEvent> = NewSharedStoreOrderedTransaction<Event> & {
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

export type SharedStoreMessage<
	Event extends BaseEvent = BaseEvent,
	State = any,
	CCS extends ClientControlledState = ClientControlledState,
> =
	| {
			type: 'mutation'
			mutation: SharedStoreTransaction<Event>
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

export type ClientControlledStateNode<CCS extends ClientControlledState, Event extends BaseEvent, State> = ReturnType<
	typeof initClientControlledStateNode<CCS, Event, State>
>

type SharedStoreContext = {
	log: Logger
}

export interface SharedStore<
	State extends object,
	CCS extends ClientControlledState = ClientControlledState,
	Event extends BaseEvent = BaseEvent,
> {
	lockstepState: State
	rollbackState: State
	clientControlled: ClientControlledStateNode<CCS, Event, State>

	setStore(
		mutation: StoreMutation,
		transactionBuilder?: SharedStoreTransactionBuilder<Event>,
		events?: Event[]
	): Promise<boolean | undefined>

	setStoreWithRetries(
		fn: (s: State) => StoreMutation[] | { mutations: StoreMutation[]; events: Event[] } | void,
		numRetries?: number
	): Promise<boolean>

	/**
	 * listen to events fired after a transaction is fully committed
	 */
	event$: Observable<ClientTaggedEvent<Event>>

	/**
	 * Fired on rollbacks
	 */
	rollback$: Observable<NewSharedStoreOrderedTransaction<Event>[]>

	/**
	 * listen to events fired before a transaction is committed
	 */
	initialized: Accessor<boolean>
	config: Accessor<ClientConfig<State, CCS> | null>
	lastMutationIndex: number
}

//#endregion

function applyMutationsToStore(mutations: StoreMutation[], setStore: (...args: any[]) => any, store: any) {
	for (const mutation of mutations) {
		// if (mutation.path.includes('outcome')) debugger
		const container = unwrap(resolveValue(mutation.path.slice(0, -1), store))
		if (mutation.value === DELETE && container instanceof Array) {
			setStore(
				...mutation.path.slice(0, -1),
				(container as any[]).filter((_, i) => i !== mutation.path[mutation.path.length - 1])
			)
			continue
		} else if (mutation.value === DELETE && typeof container === 'object') {
			setStore(
				produce((store) => {
					const container = resolveValue(mutation.path.slice(0, -1), store)
					delete container[mutation.path[mutation.path.length - 1]]
				})
			)
			continue
		} else if (mutation.value === DELETE) {
			throw new Error('unhandled type ' + typeof container)
		}
		setStore(...mutation.path, mutation.value)
	}
}

async function setStoreWithRetries<State, Event extends BaseEvent>(
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
			// if (res.mutations.some((m) => m.path.includes('outcome'))) debugger
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
		for (const mutation of transaction.mutations) {
			mutation.path = interpolatePath(mutation.path, rollbackStore)
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

export function initLeaderStore<
	State extends object,
	CCS extends ClientControlledState = ClientControlledState,
	Event extends BaseEvent = BaseEvent,
>(
	transport: Transport<SharedStoreMessage<ClientTaggedEvent<Event>, State, CCS>>,
	ctx: SharedStoreContext,
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
	const event$ = new Subject<ClientTaggedEvent<Event>>()
	// we never actually call .next in a leader store, but we need to satisfy the interface
	const rollback$ = new Subject<NewSharedStoreOrderedTransaction<ClientTaggedEvent<Event>>[]>()
	subscription.add(event$)
	subscription.add(rollback$)

	const appliedTransactions = [] as NewSharedStoreOrderedTransaction<Event>[]
	const transactionsBeingBuilt = new Set<SharedStoreTransactionBuilder<Event>>()
	const clientControlled = initClientControlledStateNode(() => config, transport, null)
	let nextAtomId = config.lastMutationIndex + 1

	//#endregion

	subscription.add(
		observeIncomingMutations(transport).subscribe(async (_receivedTransaction) => {
			const log = ctx.log.child({ mutationId: _receivedTransaction.mutationId })
			const receivedTransaction = _receivedTransaction as SharedStoreOrderedTransaction<ClientTaggedEvent<Event>>
			if (receivedTransaction.index == null) {
				throw new Error('impossible')
			}
			for (const mut of receivedTransaction.mutations) {
				mut.path = interpolatePath(mut.path, store)
			}

			// we've received the first valid mutation with this index
			if (receivedTransaction.index === appliedTransactions.length) {
				batch(() => {
					applyMutationsToStore(receivedTransaction.mutations, setStoreWithPath, store)
				})
				appliedTransactions.push(receivedTransaction)
				// this is now canonical state, and we can broadcast it
				broadcastAsCommitted(receivedTransaction, receivedTransaction.mutationId)
				for (const action of receivedTransaction.events) {
					event$.next(action)
				}
			} else {
				// TODO what to do here
				log
					.child({ mutationId: _receivedTransaction.mutationId })
					.warn(
						receivedTransaction,
						'received mutation with index %d that is not the next index: length: %d ',
						receivedTransaction.index,
						appliedTransactions.length
					)
			}
		})
	)

	async function setStore(mutation: StoreMutation, transactionBuilder?: SharedStoreTransactionBuilder<Event>, events: Event[] = []) {
		let transaction: NewSharedStoreOrderedTransaction<Event>
		mutation.path = interpolatePath(mutation.path, store)
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

	function broadcastAsCommitted(newAtom: NewSharedStoreOrderedTransaction<ClientTaggedEvent<Event>>, mutationId?: string) {
		const transaction: SharedStoreTransaction<ClientTaggedEvent<Event>> = {
			...newAtom,
			mutationId: mutationId || `${config.clientId}:${nextAtomId}`,
		}
		nextAtomId++
		const message: SharedStoreMessage<ClientTaggedEvent<Event>, State, CCS> = {
			type: 'mutation',
			mutation: transaction,
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
		let orderedTransaction: SharedStoreOrderedTransaction<ClientTaggedEvent<Event>>
		if (transaction.index == null) {
			orderedTransaction = {
				...transaction,
				events: transaction.events.map((e) => ({ ...e, clientId: config.clientId })),
				index: appliedTransactions.length,
				mutationId: `${config.clientId}:${appliedTransactions.length}`,
			}
		} else {
			orderedTransaction = {
				...transaction,
				events: transaction.events.map((e) => ({ ...e, clientId: config.clientId })),
				mutationId: `${config.clientId}:${transaction.index}`,
			}
		}
		broadcastAsCommitted(orderedTransaction)
		appliedTransactions.push(orderedTransaction)
		// if (orderedTransaction.mutations.some((m) => m.path.includes('outcoome'))) debugger
		batch(() => {
			applyMutationsToStore(transaction.mutations, setStoreWithPath, store)
		})
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
		rollback$,
		config: () => config,
		clientControlled: clientControlled,
		get lastMutationIndex() {
			return nextAtomId - 1
		},
		initialized: clientControlled.initialized,
	}
}

function initClientControlledStateNode<CCS extends ClientControlledState, Event extends BaseEvent, State>(
	config: () => ClientConfig<State, CCS> | null,
	transport: Transport<SharedStoreMessage<Event, any, CCS>>,
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

export function initFollowerStore<
	State extends object,
	CCS extends ClientControlledState = ClientControlledState,
	Event extends BaseEvent = BaseEvent,
>(
	transport: Transport<SharedStoreMessage<ClientTaggedEvent<Event>, State, CCS>>,
	ctx: SharedStoreContext,
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
	const event$ = new Subject<ClientTaggedEvent<Event>>()
	const rollback$ = new Subject<NewSharedStoreOrderedTransaction<Event>[]>()
	subscription.add(event$)
	// allow any downstream effects to happen before events are dispatched
	subscription.add(rollback$)
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
		return await applyTransaction(transaction, ctx)
	}

	async function applyTransaction(newTransaction: NewSharedStoreTransaction<Event>, ctx: SharedStoreContext): Promise<boolean> {
		const previous: any[] = []
		const _config = await until(config)
		const transaction: SharedStoreTransaction<ClientTaggedEvent<Event>> = {
			...newTransaction,
			events: newTransaction.events.map((e) => ({ ...e, clientId: _config.clientId })),
			mutationId: `${_config.clientId!}:${nextAtomId}`,
		}
		ctx.log.debug('applying transaction %s : %s', transaction.mutationId, transaction.events.map((e) => e.type).join(','))
		nextAtomId++
		const message: SharedStoreMessage<ClientTaggedEvent<Event>, State, CCS> = {
			type: 'mutation',
			mutation: transaction,
		}
		transport.send(message)

		batch(() => {
			applyMutationsToStore(newTransaction.mutations, setRollbackStore, rollbackStore)
		})
		appliedTransactions.push(newTransaction)
		previousValues.set(newTransaction.index!, previous)

		const nextMutation = await firstValueFrom(observeIncomingMutations(transport))
		if (nextMutation.index !== newTransaction.index) return false
		return nextMutation.mutationId === transaction.mutationId
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
		return setStoreWithRetries(fn, (s) => applyTransaction(s, ctx), appliedTransactions, rollbackStore, numRetries)
	}

	//#endregion

	//#region handle incoming transactions
	function handleReceivedTransaction(transaction: SharedStoreOrderedTransaction<ClientTaggedEvent<Event>>, ctx: SharedStoreContext) {
		transaction = JSON.parse(JSON.stringify(transaction))
		ctx.log.debug(transaction, `processing received transaction (%s)`, transaction.mutationId)
		for (const mut of transaction.mutations) {
			mut.path = interpolatePath(mut.path, lockstepStore)
		}

		applyMutationsToStore(transaction.mutations, setLockstepStore, lockstepStore)
		if (appliedTransactions.length >= transaction.index + 1) {
			const mutationToCompare = JSON.parse(JSON.stringify(appliedTransactions[transaction.index]))

			// TODO we're handling this in a strange way. we're not handling cases where this client is multiple transactions ahead
			if (areTransactionsEqual(mutationToCompare, transaction)) {
				// everything is fine, we don't need to store the previous value anymore
				previousValues.delete(transaction.index)
				for (const action of transaction.events) {
					event$.next(action)
				}
				return
			}
			console.debug('transactions are not equal, rolling back ', mutationToCompare, transaction)

			// rollback
			for (let i = appliedTransactions.length - 1; i >= 0; i--) {
				const transactionToRollBack = appliedTransactions[i]
				if (i === transaction.index) {
					// we're done, set the new head of the applied mutations
					applyMutationsToStore(transaction.mutations, setRollbackStore, rollbackStore)
					previousValues.delete(transactionToRollBack.index)
					break
				} else {
					for (let i = transactionToRollBack.mutations.length - 1; i >= 0; i--) {
						const mutation = transactionToRollBack.mutations[i]
						setRollbackStore(...mutation.path, previousValues.get(transactionToRollBack.index)![i])
					}
					previousValues.delete(transactionToRollBack.index)
				}
			}

			const rolledBackTransactions = appliedTransactions.slice(transaction.index)
			appliedTransactions.length = transaction.index
			appliedTransactions.push(transaction)
			rollback$.next(rolledBackTransactions)
		} else {
			appliedTransactions.push(transaction)
			applyMutationsToStore(transaction.mutations, setRollbackStore, rollbackStore)
		}
		for (const action of transaction.events) {
			event$.next(action)
		}
	}

	subscription.add(
		observeIncomingMutations(transport).subscribe(async (_receivedTransaction) => {
			await until(config)
			const receivedTransaction = _receivedTransaction as SharedStoreOrderedTransaction<ClientTaggedEvent<Event>>
			if (receivedTransaction.index == null) {
				throw new Error('order invariant transactions are deprecated')
			}

			batch(() => {
				handleReceivedTransaction(receivedTransaction, ctx)
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
		ctx.log.debug('Initialized shared store for network ' + transport.networkId)
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
		rollback$,
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

export interface Transport<Msg extends SharedStoreMessage> {
	networkId: string
	message$: Observable<Msg>

	send(message: Msg): void

	waitForConnected(): Promise<void>

	dispose(): void

	disposed$: Promise<void>
}

function observeIncomingMutations<Event extends BaseEvent = BaseEvent>(transport: Transport<SharedStoreMessage<Event>>) {
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

export class SharedStoreTransactionBuilder<Event extends BaseEvent = BaseEvent> {
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

export async function buildTransaction<Event extends BaseEvent = BaseEvent>(
	fn: (t: SharedStoreTransactionBuilder<Event>) => Promise<void>
) {
	const transaction = new SharedStoreTransactionBuilder<Event>()
	try {
		await fn(transaction)
		transaction.commit()
	} catch {
		transaction.abort()
	}
}
