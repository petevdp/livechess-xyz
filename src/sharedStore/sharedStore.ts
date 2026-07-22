import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Logger } from 'pino'
import { Observable, Subject, Subscription, filter } from 'rxjs'
import { Accessor, batch, createSignal, onCleanup } from 'solid-js'
import { createStore, produce, reconcile } from 'solid-js/store'

import { createId } from '~/utils/ids.ts'
import { deepClone } from '~/utils/obj.ts'

import * as ODSM from './odsm.ts'

//#region types

export type { OpId } from './odsm.ts'
export { RejectedError } from './odsm.ts'

export type BaseOp = ODSM.BaseOp
export type BaseEvent = { type: string }

export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never
// a domain op minus the fields the store stamps at dispatch time
export type NewOp<Op extends BaseOp> = DistributiveOmit<Op, 'opId'>

// convenience for reducers: reject the batch being applied
export function reject<T = unknown>(data: T, message?: string): never {
	throw new ODSM.RejectedError(data, { message })
}

/**
 * builds a batch reducer from a single-op handler. the handler either returns the next state
 * (using structural sharing), emits side effects via `emit`, or throws via `reject` -- which
 * rejects the whole batch, per ODSM's all-or-nothing batch semantics.
 */
export function makeReducer<Op extends BaseOp, S, SE extends BaseEvent>(
	applyOp: (state: S, op: Op, emit: (se: SE) => void) => S
): ODSM.Reducer<Op, S, SE> {
	return (state, ops, _prevOps) => {
		const sideEffects: SE[] = []
		const emit = (se: SE) => sideEffects.push(se)
		let next = state
		for (const op of ops) next = applyOp(next, op, emit)
		return [next, sideEffects] as const
	}
}

export type StoreDefinition<Op extends BaseOp, S, SE extends BaseEvent> = {
	reducer: ODSM.Reducer<Op, S, SE>
	/**
	 * paths into the state whose values are NOT reconciled into the reactive proxy tree. instead
	 * they're exposed as plain javascript values on `store.raw`, tracked by reference equality --
	 * reducers use structural sharing, so an untouched raw value keeps its identity and doesn't
	 * notify. use for large/hot values (e.g. move history) where deep proxying is a perf drag.
	 */
	rawPaths?: readonly (readonly string[])[]
}

export type ClientControlledState = { [key: string]: any | null }
export type ClientControlledStates<T extends ClientControlledState> = {
	[key: string]: T
}

export type ClientControlledStatesUpdate<S extends ClientControlledState> = {
	[key: string]: null | S
}

export type ClientConfig<S, Op extends BaseOp, CCS extends ClientControlledState> = {
	clientId: string
	state: S
	// the tail of the committed op history, so a (re)connecting client can dedupe in-flight ops
	ops: Op[]
	clientControlledStates: ClientControlledStates<CCS>
	// the server's wall clock at config time, so clients can stamp op times in server time
	// (see SharedStore.serverNow) instead of trusting their possibly-skewed local clock
	serverTime: number
}

// why the server refused to commit an op batch. `message` is user-facing.
export type OpsRejectedReason = { code: string; message: string }

export type NewNetworkResponse = {
	networkId: string
}

