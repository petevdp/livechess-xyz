export type OneToManyMap<K, V> = Map<K, V[]>

export function otmAdd<K, V>(key: K, value: V, map: OneToManyMap<K, V>): OneToManyMap<K, V> {
	let elts = map.get(key)
	if (!elts) {
		elts = []
		map.set(key, elts)
	}
	if (!elts.includes(value)) elts.push(value)
	return map
}
