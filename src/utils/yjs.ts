import {createStore} from "solid-js/store";
import {createSignal, onCleanup, onMount} from "solid-js";
import * as Y from 'yjs'

export type EntityCollection<T> = [string, T][]

export function getEntity<T>(collection: EntityCollection<T>, id: string): T | undefined {
    return collection.find(([k, _]) => k === id)?.[1]
}

export function yMapToStore<T>(map: Y.Map<T>): readonly[EntityCollection<T>, (key: string, v: T) => void] {
    const [store, setStore] = createStore([...map.entries()])
    const observer = (e: Y.YMapEvent<T>) => {
        console.log([...e.changes.keys.entries()])
        for (const [key, {action}] of e.changes.keys.entries()) {
            if (action === 'add') {
                setStore(store.length, [key, map.get(key)])
            } else if (action === 'delete') {
                setStore(s => s.filter(([k, _]) => k !== key))
            } else if (action === 'update') {
                setStore(([k, _]) => k === key, map.get(key)!)
            }
        }
    }
    onMount(() => {
        map.observe(observer)
    })
    onCleanup(() => {
        map.unobserve(observer)
    })

    const set = (key: string, value: T) => {
        map.set(key, value)
    }
    return [store, set] as const
}

export function yMapToSignal<T>(map: Y.Map<T>, key: string) {
    const [accessor, setAccessor] = createSignal<T | undefined>(map.get(key))
    const observer = (e: Y.YMapEvent<T>) => {
        if (e.keysChanged.has(key)) {
            setAccessor(() => map.get(key))
        }
    }
    onMount(() => {
        map.observe(observer)
    })
    onCleanup(() => {
        map.unobserve(observer)
    })
    const set = (value: T) => {
        map.set(key, value)
    }
    return [accessor, set] as const
}