export type SharedStoreMessage<Op extends BaseOp = BaseOp, State = any, CCS extends ClientControlledState = ClientControlledState> =
	| {
			// client -> server: a new (dependent) batch of ops
			// server -> clients: a batch committed to the canonical history, broadcast to everyone
			// including the originator (who treats it as an ack and replays its own pending copies)
			type: 'ops'
			ops: Op[]
	  }
	| {
			// server -> originator: the batch failed validation at the network layer (bad identity,
			// implausible timestamps, ...) and was never committed. the originator discards the ops
			// and rolls its optimistic state back.
			type: 'ops-rejected'
			opIds: ODSM.OpId[]
			reason: OpsRejectedReason
	  }
	| {
			type: 'client-config'
			config: ClientConfig<State, Op, CCS>
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

type SharedStoreContext = {
	log: Logger
}

export type DispatchResult<SE extends BaseEvent = BaseEvent> =
	| {
			rejected: true
			error: ODSM.RejectedError
	  }
	| {
			rejected: false
			/**
			 * resolves once the batch lands on the synced timeline: true if it applied cleanly, false if
			 * it was rejected against the canonical history (i.e. our optimistic apply got rolled back)
			 * or the connection dropped first. side effects for the batch fire on `event$`.
			 */
			confirmed: Promise<boolean>
			sideEffects?: SE[]
	  }

export type ClientControlledStateNode<CCS extends ClientControlledState> = ReturnType<typeof initClientControlledStateNode<CCS>>

export interface SharedStore<
	State extends object,
	Op extends BaseOp = BaseOp,
	SE extends BaseEvent = BaseEvent,
	CCS extends ClientControlledState = ClientControlledState,
> {
	/**
	 * reactive (deeply proxied) view of the local optimistic state. values at rawPaths are absent
	 * here -- read them from `raw` instead.
	 */
	state: State

	/**
	 * plain (non-proxied) values for the configured rawPaths, behind reference-equality signals.
	 * only the configured paths are populated.
	 */
	raw: Readonly<State>

	/** the plain local (optimistic) state -- always current, no tracking */
	snapshot(): State

	/** the plain synced (canonical-so-far) state */
	syncedSnapshot(): State

	/** the committed op history tail (leader) / synced op history tail (follower) */
	history(): Op[]

	/**
	 * stamps opIds onto the given ops and applies them as one all-or-nothing batch: optimistically on
	 * a follower (then sends them to the server), authoritatively on a leader (then broadcasts them).
	 * a batch the reducer rejects against the current local state is dropped entirely.
	 */
	dispatch(...ops: NewOp<Op>[]): Promise<DispatchResult<SE>>

	/** side effects emitted by ops landing on the synced timeline */
	event$: Observable<SE>

	/** fired when optimistic local state gets replaced by a diverging canonical replay */
	rollback$: Observable<void>

	/** the plain local state after every change (optimistic or synced) -- for persistence etc. */
	stateUpdate$: Observable<State>

	/**
	 * batches of ours the server refused to commit (failed network-layer validation). the ops have
	 * already been discarded and the optimistic state rolled back by the time this fires -- the
	 * reason is for surfacing to the user.
	 */
	opsRejected$: Observable<OpsRejectedReason>

	/**
	 * the current time on the server's clock (estimated via the config handshake on followers).
	 * op payload times must be stamped with this: the server rejects timestamps that are
	 * implausible on ITS clock, however skewed the local one is.
	 */
	serverNow(): number

	clientControlled: ClientControlledStateNode<CCS>
	config: Accessor<ClientConfig<State, Op, CCS> | null>
	initialized: Accessor<boolean>
}

export interface Transport<Msg extends SharedStoreMessage<any, any, any>> {
	networkId: string
	message$: Observable<Msg>

	send(message: Msg): void

	waitForConnected(): Promise<void>

	dispose(): void

	disposed$: Promise<void>
}

//#endregion

export function createOpId() {
	return createId(12)
}

//#region reactive views

function resolvePath(obj: any, path: readonly string[]) {
	let current = obj
	for (const seg of path) {
		if (current == null) return undefined
		current = current[seg]
	}
	return current
}

// returns a copy of `state` with the raw paths removed, cloning containers along each path so the
// original is untouched (structural sharing everywhere else)
function stripRawPaths<S>(state: S, rawPaths: readonly (readonly string[])[]): S {
	if (rawPaths.length === 0) return state
	const root: any = Array.isArray(state) ? [...(state as any)] : { ...state }
	const cloned = new Set<any>([root])
	for (const path of rawPaths) {
		let node = root
		let missing = false
		for (let i = 0; i < path.length - 1; i++) {
			const child = node[path[i]]
			if (child == null || typeof child !== 'object') {
				missing = true
				break
			}
			if (!cloned.has(child)) {
				const copy = Array.isArray(child) ? [...child] : { ...child }
				node[path[i]] = copy
				cloned.add(copy)
			}
			node = node[path[i]]
		}
		if (!missing) delete node[path[path.length - 1]]
	}
	return root
}

function initReactiveViews<S extends object>(rawPaths: readonly (readonly string[])[]) {
	const [state, setState] = createStore<S>({} as S)

	const rawSignals = new Map<string, [Accessor<unknown>, (v: () => unknown) => void]>()
	const raw: any = {}
	for (const path of rawPaths) {
		const [get, set] = createSignal<unknown>(undefined)
		rawSignals.set(path.join('/'), [get, set as any])
		let node = raw
		for (let i = 0; i < path.length - 1; i++) {
			node[path[i]] ??= {}
			node = node[path[i]]
		}
		Object.defineProperty(node, path[path.length - 1], {
			get,
			enumerable: true,
		})
	}

	function update(next: S) {
		batch(() => {
			// reconcile mutates the store's target tree in place and adopts source nodes by reference,
			// so hand it a clone -- the session's states use structural sharing and must never be
			// reachable (and thus mutable) through the store
			setState(reconcile(deepClone(stripRawPaths(next, rawPaths))))
			for (const path of rawPaths) {
				const [, set] = rawSignals.get(path.join('/'))!
				set(() => resolvePath(next, path))
			}
		})
	}

	return { state, raw: raw as Readonly<S>, update }
}

//#endregion

//#region leader store

/**
 * the authoritative replica: applies batches directly to the canonical history and broadcasts them.
 * used server-side (one per network) and for purely local sessions (vs bot) with a null transport.
 */
export function initLeaderStore<
	State extends object,
	Op extends BaseOp = BaseOp,
	SE extends BaseEvent = BaseEvent,
	CCS extends ClientControlledState = ClientControlledState,
>(
	transport: Transport<SharedStoreMessage<Op, State, CCS>>,
	def: StoreDefinition<Op, State, SE>,
	ctx: SharedStoreContext,
	startingState: State
): SharedStore<State, Op, SE, CCS> {
	const log = ctx.log.child({ client: 'LEADER' })
	let session = ODSM.Server.initSession<Op, State>(startingState)

	const views = initReactiveViews<State>(def.rawPaths ?? [])
	views.update(session.state)

	const subscription = new Subscription()
	const event$ = new Subject<SE>()
	const rollback$ = new Subject<void>() // a leader never rolls back; interface parity only
	const stateUpdate$ = new Subject<State>()
	const opsRejected$ = new Subject<OpsRejectedReason>() // interface parity; leader batches reject locally
	subscription.add(event$)
	subscription.add(rollback$)
	subscription.add(stateUpdate$)
	subscription.add(opsRejected$)
	subscription.add(
		event$.subscribe((event) => {
			log.debug(event, 'emitting %s', event.type)
		})
	)

	const config: ClientConfig<State, Op, CCS> = {
		clientId: 'LEADER',
		state: startingState,
		ops: [],
		clientControlledStates: {},
		serverTime: Date.now(),
	}
	const clientControlled = initClientControlledStateNode<CCS>(
		() => config.clientId,
		() => config.clientControlledStates,
		transport,
		null
	)

	function commit(ops: Op[]): ODSM.Applied<ODSM.Server.Session<Op, State>, SE> {
		const applied = ODSM.Server.applyOps(session, ops, def.reducer)
		session = applied.session
		// rejected batches are still recorded in history and broadcast so every replica's history
		// stays coherent -- they just don't change state
		transport.send({ type: 'ops', ops })
		if (!applied.rejected) {
			views.update(session.state)
			stateUpdate$.next(session.state)
			for (const se of applied.sideEffects) event$.next(se)
		}
		return applied
	}

	subscription.add(
		transport.message$.subscribe((msg) => {
			if (msg.type !== 'ops') return
			log.debug('received op batch: %s', msg.ops.map((o) => o.opId).join(','))
			try {
				commit(msg.ops)
			} catch (err) {
				// duplicate opIds etc: a protocol violation, not a rejection
				log.error(err, 'failed to process incoming op batch')
			}
		})
	)

	async function dispatch(...newOps: NewOp<Op>[]): Promise<DispatchResult<SE>> {
		const ops = newOps.map((op) => ({ ...op, opId: createOpId() })) as unknown as Op[]
		// like client-authored batches, a batch rejected against the current state is dropped entirely
		// instead of polluting the canonical history
		try {
			def.reducer(session.state, ops, session.ops)
		} catch (error) {
			if (error instanceof ODSM.RejectedError) {
				log.debug(error.data, 'batch rejected locally: %s', error.message)
				return { rejected: true, error }
			}
			throw error
		}
		const applied = commit(ops)
		if (applied.rejected) return { rejected: true, error: applied.error }
		return { rejected: false, confirmed: Promise.resolve(true), sideEffects: applied.sideEffects }
	}

	onCleanup(() => {
		subscription.unsubscribe()
	})

	return {
		state: views.state,
		raw: views.raw,
		snapshot: () => session.state,
		syncedSnapshot: () => session.state,
		history: () => session.ops,
		dispatch,
		event$,
		rollback$,
		stateUpdate$,
		opsRejected$,
		serverNow: () => Date.now(),
		clientControlled,
		config: () => config,
		initialized: clientControlled.initialized,
	}
}

//#endregion

//#region follower store

export function initFollowerStore<
	State extends object,
	Op extends BaseOp = BaseOp,
	SE extends BaseEvent = BaseEvent,
	CCS extends ClientControlledState = ClientControlledState,
>(
	transport: Transport<SharedStoreMessage<Op, State, CCS>>,
	def: StoreDefinition<Op, State, SE>,
	ctx: SharedStoreContext,
	startingClientState = {} as CCS
): SharedStore<State, Op, SE, CCS> {
	let log = ctx.log.child({ networkId: transport.networkId })

	let session = ODSM.Client.initSession<Op, State>({} as State)
	const views = initReactiveViews<State>(def.rawPaths ?? [])

	const subscription = new Subscription()
	const [config, setConfig] = createSignal<ClientConfig<State, Op, CCS> | null>(null)
	const [initialized, setInitialized] = createSignal(false)

	const event$ = new Subject<SE>()
	const rollback$ = new Subject<void>()
	const stateUpdate$ = new Subject<State>()
	const opsRejected$ = new Subject<OpsRejectedReason>()
	// estimated from the config handshake; kept at 0 until then
	let serverTimeOffset = 0
	subscription.add(event$)
	subscription.add(rollback$)
	subscription.add(stateUpdate$)
	subscription.add(opsRejected$)
	subscription.add(
		event$.subscribe((e) => {
			log.info(e, 'emitting %s', e.type)
		})
	)
	subscription.add(
		rollback$.subscribe(() => {
			log.info('rolled back optimistic state')
		})
	)

	// opId -> resolver for the dispatch confirmation promise
	const confirmations = new Map<string, (confirmed: boolean) => void>()
	function resolveConfirmations(opIds: string[], confirmed: boolean) {
		for (const opId of opIds) {
			confirmations.get(opId)?.(confirmed)
			confirmations.delete(opId)
		}
	}
	void transport.disposed$.then(() => {
		for (const resolve of confirmations.values()) resolve(false)
		confirmations.clear()
	})

	function afterSyncedApply(prev: ODSM.Client.Session<Op, State>, applied: ODSM.Applied<ODSM.Client.Session<Op, State>, SE>) {
		session = applied.session
		if (session.localState !== prev.localState) {
			views.update(session.localState)
			stateUpdate$.next(session.localState)
		}
		if (!applied.rejected) {
			for (const se of applied.sideEffects) event$.next(se)
		}
		// our optimistic timeline got fully reconciled against the canonical history and came out
		// different: downstream consumers may need to re-derive things they built off optimistic state
		if (
			prev.pendingOps.length > 0 &&
			session.pendingOps.length === 0 &&
			session.localState !== prev.localState &&
			!deepEquals(session.localState, prev.localState)
		) {
			rollback$.next()
		}
	}

	subscription.add(
		transport.message$.subscribe((msg) => {
			switch (msg.type) {
				case 'client-config': {
					log = log.child({ clientId: msg.config.clientId })
					serverTimeOffset = msg.config.serverTime - Date.now()
					session = ODSM.Client.processInit(session, msg.config.state, msg.config.ops, def.reducer)
					views.update(session.localState)
					stateUpdate$.next(session.localState)
					setConfig(msg.config)
					break
				}
				case 'ops': {
					if (!config()) {
						log.error('received ops before client-config, dropping')
						break
					}
					const prev = session
					try {
						// the server broadcasts committed batches to everyone including the originator: a batch
						// of our own ops doubles as the ack, and we replay our pending copies instead
						if (msg.ops.some((op) => prev.pendingOps.some((p) => p.opId === op.opId))) {
							const applied = ODSM.Client.processAcks(
								prev,
								msg.ops.map((op) => op.opId),
								def.reducer
							)
							if (applied.unknownOpIds.length > 0) {
								log.warn('acked opIds unknown to this client: %s', applied.unknownOpIds.join(','))
							}
							afterSyncedApply(prev, applied)
							resolveConfirmations(
								applied.ackedOps.map((op) => op.opId),
								!applied.rejected
							)
						} else {
							afterSyncedApply(prev, ODSM.Client.processIncomingOps(prev, msg.ops, def.reducer))
						}
					} catch (err) {
						log.error(err, 'failed to process incoming op batch')
					}
					break
				}
				case 'ops-rejected': {
					log.warn(msg.reason, 'server rejected op batch %s: %s', msg.opIds.join(','), msg.reason.code)
					const prev = session
					session = ODSM.Client.discardPendingOps(prev, msg.opIds, def.reducer)
					if (session.localState !== prev.localState) {
						views.update(session.localState)
						stateUpdate$.next(session.localState)
						if (!deepEquals(session.localState, prev.localState)) rollback$.next()
					}
					resolveConfirmations(msg.opIds, false)
					opsRejected$.next(msg.reason)
					break
				}
			}
		})
	)

	async function dispatch(...newOps: NewOp<Op>[]): Promise<DispatchResult<SE>> {
		await until(initialized)
		const ops = newOps.map((op) => ({ ...op, opId: createOpId() })) as unknown as Op[]
		const res = ODSM.Client.processOutgoingOps(session, ops, def.reducer)
		if (res.rejected) {
			log.debug(res.error.data, 'batch rejected locally: %s', res.error.message)
			return { rejected: true, error: res.error }
		}
		session = res.session
		views.update(session.localState)
		stateUpdate$.next(session.localState)
		const confirmed = Promise.all(ops.map((op) => new Promise<boolean>((resolve) => confirmations.set(op.opId, resolve)))).then((results) =>
			results.every(Boolean)
		)
		log.debug('dispatching ops %s', ops.map((op) => op.opId).join(','))
		transport.send({ type: 'ops', ops })
		return { rejected: false, confirmed }
	}

	const ccs = initClientControlledStateNode<CCS>(
		() => config()?.clientId ?? null,
		() => config()?.clientControlledStates ?? null,
		transport,
		startingClientState
	)

	;(async () => {
		await until(config)
		await until(ccs.initialized)
		log.debug('Initialized shared store for network %s', transport.networkId)
		setInitialized(true)
	})()

	onCleanup(() => {
		subscription.unsubscribe()
	})

	return {
		state: views.state,
		raw: views.raw,
		snapshot: () => session.localState,
		syncedSnapshot: () => session.syncedState,
		history: () => session.syncedOps,
		dispatch,
		event$,
		rollback$,
		stateUpdate$,
		opsRejected$,
		serverNow: () => Date.now() + serverTimeOffset,
		clientControlled: ccs,
		config,
		initialized,
	}
}

//#endregion

//#region client controlled state

function initClientControlledStateNode<CCS extends ClientControlledState>(
	clientId: () => string | null,
	initialStates: () => ClientControlledStates<CCS> | null,
	transport: Transport<SharedStoreMessage<any, any, CCS>>,
	initialLocalState: CCS | null
) {
	const [store, setStore] = createStore<ClientControlledStates<CCS>>({})
	const subscription = new Subscription()
	// fires after every change to `states`. solid reactivity is inert in the server build, so
	// server-side routines subscribe to this instead of tracking the store
	const update$ = new Subject<void>()
	subscription.add(update$)

	async function setClientControlledState(state: Partial<CCS>) {
		await transport.waitForConnected()
		const id = await until(clientId)
		setStore(produce(updateLocalClientControlledState(id, state)))
		update$.next()
		transport.send({
			type: 'client-controlled-states',
			states: {
				[id]: store[id],
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
				update$.next()
			},
		})
	)

	const [initialized, setInitialized] = createSignal(false)

	;(async () => {
		await transport.waitForConnected()
		const id = await until(clientId)
		const states = (await until(initialStates)) as ClientControlledStates<CCS>
		if (initialLocalState !== null) {
			setStore(id, initialLocalState)
			transport.send({
				type: 'client-controlled-states',
				states: { [id]: initialLocalState },
			})
		}

		batch(() => {
			for (const [otherId, state] of Object.entries(states)) {
				if (otherId === id) continue
				setStore(produce(updateLocalClientControlledState(otherId, state)))
			}
		})
		update$.next()
		setInitialized(true)
	})()

	onCleanup(() => {
		subscription.unsubscribe()
	})

	return {
		updateState: setClientControlledState,
		states: store,
		update$: update$ as Observable<void>,
		localState: () => (clientId() ? store[clientId()!] : null),
		initialized,
	}
}

//#endregion

export function observeTimedOut(transport: Transport<SharedStoreMessage<any, any, any>>) {
	return new Observable<number>((subscriber) => {
		const subscription = transport.message$.pipe(filter((msg) => msg.type === 'message-timeout')).subscribe((message) => {
			subscriber.next((message as SharedStoreTimeoutMessage).idleTime)
			subscriber.complete()
		})
		return () => {
			subscription.unsubscribe()
		}
	})
}
