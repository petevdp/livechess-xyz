export class DefaultMap<K, V> {
	private dict: Map<K, V>

	constructor(
		private defaultValue: (key: K) => V,
		init?: [K, V][] | null
	) {
		this.dict = new Map<K, V>(init)
	}

	get(key: K): V | undefined {
		return this.dict.get(key)
	}

	getOrInit(key: K): V {
		if (!this.dict.has(key)) {
			this.dict.set(key, this.defaultValue(key))
		}
		return this.dict.get(key) as V
	}

	set(key: K, value: V) {
		this.dict.set(key, value)
	}

	has(key: K): boolean {
		return this.dict.has(key)
	}

	delete(key: K): boolean {
		return this.dict.delete(key)
	}

	pop(key: K): V {
		const value = this.getOrInit(key)
		this.delete(key)
		return value
	}

	get size(): number {
		return this.dict.size
	}

	values() {
		return this.dict.values()
	}

	entries() {
		return this.dict.entries()
	}
}
