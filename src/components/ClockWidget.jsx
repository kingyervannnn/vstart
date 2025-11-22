import { useState, useEffect, useMemo, memo } from 'react'
import { motion } from 'framer-motion'

// Minimal, sleek industrial JP-inspired styling via CSS classes
// Applied with font-feature-settings, tracking and uppercase feel

const TIMEZONES = [
  { id: 'Asia/Yerevan', label: 'Yerevan' },
  { id: 'Europe/Vienna', label: 'Vienna' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'America/New_York', label: 'New York' },
]

const sanitizeHex = (hex, fallback = '#ffffff') => {
  if (!hex || typeof hex !== 'string') return fallback
  const clean = hex.trim()
  if (!clean.startsWith('#')) return clean
  const body = clean.slice(1)
  if (body.length >= 6) return `#${body.slice(0, 6)}`
  return fallback
}

const hexToRgba = (hex, alpha = 1) => {
  try {
    const normalized = sanitizeHex(hex)
    const body = normalized.slice(1)
    const r = parseInt(body.slice(0, 2), 16)
    const g = parseInt(body.slice(2, 4), 16)
    const b = parseInt(body.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch {
    return `rgba(255,255,255,${alpha})`
  }
}

const ClockWidget = ({ settings = { showSeconds: true, twentyFourHour: true, layoutPreset: 'preset1', subTimezones: ['Asia/Yerevan','Europe/Vienna'], fontPreset: 'industrial', colorPrimary: '#ffffff', colorAccent: '#00ffff', p2OutlineSubTimes: false, p2ShadeSubTimes: false, p2OutlineMainTime: false, p2ShadeMainTime: false, removeOutlines: false, verticalOffset: 0 } }) => {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), settings.showSeconds ? 1000 : 1000)
    return () => clearInterval(interval)
  }, [settings.showSeconds])

  const mainTime = useMemo(() => formatTime(now, undefined, settings), [now, settings])
  const mainDate = useMemo(() => formatDate(now), [now])

  const subs = useMemo(() => {
    const list = Array.isArray(settings.subTimezones) ? settings.subTimezones : []
    return list
      .map(tz => ({ tz, label: (TIMEZONES.find(z => z.id === tz)?.label) || tz.split('/').pop().replace('_',' ') }))
      .slice(0, 4)
  }, [settings.subTimezones])

  const isPreset2 = (settings.layoutPreset || 'preset1') === 'preset2'
  const mainParts = formatParts(now, undefined, settings)
  const removeOutlines = !!settings.removeOutlines
  const isMirrored = !!settings.isMirrorLayout

  // Use theme tokens passed from App.jsx (already resolved through theme token resolver)
  // The resolvedWidgetsSettings contains the properly resolved font, primary, and accent colors
  const family = settings.resolvedFontFamily || 'Noto Sans JP, Inter, system-ui, sans-serif'
  const colorPrimary = sanitizeHex(settings.colorPrimary, '#ffffff')
  const colorAccent = sanitizeHex(settings.colorAccent, '#00ffff')
  const subtlePrimary = hexToRgba(colorPrimary, 0.75)

  const mainTimeFrame = settings.p2OutlineMainTime || settings.p2ShadeMainTime
  const mainTimeClasses = [
    isPreset2 ? 'text-[56px]' : 'text-[40px]',
    'leading-none',
    'font-semibold',
    'font-industrial-jp',
    'tracking-[0.06em]'
  ]
  if (mainTimeFrame) mainTimeClasses.push('rounded-lg', 'px-2')
  if (settings.p2ShadeMainTime) mainTimeClasses.push('bg-white/10')
  if (settings.p2OutlineMainTime && !removeOutlines) mainTimeClasses.push('border', 'border-white/20')

  const mainTimeStyle = {
    fontVariantNumeric: 'tabular-nums',
    color: colorPrimary,
    boxShadow: settings.p2OutlineMainTime && removeOutlines
      ? `0 16px 40px -22px ${hexToRgba(colorAccent, 0.55)}`
      : undefined
  }

  const rootStyle = isMirrored
    ? { fontFamily: family, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }
    : { fontFamily: family }

  return (
    <div className="p-0 select-none" style={{ ...rootStyle, transform: `translateY(${Number(settings.verticalOffset || 0)}px)` }}>
      <div className={isMirrored ? 'w-full text-right' : 'text-left'}>
        {/* Main time */}
        <motion.div
          key={`${mainParts.hour}${mainParts.minute}${mainParts.period}`}
          initial={{ y: 6, opacity: 0.85 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.12 }}
          className={mainTimeClasses.join(' ')}
          style={mainTimeStyle}
        >
          {mainParts.hour}:{mainParts.minute}
          {!settings.twentyFourHour && mainParts.period && (
            <span className="ml-2 align-top text-base" style={{ color: colorAccent }}>{mainParts.period}</span>
          )}
        </motion.div>
        <div className="mt-2 text-xs font-industrial-jp tracking-[0.2em]" style={{ color: colorAccent }}>
          {mainDate}
        </div>
      </div>

      {/* Sub timezones */}
      {!isPreset2 ? (
        <div className={`mt-4 space-y-1 ${isMirrored ? 'w-full' : ''}`}>
          {subs.map(({ tz, label }) => {
            const t = formatTime(now, tz, settings)
            return (
              <div
                key={tz}
                className={`flex items-baseline ${isMirrored ? 'justify-end gap-4 text-right' : 'justify-between'}`}
              >
                <span className="text-[11px] uppercase tracking-[0.2em] font-industrial-jp" style={{ color: colorAccent }}>{label}</span>
                <span className="text-sm font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums', color: subtlePrimary }}>{t}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className={`mt-4 flex flex-wrap gap-2 w-full ${isMirrored ? 'justify-end' : ''}`}>
          {subs.map(({ tz, label }) => {
            const parts = formatParts(now, tz, settings)
            const capsuleClasses = [
              'rounded-full',
              'px-3',
              'py-2'
            ]
            if (settings.p2ShadeSubTimes) capsuleClasses.push('bg-white/10')
            if (settings.p2OutlineSubTimes && !removeOutlines) capsuleClasses.push('border', 'border-white/20')
            const capsuleStyle = {
              boxShadow: settings.p2OutlineSubTimes && removeOutlines
                ? `0 12px 30px -20px ${hexToRgba(colorAccent, 0.5)}`
                : undefined
            }
            return (
              <div key={tz} className={capsuleClasses.join(' ')} style={capsuleStyle}>
                <div className="flex flex-col items-center justify-center leading-tight font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span className="text-xs uppercase tracking-[0.2em]" style={{ color: colorAccent }}>{label}</span>
                  <span className="text-base" style={{ color: colorPrimary }}>{parts.hour}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg" style={{ color: colorPrimary }}>{parts.minute}</span>
                    {!settings.twentyFourHour && parts.period && (
                      <span className="text-[10px]" style={{ color: colorAccent }}>{parts.period}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatTime(date, timeZone, opts) {
  const { showSeconds = true, twentyFourHour = true } = opts || {}
  const parts = {
    hour: '2-digit',
    minute: '2-digit',
    ...(showSeconds ? { second: '2-digit' } : {}),
    hour12: !twentyFourHour,
    ...(timeZone ? { timeZone } : {})
  }
  return new Intl.DateTimeFormat(undefined, parts).format(date)
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date)
}

function formatParts(date, timeZone, opts) {
  const { twentyFourHour = true } = opts || {}
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !twentyFourHour,
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(date)
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  let hour = get('hour')
  const minute = get('minute')
  const period = get('dayPeriod')?.toUpperCase() || ''
  return { hour, minute, period }
}

export default memo(ClockWidget)
