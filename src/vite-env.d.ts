/// <reference types="vite/client" />
import { type ClientEnv } from '~/environment.ts'

interface ImportMeta {
	readonly env: ClientEnv
}
