'use client'

import { useEffect, useRef } from 'react'
import styles from './Tumbleweed.module.css'

// A tumbleweed crossing the horizon of the listening screen once: nothing is
// coming in, and the road is quiet. It is pushed by gusts, hops on the line
// and settles, and turns as far as it travels, so it rolls rather than slides.
// Clicked, it is kicked: up, and away from where it was hit.

const SIZE = 40
const RADIUS = SIZE / 2
const GRAVITY = 900 // px/s²
const BOUNCE = 0.55 // share of the fall kept on each hop
const BASE_SPEED = 92 // px/s
const KICK_UP = 440 // px/s, plus a little chance
const KICK_SIDE = 170 // px/s, plus a little chance
const KICK_DECAY = 1.6 // how fast a kick's push fades, per second
const SQUASH_MS = 160

// Wind: a few slow waves added together, so gusts come and go without a pattern.
function wind(t: number, seed: number): number {
  const w = Math.sin(t * 0.9 + seed) * 0.5 + Math.sin(t * 2.3 + seed * 2.1) * 0.3 + Math.sin(t * 0.37 + seed * 3.7) * 0.4
  return Math.max(0.35, 1 + w * 0.55)
}

export default function Tumbleweed() {
  const rollRef = useRef<HTMLSpanElement>(null)
  const squashRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  const shadowRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const roll = rollRef.current
    const track = roll?.parentElement
    if (!roll || !track) return
    const width = track.clientWidth
    const seed = Math.random() * 10
    let x = -SIZE
    let y = 0 // height above the line
    let vy = -260 // it arrives with a hop
    let push = 0 // what is left of the last kick, sideways
    let angle = 0
    let squashUntil = 0
    let squashDepth = 0
    let last = performance.now()
    const start = last
    let frame = 0

    // Hit away from the side it was clicked on: the left pushes it on, the
    // right sends it back.
    const kick = (event: PointerEvent) => {
      event.preventDefault()
      const box = roll.getBoundingClientRect()
      const side = (event.clientX - (box.left + box.width / 2)) / (box.width / 2)
      const away = side > 0.15 ? -1 : 1
      vy = -(KICK_UP + Math.random() * 140)
      push += away * (KICK_SIDE + Math.random() * 90)
      y = Math.max(y, 1)
    }
    roll.addEventListener('pointerdown', kick)

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = (now - start) / 1000
      const gust = wind(t, seed)
      push *= Math.exp(-KICK_DECAY * dt)
      const vx = BASE_SPEED * gust + push

      x += vx * dt
      vy += GRAVITY * dt
      y -= vy * dt
      if (y <= 0) {
        y = 0
        if (vy > 60) {
          // A landing: it gives a little, harder the faster it fell.
          squashDepth = Math.min(0.22, vy / 2600)
          squashUntil = now + SQUASH_MS
        }
        // Each landing keeps a little of the fall; a strong gust lifts it again.
        vy = -Math.abs(vy) * BOUNCE - (gust > 1.25 ? 120 : 0)
        if (Math.abs(vy) < 40) vy = 0
      }
      // Rolling without slipping: turned by distance over radius, either way.
      angle += (vx * dt) / RADIUS

      const squash = now < squashUntil ? squashDepth * Math.sin(((squashUntil - now) / SQUASH_MS) * Math.PI) : 0
      roll.style.transform = `translate3d(${x.toFixed(1)}px, ${(-y).toFixed(1)}px, 0)`
      if (squashRef.current) squashRef.current.style.transform = `scale(${(1 + squash * 0.6).toFixed(3)}, ${(1 - squash).toFixed(3)})`
      if (bodyRef.current) bodyRef.current.style.transform = `rotate(${angle.toFixed(3)}rad)`
      if (shadowRef.current) {
        const lift = Math.min(1, y / 70)
        shadowRef.current.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0) scaleX(${(1 - lift * 0.55).toFixed(2)})`
        shadowRef.current.style.opacity = (0.5 - lift * 0.38).toFixed(2)
      }
      if (x < width + SIZE && x > -SIZE * 2) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      roll.removeEventListener('pointerdown', kick)
    }
  }, [])

  return (
    <>
      <span ref={shadowRef} className={styles.shadow} />
      <span ref={rollRef} className={styles.roll}>
        <span ref={squashRef} className={styles.squash}>
          <span ref={bodyRef} className={styles.body}>
            <svg viewBox="0 0 48 48" width={SIZE} height={SIZE} aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                {/* The loose outer tangle, never quite a circle. */}
                <path strokeWidth="1.5" d="M9 27C7.5 16 16 7.5 27 8.5C37.5 9.5 43.5 19 40.5 29.5C37.5 40 24.5 44.5 15.5 38.5C10 35 8.5 31 9.5 25" />
                <path strokeWidth="1.1" d="M12.5 18.5C19.5 11.5 34 12 38.5 21.5C43 31 33.5 39.5 23.5 38.5C15.5 37.5 11 30.5 14 24" />
                <path strokeWidth="0.9" d="M16 34C11.5 25.5 17 15 26.5 14C35.5 13 40 24 34.5 31.5C31 36 25 36.5 21 33" />
                {/* Branches through the middle, each bent its own way. */}
                <path strokeWidth="1.2" d="M20 9.5C26.5 17.5 24.5 30 18 40.5" />
                <path strokeWidth="1" d="M34.5 11C28 19.5 29 32 36.5 39" />
                <path strokeWidth="0.9" d="M8.5 21C18 23.5 30 19.5 41.5 25" />
                <path strokeWidth="0.8" d="M10.5 32.5C19.5 28 31 31.5 39.5 34.5" />
                <path strokeWidth="0.7" d="M15 13C21 22 29 26 37 27.5" />
                <path strokeWidth="0.7" d="M29 40.5C27 31 21 24.5 12 22" />
                {/* Twigs that stick out. */}
                <path strokeWidth="1" d="M40.5 18.5L45 15.5M7.5 30.5L3 33M26 43.5L27 47M30 7L32.5 2.5M13 11.5L9.5 8M42 32L46 34.5" />
              </g>
            </svg>
          </span>
        </span>
      </span>
    </>
  )
}
