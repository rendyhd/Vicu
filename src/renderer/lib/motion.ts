import { readReducedMotion } from '@/hooks/use-reduced-motion'

// Motion helpers (card 4.1). The numbers come from the design tokens (test-fixtures/design-tokens-v1.json,
// "motion"): tokens.css carries the durations and the generated spring curves as CSS variables, and
// the helpers here read them, so a component never writes a millisecond value or an easing.
//
// Reduced motion (docs/design-system-v1.md section 6): the helpers that move something (animateFLIP,
// animateDrop) do nothing under prefers-reduced-motion: reduce, because a move has no fade variant.
// Callers whose reduced variant is a fade ask `useReducedMotion()` themselves.

export type MotionDuration =
  | 'fade-fast'
  | 'fade-base'
  | 'move'
  | 'move-expressive'
  | 'pop'
  | 'page-out'
  | 'page-in'
  | 'keyboard-move-max'

export type MotionSpringToken = 'move' | 'move-expressive' | 'pop'
export type MotionEasing = 'standard' | 'enter' | 'exit'

/** Milliseconds from a CSS time: "150ms", "0.2s". Anything else is 0. */
export function parseCssTime(text: string): number {
  const match = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/.exec(text)
  if (!match) return 0
  const value = Number(match[1])
  return match[2] === 's' ? value * 1000 : value
}

function rootStyle(): CSSStyleDeclaration | null {
  return typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
}

/** A duration token in ms, read from `--dur-<name>`. 0 where there is no document. */
export function motionMs(name: MotionDuration): number {
  return parseCssTime(rootStyle()?.getPropertyValue(`--dur-${name}`) ?? '')
}

/** The spring token as a CSS `linear()` easing, from `--spring-<name>`; "ease-out" where it is missing. */
export function motionSpringCurve(name: MotionSpringToken): string {
  return rootStyle()?.getPropertyValue(`--spring-${name}`).trim() || 'ease-out'
}

/** A cubic-bezier easing token, from `--ease-<name>`. */
export function motionEasing(name: MotionEasing): string {
  return rootStyle()?.getPropertyValue(`--ease-${name}`).trim() || 'ease'
}

// ---- Springs ----------------------------------------------------------------------------------

export interface Spring {
  /** Damping ratio (1 = critical). */
  damping: number
  /** Compose stiffness, with a mass of 1. */
  stiffness: number
}

/** The spatial springs of the motion tokens (a test keeps these equal to the fixture). */
export const SPRINGS: Record<MotionSpringToken, Spring> = {
  move: { damping: 0.9, stiffness: 700 },
  'move-expressive': { damping: 0.8, stiffness: 380 },
  pop: { damping: 0.6, stiffness: 800 },
}

/**
 * Where a spring that started `from` away from its rest position (0) with `velocity` (units per
 * second, towards the rest position negative) is after `seconds`. Closed-form solution of the damped
 * oscillator, so a drop that is released while moving continues with that speed instead of
 * restarting from standstill.
 */
export function springOffset({ damping: z, stiffness: k }: Spring, from: number, velocity: number, seconds: number): number {
  const t = Math.max(0, seconds)
  const w0 = Math.sqrt(k)
  if (Math.abs(z - 1) < 1e-6) {
    return (from + (velocity + w0 * from) * t) * Math.exp(-w0 * t)
  }
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z)
    return Math.exp(-z * w0 * t) * (from * Math.cos(wd * t) + ((velocity + z * w0 * from) / wd) * Math.sin(wd * t))
  }
  const root = w0 * Math.sqrt(z * z - 1)
  const r1 = -z * w0 + root
  const r2 = -z * w0 - root
  const c2 = (velocity - r1 * from) / (r2 - r1)
  const c1 = from - c2
  return c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t)
}

export interface SpringSamples {
  /** Offsets from rest, one per `stepMs`, ending at 0. */
  values: number[]
  stepMs: number
  durationMs: number
}

/**
 * The spring sampled every `stepMs` until it is within `restDelta` of rest (and slow), at most
 * `maxMs`. The last value is exactly 0 so an animation built from it ends where the element rests.
 */
export function sampleSpring(
  spring: Spring,
  from: number,
  velocity: number,
  { stepMs = 16, restDelta = 0.4, maxMs = 1200 } = {},
): SpringSamples {
  const values: number[] = []
  const steps = Math.ceil(maxMs / stepMs)
  let quiet = 0
  for (let i = 0; i <= steps; i++) {
    const t = (i * stepMs) / 1000
    const x = springOffset(spring, from, velocity, t)
    // Speed from a small look-ahead, in units per second.
    const speed = (springOffset(spring, from, velocity, t + 0.004) - x) / 0.004
    values.push(x)
    // Rest: close to the target and nearly still, for a few samples in a row (a spring passing
    // through rest at speed must not stop early).
    quiet = Math.abs(x) <= restDelta && Math.abs(speed) <= restDelta * 10 ? quiet + 1 : 0
    if (quiet >= 3) break
  }
  values[values.length - 1] = 0
  return { values, stepMs, durationMs: (values.length - 1) * stepMs }
}

export interface PointerSample {
  /** ms timestamp */
  t: number
  x: number
  y: number
}

