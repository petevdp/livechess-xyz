export const VARIANTS = ["regular", "fog-of-war", "duck", "fischer-random"] as const
export type Variant = typeof VARIANTS[number]
export const TIME_CONTROLS = ["15m", "10m", "5m", "3m", "1m"] as const
export type TimeControl = typeof TIME_CONTROLS[number]
export const INCREMENTS = ["0", "1", "2", "3", "5", "10"] as const
export type Increment = typeof INCREMENTS[number]


export type GameConfig = {
    variant: Variant,
    timeControl: TimeControl,
    increment: Increment
}

