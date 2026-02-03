function sliceAdvanced<T>(arr: T[], start: number, end: number) {
	if (start > end) {
		return arr.slice(end, start + 1).reverse()
	} else {
		return arr.slice(start, end + 1)
	}
}