/** Pointer velocity in px per second over the last `windowMs` of the samples; zero for fewer than two. */
export function pointerVelocity(samples: readonly PointerSample[], windowMs = 100): { x: number; y: number } {
  if (samples.length < 2) return { x: 0, y: 0 }
  const last = samples[samples.length - 1]
  const first = samples.find((s) => last.t - s.t <= windowMs) ?? samples[0]
  const dt = (last.t - first.t) / 1000
  if (dt <= 0) return { x: 0, y: 0 }
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
}

// ---- FLIP -------------------------------------------------------------------------------------

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Smaller shifts than this (px) are not worth animating. */
const MIN_SHIFT = 0.5

/** The translation that puts `last` back where `first` was; null when it did not move. */
export function flipDelta(first: Box, last: Box): { dx: number; dy: number } | null {
  const dx = first.left - last.left
  const dy = first.top - last.top
  return Math.abs(dx) < MIN_SHIFT && Math.abs(dy) < MIN_SHIFT ? null : { dx, dy }
}

/** The position of every element now, to hand to `animateFLIP` after the layout changed. */
export function measureRects(elements: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>()
  for (const el of elements) rects.set(el, el.getBoundingClientRect())
  return rects
}

export interface FlipOptions {
  /** The move was caused by the keyboard: it is capped at the keyboard-move token and does not bounce. */
  keyboard?: boolean
  /** Start each element a little after the one before it (the stagger token, at most its maximum). */
  stagger?: boolean
}

/** The start delay of the element at `index` in a staggered group: `stepMs` apart, the index capped at `max`. */
export function staggerDelay(index: number, stepMs: number, max: number): number {
  return Math.max(0, Math.min(index, max)) * stepMs
}

/** The delay of element `index` of a staggered group, from the --stagger and --stagger-max tokens. */
export function motionStagger(index: number): number {
  const step = parseCssTime(rootStyle()?.getPropertyValue('--stagger') ?? '')
  const max = Number(rootStyle()?.getPropertyValue('--stagger-max')) || 5
  return staggerDelay(index, step, max)
}

/**
 * Plays one element from `(dx, dy)` away to where it is: the spring of `token`, or capped and
 * eased for a keyboard move. Does nothing under reduced motion. Returns the animation.
 */
export function playMoveFrom(
  el: HTMLElement,
  dx: number,
  dy: number,
  token: Extract<MotionSpringToken, 'move' | 'move-expressive'> = 'move',
  { keyboard = false, delay = 0 }: { keyboard?: boolean; delay?: number } = {},
): Animation | null {
  if (readReducedMotion() || typeof el.animate !== 'function') return null
  if (Math.abs(dx) < MIN_SHIFT && Math.abs(dy) < MIN_SHIFT) return null
  return el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
    duration: keyboard ? Math.min(motionMs(token), motionMs('keyboard-move-max')) : motionMs(token),
    easing: keyboard ? motionEasing('standard') : motionSpringCurve(token),
    delay,
    fill: 'backwards',
  })
}

/**
 * First, Last, Invert, Play. Measure with `measureRects` before the change, change the layout, then
 * call this: every element that moved slides from its old position to the new one with the spring
 * of `token`. Returns the running animations. Does nothing under reduced motion (the new layout
 * simply appears).
 */
export function animateFLIP(
  elements: Iterable<HTMLElement>,
  first: ReadonlyMap<HTMLElement, DOMRect>,
  token: Extract<MotionSpringToken, 'move' | 'move-expressive'> = 'move',
  { keyboard = false, stagger = false }: FlipOptions = {},
): Animation[] {
  if (readReducedMotion()) return []
  const running: Animation[] = []
  let index = 0
  for (const el of elements) {
    const before = first.get(el)
    if (!before) continue
    const delta = flipDelta(before, el.getBoundingClientRect())
    if (!delta) continue
    const animation = playMoveFrom(el, delta.dx, delta.dy, token, { keyboard, delay: stagger ? motionStagger(index) : 0 })
    if (animation) {
      running.push(animation)
      index++
    }
  }
  return running
}

/**
 * A drop that settles: the element is `offset` px away from where it now belongs and was let go with
 * `velocity` px per second; it springs into place carrying that speed. Under reduced motion it just
 * lands. Returns the animation, or null when there was nothing to animate.
 */
export function animateDrop(
  el: HTMLElement,
  offset: { x: number; y: number },
  velocity: { x: number; y: number } = { x: 0, y: 0 },
  token: Extract<MotionSpringToken, 'move' | 'move-expressive'> = 'move-expressive',
): Animation | null {
  if (readReducedMotion() || typeof el.animate !== 'function') return null
  if (Math.abs(offset.x) < MIN_SHIFT && Math.abs(offset.y) < MIN_SHIFT) return null
  const spring = SPRINGS[token]
  const sx = sampleSpring(spring, offset.x, velocity.x)
  const sy = sampleSpring(spring, offset.y, velocity.y)
  const frames = Math.max(sx.values.length, sy.values.length)
  const keyframes: Keyframe[] = []
  for (let i = 0; i < frames; i++) {
    const x = sx.values[Math.min(i, sx.values.length - 1)]
    const y = sy.values[Math.min(i, sy.values.length - 1)]
    keyframes.push({ transform: `translate(${x}px, ${y}px)` })
  }
  return el.animate(keyframes, { duration: (frames - 1) * sx.stepMs, easing: 'linear' })
}
