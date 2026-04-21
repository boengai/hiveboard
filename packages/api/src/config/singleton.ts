import type { Config } from './schema'

let _config: Config | null = null

export function setConfig(c: Config | null): void {
  _config = c
}

export function getConfig(): Config | null {
  return _config
}
