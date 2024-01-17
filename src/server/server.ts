import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { Crypto } from '@peculiar/webcrypto'
import Fastify from 'fastify'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import * as ws from 'ws'

import * as SSS from './sharedStoreSystem.ts'


if (typeof crypto === 'undefined') {
	import('@peculiar/webcrypto').then(() => {
		globalThis.crypto = new Crypto()
	})
}


//TODO improve organization of this file

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
	//@ts-ignore
	return (req, callback) => {
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
let PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
server.register(fastifyStatic, {
	root: PROJECT_ROOT,
})
//#region websocket routes
server.register(async function () {
	server.get('/networks/:networkId', { websocket: true }, (connection, request) => {
		//@ts-ignore
		const networkId: string = request.params!.networkId
		const log = request.log.child({ networkId })

		SSS.handleNewConnection(connection.socket as unknown as ws.WebSocket, networkId, log)
	})
})
//#endregion

server.post('/networks', () => {
	return SSS.createNetwork()
})

server.get('/rooms/:networkId', (_, res) => {
	// serve index.html
	return res.sendFile('index.html')
})
//

SSS.setupSharedStoreSystem(server.log)

//@ts-ignore
const port: number = parseInt(process.env.PORT) || 8080

server.listen({ port, host: '0.0.0.0' }, (err, address) => {
	if (err) {
		server.log.error(err)
		process.exit(1)
	}
	server.log.info(`server listening on ${address}`)
})
