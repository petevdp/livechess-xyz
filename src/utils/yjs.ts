import * as Y from 'yjs'
import { Observable, share, Subscription } from 'rxjs'
import { Awareness } from 'y-protocols/awareness'

export type EntityStoreDef<E extends any = any> = {
	key: (e: E) => string
	startingValues: E[]
}

export type Event = {
	type: string
}

export type HasTimestampAndIndex = {
	ts: number
	index: number
}

export type EventDef<E extends Event = Event> = {
	example: E
}

export type ValueDef<T = any> = {
	default: T
}

export type DataConfig = {
	entities: { [key: string]: EntityStoreDef }
	events: { [key: string]: EventDef }
	values: { [key: string]: ValueDef }
	awareness: {
		[key: string]: any
	}
}

export type DefKey<K extends keyof DC, DC extends DataConfig> = keyof DC[K]

export type EntityKey<DC extends DataConfig> = DefKey<'entities', DC>
export type EntityValue<
	DC extends DataConfig,
	EK extends EntityKey<DC>,
> = DC['entities'][EK]['startingValues'][number]

export type EntityChange<DC extends DataConfig, EK extends EntityKey<DC>> =
	| {
			insert: EntityValue<DC, EK>
	  }
	| {
			update: EntityValue<DC, EK>
	  }
	| {
			delete: EK
	  }

export type EventKey<DC extends DataConfig> = DefKey<'events', DC>

export type EventValue<
	DC extends DataConfig,
	EK extends EventKey<DC> = EventKey<DC>,
