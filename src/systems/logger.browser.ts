import pinoPkg from 'pino'

export const log = pinoPkg({
	level: 'trace',
	browser: {
		write: {
			info(o: any) {
				delete o.time
				delete o.level
				const msg = o.msg
				delete o.msg
				console.log(msg, o)
			},
			debug: (o: any) => {
				delete o.time
				delete o.level
				const msg = o.msg
				delete o.msg
				console.debug(msg, o)
			},
			trace: (o: any) => {
				delete o.time
				delete o.level
				const msg = o.msg
				delete o.msg
				console.debug(msg, o)
			},
			warn: (o: any) => {
				delete o.time
				delete o.level
				const msg = o.msg
				delete o.msg
				console.warn(msg, o)
			},
		},
	},
})
