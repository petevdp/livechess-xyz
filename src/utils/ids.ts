const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
if (characters.length !== 64) {
	throw new Error('characters length must be 64')
}
/**
 * Generates a URL-safe random ID with 64 bits of entropy per character.
 */
export function createId(size: number) {
	let result = ''
	const arr = new Uint8Array(size)
	crypto.getRandomValues(arr)

	for (let i = 0; i < arr.length; i++) {
		// we're wasting entropy here but it's not a big deal
		result += characters[arr[i] % 64]
	}

	return result
}