> = DC['events'][EK]['example']

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export class YState<DC extends DataConfig> {
	entities: { [EK in EntityKey<DC>]: Y.Map<EntityValue<DC, EK>> }
	eventLedgers: {
		[EK in EventKey<DC>]: Y.Array<EventValue<DC, EK> & HasTimestampAndIndex>
	}
	valueMap: Y.Map<EventValue<DC>>
	connectionStatus$: Observable<ConnectionStatus>

	docDestroyed$: Promise<void>
	docReady$: Promise<boolean>
	connectionStatus: ConnectionStatus = 'disconnected'
	private subscription: Subscription = new Subscription()

	constructor(
		private doc: Y.Doc,
		private provider: any,
		private dataConfig: DC,
		private awareness: Awareness,
		creating: boolean
	) {
		this.docDestroyed$ = new Promise((resolve) => {
			this.doc.once('destroy', () => {
				resolve()
			})
		})

		this.entities = {} as typeof this.entities
		this.setupEntities()

		this.eventLedgers = {} as typeof this.eventLedgers
		this.setupEvents()

		this.valueMap = doc.getMap('values')
		this.setupValues()

		this.setupAwareness()

		this.connectionStatus$ = new Observable((sub) => {
			const listener = ({ status }: { status: string }) => {
				this.connectionStatus = status as ConnectionStatus
				sub.next(status)
			}

			this.provider.on('status', listener)
			return () => {
				this.provider.off('status', listener)
			}
		}).pipe(share<any>())

		this.subscription.add(this.connectionStatus$.subscribe())

		if (creating) {
			// This ensures that the 'sync' event will be called on the provider when another client connects, as it won't fire if the documnt is empty
			this.doc.getArray('__init__').push([true])
			// if we're creating the document, we assume that we're connecting to a new yjs room and there's no need to wait for the sync event
			this.docReady$ = Promise.resolve(true)
		} else {
			this.docReady$ = new Promise((resolve) => {
				provider.once('sync', () => {
					resolve(true)
				})
			})
		}
	}

	observeEntity<K extends EntityKey<DC>>(key: K, includeExisting: boolean) {
		return new Observable<EntityChange<DC, K>>((sub) => {
			const observer = (e: Y.YMapEvent<EntityValue<DC, K>>) => {
				for (const [k, { action }] of e.changes.keys.entries()) {
					if (action === 'add') {
						sub.next({ insert: e.target.get(k)! })
					} else if (action === 'delete') {
						sub.next({ delete: k as K })
					} else if (action === 'update') {
						sub.next({ update: e.target.get(k)! })
					}
				}
			}

			this.docReady$.then(() => {
				if (includeExisting) {
					for (let v of this.entities[key].values()) {
						sub.next({ insert: v })
					}
				}
				this.entities[key].observe(observer)
			})

			this.docDestroyed$.then(() => {
				sub.complete()
			})

			return () => {
				try {
					this.entities[key].unobserve(observer)
				} catch {
					// ignore
				}
			}
		})
	}

	observeEvent<EK extends EventKey<DC>>(key: EK, includePrevious: boolean) {
		type EventWithTimestamp = EventValue<DC, EK> & HasTimestampAndIndex
		return new Observable<EventWithTimestamp>((sub) => {
			const observer = (e: Y.YArrayEvent<EventWithTimestamp>) => {
				const insertEvents = e.changes.delta
					.map((c) => c.insert)
					.filter((c) => !!c)
					.flat() as EventWithTimestamp[]
				for (let event of insertEvents) {
					sub.next(event)
				}
			}
			this.docReady$.then(() => {
				if (includePrevious) {
					for (let v of this.eventLedgers[key].toArray()) {
						sub.next(v)
					}
				}
				this.eventLedgers[key].observe(observer)
			})

			this.docDestroyed$.then(() => {
				sub.complete()
			})

			return () => {
				try {
					this.eventLedgers[key].unobserve(observer)
				} catch {
					// ignore
				}
			}
		})
	}

	async getAllevents<EK extends EventKey<DC>>(key: EK) {
		await this.docReady$
		return this.eventLedgers[key].toArray()
	}

	async dispatchEvent<EK extends EventKey<DC>>(
		key: EK,
		value: EventValue<DC, EK>
	) {
		await this.docReady$
		this.eventLedgers[key].push([
			{ ...value, ts: Date.now(), index: this.eventLedgers[key].length },
		])
	}

	async setEntity<K extends EntityKey<DC>>(
		key: K,
		id: ReturnType<DC['entities'][K]['key']>,
		value: EntityValue<DC, K>
	) {
		await this.docReady$
		this.entities[key].set(id, value)
	}

	async getAllEntities<K extends EntityKey<DC>>(key: K) {
		await this.docReady$
		return [...this.entities[key].values()]
	}

	async getEntity<K extends EntityKey<DC>>(key: K, id: string) {
		await this.docReady$
		return this.entities[key].get(id)
	}

	async setValue(
		key: keyof DC['values'],
		value: DC['values'][keyof DC['values']]['default']
	) {
		await this.docReady$
		this.valueMap.set(key as string, value)
	}

	async getValue<K extends keyof DC['values']>(key: K) {
		await this.docReady$
		return this.valueMap.get(key as string) as DC['values'][K]['default']
	}

	observeAwareness(includeExisting: boolean) {
		return new Observable<DC['awareness']>((sub) => {
			const listener = () => {
				sub.next(this.awareness.states as DC['awareness'])
			}

			this.docReady$.then(() => {
				if (includeExisting) {
					sub.next(this.awareness.states as DC['awareness'])
				}
				this.awareness.on('update', listener)
			})

			return () => {
				this.awareness.off('update', listener)
			}
		})
	}

	observeValue<K extends keyof DC['values']>(key: K, includeExisting: boolean) {
		return new Observable<DC['values'][K]['default']>((sub) => {
			const listener = () => {
				sub.next(this.valueMap.get(key as string) as DC['values'][K]['default'])
			}

			this.docReady$.then(() => {
				if (includeExisting) {
					sub.next(
						this.valueMap.get(key as string) as DC['values'][K]['default']
					)
				}
				this.valueMap.observe(listener)
			})

			return () => {
				this.valueMap.unobserve(listener)
			}
		})
	}

	async getAwarenessState() {
		await this.docReady$
		return this.awareness.states
	}

	setLocalAwarenessState<K extends keyof DC['awareness']>(
		key: K,
		state: DC['awareness'][K]
	) {
		this.awareness.setLocalStateField(key as string, state)
	}

	async destroy() {
		this.doc.destroy()
		this.provider.destroy()
		await this.docDestroyed$
	}

	private async setupEntities() {
		for (let key of Object.keys(this.dataConfig.entities)) {
			this.entities[key as EntityKey<DC>] = this.doc.getMap(key)
		}

		await this.docReady$
		for (let [key, def] of Object.entries(this.dataConfig.entities)) {
			for (let [k, v] of def.startingValues) {
				if (!this.entities[key as EntityKey<DC>].has(k)) {
					this.entities[key as EntityKey<DC>].set(k, v)
				}
			}
		}
	}

	private setupEvents() {
		for (let key of Object.keys(this.dataConfig.events)) {
			this.eventLedgers[key as EventKey<DC>] = this.doc.getArray(key)
		}
	}

	private async setupValues() {
		await this.docReady$
		for (let [key, def] of Object.entries(this.dataConfig.values)) {
			if (!this.valueMap.has(key)) {
				this.valueMap.set(key, def.default)
			}
		}
	}

	private setupAwareness() {
		for (let [key, def] of Object.entries(this.dataConfig.awareness)) {
			this.awareness.setLocalStateField(key, def)
		}
	}
}
