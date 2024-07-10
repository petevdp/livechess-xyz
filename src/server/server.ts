import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { Crypto } from '@peculiar/webcrypto'
import Fastify from 'fastify'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import * as ws from 'ws'
import dotenv from 'dotenv'
dotenv.config()


import * as SSS from './systems/sharedStoreNetworks.ts'

if (typeof crypto === 'undefined') {
	import('@peculiar/webcrypto').then(() => {
		globalThis.crypto = new Crypto()
	})
}

if (!fs.existsSync('./logs')) {
	fs.mkdirSync('./logs')
}

// improve formatting of logs, have distinct development version
const envToLogger = {
	development: {
		transport: {
			target: 'pino-pretty',
			options: {
				translateTime: 'HH:MM:ss Z',
				ignore: 'pid,hostname',
				color: true,
			},
		},
	},
	production: {
		transport: {
			targets: [
				{
					level: 'info',
					target: 'pino-pretty',
					translateTime: 'HH:MM:ss Z',
					ignore: 'pid,hostname',
				},
				{
					level: 'trace',
					target: 'pino/file',
					options: {
						translateTime: 'HH:MM:ss Z',
						ignore: 'pid,hostname',
						destination: './logs/server.log',
					},
				},
			],
		},
	},
}

const environment = (process.env.NODE_ENV || 'development') as 'development' | 'production'
const server = Fastify({ logger: envToLogger[environment] })
server.log.info(`environment: %s`, environment)

server.register(fastifyWebsocket)
server.register(fastifyCors, () => {
	return (req: any, callback: any) => {
		const corsOptions = {
			// This is NOT recommended for production as it enables reflection exploits
			origin: true,
		}

		// do not include CORS headers for requests from localhost
		if (/^localhost$/m.test(req.headers.origin)) {
			corsOptions.origin = false
		}

		// callback expects two parameters: error and options
		callback(null, corsOptions)
	}
})
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
server.register(fastifyStatic, {
	root: PROJECT_ROOT,
})
//#region websocket routes
server.register(async function () {
	server.get('/api/networks/:networkId', { websocket: true }, (connection, request) => {
		//@ts-expect-error
		const networkId: string = request.params!.networkId
		const log = request.log.child({ networkId })

		SSS.handleNewConnection(connection.socket as unknown as ws.WebSocket, networkId, log)
	})
})
//#endregion

// for keep-alive on render server
server.get('/api/ping', () => {
	return 'pong\n'
})

server.post('/api/networks', () => {
	return SSS.createNetwork()
})

server.head('/api/networks/:networkId', (req, res) => {
	//@ts-expect-error
	const networkId: string = req.params.networkId
	if (SSS.getNetwork(networkId)) {
		res.status(200).send()
	} else {
		res.status(404).send()
	}
})
server.get('/rooms/:networkId', (_, res) => {
	// serve index.html
	return res.sendFile('index.html')
})

//

SSS.setupSharedStoreSystem(server.log)


if (!process.env.HOSTNAME) {
	server.log.error('No HOSTNAME provided')
	process.exit(1)
}

if (!process.env.PORT) {
	server.log.error('No PORT provided')
	process.exit(1)
}
const port = parseInt(process.env.PORT as string)
server.listen({ port, host: process.env.HOSTNAME }, (err, address) => {
	if (err) {
		server.log.error(err)
		process.exit(1)
	}
	server.log.info(`server listening on ${address}`)
})
