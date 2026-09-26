'use client'

import { useEffect, useId, useRef } from 'react'
import { CLOSED, OPEN, irisClipPath, lidPath, mix } from '@/lib/eye'
import styles from './Symbol.module.css'

// The Amble symbol: a calm, half-lidded eye that looks out for you. The same
// eye as the site (amble-web/src/components/Symbol.astro).
//
// The lid is one brush stroke resting over the iris, so the eye is relaxed,
// never wide open. The iris is the Rep: the moss dot that breathes while it is
// listening. The lid's open and closed shapes live in src/lib/eye.ts, sampled
// at the same points, so a blink is an interpolation between them and the
// iris, clipped to the lid's edge, disappears from the top.

interface SymbolProps {
  size?: number
  // The iris breathes, as on the listening screen (DESIGN_SYSTEM §22).
  breathe?: boolean
  // The lid draws itself in, the iris follows the pointer, and it blinks on its own.
  watch?: boolean
  // Starts closed and opens a moment after mounting (activation).
  wake?: boolean
  label?: string
  className?: string
}

const IRIS =
  'M32.65 29.46C32.38 30.46 31.76 31.47 31.09 32.26C30.42 33.04 29.51 33.70 28.61 34.17C27.72 34.63 26.68 34.96 25.70 35.06C24.72 35.16 23.64 35.06 22.72 34.77C21.79 34.48 20.89 33.94 20.15 33.34C19.41 32.73 18.80 31.96 18.28 31.15C17.76 30.34 17.30 29.45 17.03 28.49C16.76 27.52 16.53 26.41 16.65 25.37C16.77 24.33 17.13 23.12 17.75 22.27C18.36 21.41 19.39 20.65 20.35 20.24C21.32 19.84 22.52 19.80 23.52 19.85C24.51 19.90 25.46 20.24 26.35 20.55C27.24 20.86 28.06 21.21 28.86 21.70C29.67 22.19 30.55 22.74 31.19 23.49C31.83 24.25 32.46 25.24 32.70 26.24C32.95 27.23 32.92 28.45 32.65 29.46Z'

// A blink: the lid sweeps down fast, rests a beat, and lifts a little slower.
const CLOSE_MS = 120
const HOLD_MS = 110
const OPEN_MS = 300
const easeIn = (t: number) => t * t * t
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

