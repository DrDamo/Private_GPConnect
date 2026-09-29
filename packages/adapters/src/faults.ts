import { AdapterError, type AdapterName } from './errors'

// Fault injection for demos and error-path testing: an admin can make any
// national service slow, time out or be unavailable. Applied as a wrapper so
// the same switch works for simulators and (in a test environment) real clients.

export type Fault = { kind: 'timeout' } | { kind: 'unavailable' } | { kind: 'latency'; ms: number }

export interface FaultSource {
  get(adapter: AdapterName): Promise<Fault | null>
}

/** A fault source an operator can change (admin console). */
export interface FaultControl extends FaultSource {
  set(adapter: AdapterName, fault: Fault | null): Promise<void> | void
  all(): Promise<Partial<Record<AdapterName, Fault>>>
}

export const ADAPTER_NAMES: AdapterName[] = ['pds', 'sds', 'nhs-login', 'sms', 'gp-connect', 'mesh']

/** Faults held in memory (one server instance; tests and local development). */
export class InMemoryFaultSource implements FaultControl {
  private readonly faults = new Map<AdapterName, Fault>()
  async get(adapter: AdapterName) {
    return this.faults.get(adapter) ?? null
  }
  /** Applies immediately (synchronously), so tests needn't await it. */
  set(adapter: AdapterName, fault: Fault | null) {
    if (fault) this.faults.set(adapter, fault)
    else this.faults.delete(adapter)
  }
  async all() {
    return Object.fromEntries(this.faults) as Partial<Record<AdapterName, Fault>>
  }
}

export const NO_FAULTS: FaultSource = { get: async () => null }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Returns `impl` with the named async methods guarded by the fault source.
 * Other members are passed through untouched.
 */
export function withFaults<T extends object>(
  adapter: AdapterName,
  impl: T,
  asyncMethods: ReadonlyArray<keyof T & string>,
  faults: FaultSource,
): T {
  const wrapped = Object.create(impl) as T
  for (const name of asyncMethods) {
    const original = impl[name]
    if (typeof original !== 'function') throw new Error(`${adapter}.${name} is not a method`)
    ;(wrapped as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      const fault = await faults.get(adapter)
      if (fault?.kind === 'timeout') throw new AdapterError(adapter, 'timeout', 'simulated timeout')
      if (fault?.kind === 'unavailable') throw new AdapterError(adapter, 'unavailable', 'simulated outage')
      if (fault?.kind === 'latency') await sleep(fault.ms)
      return (original as (...a: unknown[]) => unknown).apply(impl, args)
    }
  }
  return wrapped
}
