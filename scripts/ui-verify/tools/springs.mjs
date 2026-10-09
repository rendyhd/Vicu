// Turns spring tokens (damping ratio and stiffness) into CSS linear() easing curves and durations,
// settling within 0.1 percent. Used to derive the motion tokens of the design system from the
// Material 3 spring values both apps share.
//
//   node scripts/ui-verify/tools/springs.mjs
const springs = {
  'spatial-fast (expressive)': { z: 0.6, k: 800 },
  'spatial-default (expressive)': { z: 0.8, k: 380 },
  'spatial-slow (expressive)': { z: 0.8, k: 200 },
  'spatial-default (standard)': { z: 0.9, k: 700 },
  'effects-fast': { z: 1.0, k: 3800 },
  'effects-default': { z: 1.0, k: 1600 },
  'effects-slow': { z: 1.0, k: 800 },
}

function pos(z, k, t) {
  const w0 = Math.sqrt(k)
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
}

const out = {}
for (const [name, { z, k }] of Object.entries(springs)) {
  // Settle time: the last moment the curve is more than 0.001 away from 1.
  let T = 0
  for (let t = 0; t < 3; t += 0.001) if (Math.abs(1 - pos(z, k, t)) > 0.001) T = t
  T = (Math.ceil((T * 1000) / 10) * 10) / 1000
  const n = 24
  const pts = []
  for (let i = 0; i <= n; i++) pts.push(+pos(z, k, (T * i) / n).toFixed(3))
  pts[n] = 1
  const overshoot = Math.max(...Array.from({ length: 2000 }, (_, i) => pos(z, k, (T * i) / 2000))) - 1
  out[name] = {
    damping: z,
    stiffness: k,
    ms: Math.round(T * 1000),
    overshootPct: +(Math.max(0, overshoot) * 100).toFixed(1),
    linear: `linear(${pts.join(', ')})`,
  }
}
console.log(JSON.stringify(out, null, 1))