// The iris travels inside the eye: mostly sideways, a little down, never up
// past the lid. It reaches its edge when the pointer is this far away.
const RANGE_X = 5.2
const RANGE_UP = 1.2
const RANGE_DOWN = 3
const FULL_AT = 260

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function Symbol({ size = 28, breathe = false, watch = false, wake = false, label, className }: SymbolProps) {
  const uid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const lidRef = useRef<SVGPathElement>(null)
  const clipRef = useRef<SVGPathElement>(null)
  const irisRef = useRef<SVGGElement>(null)
  const blinking = useRef(false)
  const start = wake ? CLOSED : OPEN

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const calm = reducedMotion()
    const timers: number[] = []
    let frame = 0

    const setLid = (k: number) => {
      const shape = mix(OPEN, CLOSED, k)
      lidRef.current?.setAttribute('d', lidPath(shape))
      clipRef.current?.setAttribute('d', irisClipPath(shape))
    }

    const animate = (ms: number, curve: (elapsed: number) => number, done?: () => void) => {
      const t0 = performance.now()
      const step = (now: number) => {
        const elapsed = now - t0
        setLid(Math.max(0, Math.min(1, curve(elapsed))))
        if (elapsed < ms) frame = requestAnimationFrame(step)
        else done?.()
      }
      frame = requestAnimationFrame(step)
    }

    const blink = (hold = HOLD_MS) => {
      if (calm || blinking.current) return
      blinking.current = true
      animate(
        CLOSE_MS + hold + OPEN_MS,
        (e) => (e < CLOSE_MS ? easeIn(e / CLOSE_MS) : e < CLOSE_MS + hold ? 1 : 1 - easeOut((e - CLOSE_MS - hold) / OPEN_MS)),
        () => {
          setLid(0)
          blinking.current = false
        },
      )
    }

    // Open slowly from closed: the eye waking up.
    const open = (ms: number) => (calm ? setLid(0) : animate(ms, (e) => 1 - easeOut(Math.min(1, e / ms))))

    // Clicked or tapped, any eye closes deliberately. Inside a link (the logo),
    // the eye itself only blinks; the wordmark still navigates.
    const onClick = (event: MouseEvent) => {
      if (svg.closest('a')) event.preventDefault()
      blink(420)
    }
    svg.addEventListener('click', onClick)

    // In a background tab the eye closes, and opens again when you come back.
    const onVisibility = () => (document.hidden ? setLid(1) : open(520))
    document.addEventListener('visibilitychange', onVisibility)

    if (wake) timers.push(window.setTimeout(() => open(1100), 700))

    // Watching eyes blink on their own now and then, unhurried, while on screen.
    if (watch && !calm) {
      const next = () => {
        timers.push(
          window.setTimeout(() => {
            const box = svg.getBoundingClientRect()
            if (box.bottom > 0 && box.top < window.innerHeight && !document.hidden) blink()
            next()
          }, 4500 + Math.random() * 5500),
        )
      }
      next()
    }

    // The iris follows the pointer: eased, so it never jitters, and back to
    // centre when the pointer leaves.
    let pointer: { x: number; y: number } | null = null
    const iris = { x: 0, y: 0, tx: 0, ty: 0 }
    let following = false
    const aim = () => {
      if (!pointer) {
        iris.tx = 0
        iris.ty = 0
        return
      }
      const box = svg.getBoundingClientRect()
      const dx = pointer.x - (box.left + box.width / 2)
      const dy = pointer.y - (box.top + box.height * 0.57)
      const dist = Math.hypot(dx, dy) || 1
      const reach = Math.min(1, dist / FULL_AT)
      iris.tx = (dx / dist) * RANGE_X * reach
      const vy = (dy / dist) * reach
      iris.ty = vy < 0 ? vy * RANGE_UP : vy * RANGE_DOWN
    }
    const tick = () => {
      iris.x += (iris.tx - iris.x) * 0.16
      iris.y += (iris.ty - iris.y) * 0.16
      if (irisRef.current) irisRef.current.style.transform = `translate(${iris.x.toFixed(2)}px, ${iris.y.toFixed(2)}px)`
      following = Math.abs(iris.tx - iris.x) > 0.01 || Math.abs(iris.ty - iris.y) > 0.01
      if (following) requestAnimationFrame(tick)
    }
    const follow = () => {
      aim()
      if (!following) {
        following = true
        requestAnimationFrame(tick)
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      follow()
    }
    const onPointerLeave = () => {
      pointer = null
      follow()
    }
    if (watch && !calm) {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('scroll', follow, { passive: true })
      document.documentElement.addEventListener('pointerleave', onPointerLeave)
    }

    return () => {
      svg.removeEventListener('click', onClick)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('scroll', follow)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      timers.forEach((id) => window.clearTimeout(id))
      cancelAnimationFrame(frame)
    }
  }, [watch, wake])

  const classes = [styles.symbol, breathe ? styles.breathe : '', watch ? styles.watch : '', className ?? ''].filter(Boolean).join(' ')

  return (
    <svg
      ref={svgRef}
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={`iris-${uid}`}>
          <path ref={clipRef} d={irisClipPath(start)} />
        </clipPath>
        {watch && (
          <clipPath id={`lid-${uid}`}>
            <rect className={styles.draw} x="0" y="0" width="48" height="48" />
          </clipPath>
        )}
      </defs>
      <g clipPath={`url(#iris-${uid})`}>
        <g ref={irisRef} className={styles.iris}>
          <path className={styles.dot} d={IRIS} />
        </g>
      </g>
      <path ref={lidRef} className={styles.lid} clipPath={watch ? `url(#lid-${uid})` : undefined} d={lidPath(start)} />
    </svg>
  )
}
