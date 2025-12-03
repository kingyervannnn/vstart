import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { Cloud, Sun, CloudRain, CloudSnow } from 'lucide-react'

// Minimal, retro-futurist 7-day compact forecast (mock)
const ICONS = { sunny: Sun, cloudy: Cloud, rainy: CloudRain, snowy: CloudSnow }

function generateMockForecast() {
  const base = new Date()
  const conds = ['sunny', 'cloudy', 'rainy']
  const days = []
  for (let i = 1; i <= 7; i++) { // start from tomorrow
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const hi = Math.round(18 + 8 * Math.sin((i / 7) * Math.PI * 2))
    const lo = hi - Math.round(6 + (i % 3))
    const humidityMin = Math.max(20, Math.round(35 + (i % 3) * 4))
    const humidityMax = humidityMin + 18
    const wind = Math.round(10 + (i % 4) * 3)
    days.push({
      date: d,
      label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d),
      hi,
      lo,
      cond: conds[i % conds.length],
      humidityMin,
      humidityMax,
      wind,
      key: d.toISOString().split('T')[0]
    })
  }
  return days
}

function generateMockHourlyMap(units = 'metric') {
  const base = new Date()
  const map = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const key = d.toISOString().split('T')[0]
    map[key] = []
    for (let h = 0; h < 24; h += 6) {
      const temp = Math.round(18 + 6 * Math.sin(((i + h / 24) / 7) * Math.PI * 2))
      const humidity = Math.round(40 + ((i + h) % 4) * 6)
      const windMetric = Math.round(10 + ((i + h) % 5))
      const wind = units === 'imperial' ? Math.round(windMetric * 0.62) : windMetric
      const labelHour = ((h + 11) % 12) + 1
      const label = `${labelHour} ${h < 12 ? 'AM' : 'PM'}`
      map[key].push({
        hour: h,
        label,
        temp,
        humidity,
        wind
      })
    }
  }
  return map
}

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

const ensureForecastKeys = (list = []) => list.map((entry, idx) => {
  const hasDate = entry?.date instanceof Date && !Number.isNaN(entry.date.getTime())
  const derivedKey = entry?.key
    || (hasDate ? entry.date.toISOString().slice(0, 10) : null)
    || (entry?.label ? `${entry.label}-${idx}` : `day-${idx}`)
  if (entry?.key === derivedKey) return entry
  return { ...entry, key: derivedKey }
})

const roundMaybe = (value, fallback = undefined) => (Number.isFinite(value) ? Math.round(value) : fallback)

const WEATHER_DETAIL_PIN_KEY = 'vv-weather-detail-pin'
const WEATHER_DETAIL_SELECTED_KEY = 'vv-weather-detail-selected'

const WeatherWidget = ({ settings = { units: 'metric', layoutPreset: 'preset1', fontPreset: 'industrial', colorPrimary: '#ffffff', colorAccent: '#00ffff', p2OutlineWeek: true, p2ShadeWeek: false, removeOutlines: false, removeBackgrounds: false, verticalOffset: 0, showDetailsOnHover: true } }) => {
  const [coords, setCoords] = useState(null)
  const [current, setCurrent] = useState(null)
  const [forecast, setForecast] = useState([])
  const [hourlyMap, setHourlyMap] = useState({})
  const [selectedDayKey, setSelectedDayKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detailPinned, setDetailPinned] = useState(false)
  const [hoveredDayKey, setHoveredDayKey] = useState(null)
  const currentButtonRef = useRef(null)
  const dayButtonsRef = useRef(null)
  const detailPanelRef = useRef(null)

  useEffect(() => {
    let mounted = true
    const fallback = { lat: 48.2082, lon: 16.3738, name: 'Vienna' }
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!mounted) return
            setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
          },
          () => { if (mounted) setCoords(fallback) },
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
        )
      } else {
        setCoords(fallback)
      }
    } catch {
      setCoords(fallback)
    }
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function loadWeather() {
      if (!coords) return
      setLoading(true)
      setError(null)
      try {
        const units = settings.units === 'imperial' ? 'imperial' : 'metric'
        const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius'
        const windspeedUnit = units === 'imperial' ? 'mph' : 'kmh'
        const tz = 'auto'
        const url = `/openmeteo/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,relative_humidity_2m_min,relative_humidity_2m_max,wind_speed_10m_max&timezone=${tz}&temperature_unit=${tempUnit}&windspeed_unit=${windspeedUnit}`
        const omResp = await fetch(url, { signal: controller.signal })
        if (!omResp.ok) throw new Error(`Open-Meteo ${omResp.status}`)
        const om = await omResp.json()
        const parsedCurrent = normalizeOpenMeteoCurrent(om)
        const parsedForecast = normalizeOpenMeteoForecast(om)
        const parsedHourly = normalizeOpenMeteoHourly(om)
        if (!parsedCurrent?.name) parsedCurrent.name = coords?.name || 'Local'
        setCurrent(parsedCurrent)
        setForecast(ensureForecastKeys(parsedForecast || []))
        setHourlyMap(parsedHourly || {})
      } catch (e) {
        console.error('Weather fetch failed:', e)
        setError('Live weather unavailable; showing placeholder data')
        setCurrent({
          temp: 22,
          cond: 'sunny',
          name: coords?.name || 'Local',
          humidity: 52,
          wind: settings.units === 'imperial' ? 10 : 16,
          dateKey: new Date().toISOString().split('T')[0]
        })
        setForecast(ensureForecastKeys(generateMockForecast()))
        setHourlyMap(generateMockHourlyMap(settings.units))
      } finally {
        setLoading(false)
      }
    }
    loadWeather()
    return () => controller.abort()
  }, [coords, settings.units])

  const unitSymbol = settings.units === 'imperial' ? '°F' : '°C'
  const layoutPreset = (settings.layoutPreset || 'preset1').toLowerCase()
  const isPreset1 = layoutPreset === 'preset1'
  const isPreset2 = layoutPreset === 'preset2'
  const isPreset3 = layoutPreset === 'preset3'
  const removeOutlines = !!settings.removeOutlines
  const removeBackgrounds = !!settings.removeBackgrounds
  const isMirrored = !!settings.isMirrorLayout

  // Use theme tokens passed from App.jsx (already resolved through theme token resolver)
  // The resolvedWidgetsSettings contains the properly resolved font, primary, and accent colors
  const family = settings.resolvedFontFamily || 'Noto Sans JP, Inter, system-ui, sans-serif'
  const colorPrimary = sanitizeHex(settings.colorPrimary, '#ffffff')
  const colorAccent = sanitizeHex(settings.colorAccent, '#00ffff')
  const subtlePrimary = hexToRgba(colorPrimary, 0.75)
  const faintPrimary = hexToRgba(colorPrimary, 0.45)
  const borderColor = hexToRgba(colorPrimary, 0.2)
  const cardShadowSoft = hexToRgba(colorAccent, 0.28)
  const cardShadowStrong = hexToRgba(colorAccent, 0.4)
  const cardOutline = hexToRgba(colorPrimary, 0.08)
  const showOutlineWeek = settings.p2OutlineWeek && !removeOutlines
  const shadeWeekActive = settings.p2ShadeWeek && !removeBackgrounds
  const windUnitLabel = settings.units === 'imperial' ? 'mph' : 'km/h'
  const currentTempDisplay = current?.temp != null ? `${Math.round(current.temp)}${unitSymbol}` : '—'
  const currentCondKey = current?.cond
  const CurrentIcon = ICONS[currentCondKey] || Sun
  const preset2Days = forecast.slice(0, 6)
  const preset3Days = forecast.slice(0, 7)
  const interactivePresetActive = isPreset2 || isPreset3
  const explicitSelectedDay = selectedDayKey && selectedDayKey !== 'current'
    ? forecast.find(day => day?.key === selectedDayKey)
    : null
  const allowHoverDetails = settings.showDetailsOnHover !== false
  const hoverDetailKey = allowHoverDetails && !detailPinned ? hoveredDayKey : null
  const effectiveDetailKey = selectedDayKey || hoverDetailKey || null
  const effectiveForecastDay = effectiveDetailKey && effectiveDetailKey !== 'current'
    ? forecast.find(day => day?.key === effectiveDetailKey)
    : null
  const detailHourlyKey = !effectiveDetailKey
    ? null
    : effectiveDetailKey === 'current'
      ? current?.dateKey
      : effectiveDetailKey
  const detailHourlyEntries = detailHourlyKey ? hourlyMap?.[detailHourlyKey] : null
  const hourlyPreview = useMemo(() => buildHourlyPreview(detailHourlyEntries), [detailHourlyEntries])
  const detailTempText = !effectiveDetailKey
    ? '—'
    : effectiveDetailKey === 'current'
      ? currentTempDisplay
      : `${effectiveForecastDay?.hi ?? '—'}°/${effectiveForecastDay?.lo ?? '—'}°`
  const detailHumidityText = !effectiveDetailKey
    ? '—'
    : effectiveDetailKey === 'current'
      ? (current?.humidity != null ? `${Math.round(current.humidity)}%` : '—')
      : formatRange(effectiveForecastDay?.humidityMin, effectiveForecastDay?.humidityMax, '%')
  const detailWindValue = effectiveDetailKey === 'current' ? current?.wind : effectiveForecastDay?.wind
  const detailWindText = detailWindValue != null ? `${Math.round(detailWindValue)} ${windUnitLabel}` : '—'
  const detailCondText = !effectiveDetailKey
    ? '—'
    : effectiveDetailKey === 'current'
      ? `${current?.name || 'Local'} · ${current?.cond || '—'}`
      : `${effectiveForecastDay?.label || '—'} · ${effectiveForecastDay?.cond || '—'}`
  const showDetailsPanel = interactivePresetActive && !!effectiveDetailKey
  const isCurrentHighlighted = (selectedDayKey === 'current') || (hoveredDayKey === 'current')
  const currentTileBackground = isCurrentHighlighted
    ? hexToRgba(colorAccent, removeBackgrounds ? 0.18 : 0.18)
    : (removeBackgrounds ? 'transparent' : hexToRgba(colorPrimary, 0.04))
  const currentIconBackground = isCurrentHighlighted
    ? hexToRgba(colorPrimary, 0.2)
    : (removeBackgrounds ? 'transparent' : hexToRgba(colorPrimary, 0.1))

  const handleSelectDay = (key) => {
    setSelectedDayKey(prev => (prev === key ? null : key))
  }

  const toggleDetailPinned = () => {
    setDetailPinned(prev => {
      const next = !prev
      try {
        localStorage.setItem(WEATHER_DETAIL_PIN_KEY, next ? 'true' : 'false')
      } catch {}
      return next
    })
  }

  const handleHoverDay = (key) => setHoveredDayKey(key)
  const clearHoverDay = (key) => {
    setHoveredDayKey(prev => (prev === key ? null : prev))
  }

  const detailPanel = showDetailsPanel ? (
    <div
      ref={detailPanelRef}
      onDoubleClick={toggleDetailPinned}
      className={`rounded-lg border px-3 py-2 ${isMirrored ? 'text-right' : ''}`}
      style={{
        borderColor: showOutlineWeek ? borderColor : hexToRgba(colorPrimary, 0.12),
        backgroundColor: removeBackgrounds ? 'transparent' : hexToRgba(colorPrimary, 0.04)
      }}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-[10px] uppercase tracking-widest font-industrial-jp" style={{ color: subtlePrimary }}>
          Details{detailPinned ? ' · Pinned' : ''}
        </span>
        <span className="font-industrial-jp" style={{ color: colorPrimary }}>{detailCondText}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-xs font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: subtlePrimary }}>Temp</div>
          <div style={{ color: colorPrimary }}>{detailTempText}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: subtlePrimary }}>Humidity</div>
          <div style={{ color: colorPrimary }}>{detailHumidityText}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: subtlePrimary }}>Wind</div>
          <div style={{ color: colorPrimary }}>{detailWindText}</div>
        </div>
      </div>
      {!!hourlyPreview.length && (
        <div className="mt-2 grid gap-2 text-xs" style={{ gridTemplateColumns: `repeat(${hourlyPreview.length}, minmax(0, 1fr))` }}>
          {hourlyPreview.map((slot, idx) => (
            <div
              key={`${slot.hour ?? idx}-${idx}`}
              className="rounded-md border px-2 py-1"
              style={{
                borderColor: hexToRgba(colorPrimary, 0.12),
                backgroundColor: removeBackgrounds ? 'transparent' : hexToRgba(colorPrimary, 0.02)
              }}
            >
              <div className="text-[10px] uppercase tracking-widest font-industrial-jp" style={{ color: subtlePrimary }}>{slot.label}</div>
              <div className="text-sm font-industrial-jp" style={{ color: colorPrimary }}>{slot.temp != null ? `${slot.temp}°` : '—'}</div>
              <div className="text-[10px]" style={{ color: faintPrimary }}>
                {slot.wind != null ? `${slot.wind} ${windUnitLabel}` : '—'} · {slot.humidity != null ? `${slot.humidity}%` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  useEffect(() => {
    if (!selectedDayKey || selectedDayKey === 'current' || !forecast?.length) return
    const hasMatch = forecast.some(day => day?.key === selectedDayKey)
    if (!hasMatch) {
      setSelectedDayKey(null)
    }
  }, [forecast, selectedDayKey])

  useEffect(() => {
    if ((isPreset2 || isPreset3) || !selectedDayKey) return
    setSelectedDayKey(null)
  }, [isPreset2, isPreset3, selectedDayKey])

  useEffect(() => {
    if (!showDetailsPanel || !selectedDayKey) return
    const handlePointerDown = (event) => {
      const target = event.target
      if (
        (currentButtonRef.current && currentButtonRef.current.contains(target)) ||
        (dayButtonsRef.current && dayButtonsRef.current.contains(target)) ||
        (detailPanelRef.current && detailPanelRef.current.contains(target))
      ) {
        return
      }
      if (!detailPinned) {
        setSelectedDayKey(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [showDetailsPanel, detailPinned, selectedDayKey])

  useEffect(() => {
    try {
      const storedPin = localStorage.getItem(WEATHER_DETAIL_PIN_KEY)
      setDetailPinned(storedPin === 'true')
      const storedSelected = localStorage.getItem(WEATHER_DETAIL_SELECTED_KEY)
      if (storedSelected) {
        setSelectedDayKey(storedSelected)
      }
    } catch {
      setDetailPinned(false)
    }
  }, [])

  useEffect(() => {
    try {
      if (!interactivePresetActive || !detailPinned || !selectedDayKey) {
        localStorage.removeItem(WEATHER_DETAIL_SELECTED_KEY)
        return
      }
      localStorage.setItem(WEATHER_DETAIL_SELECTED_KEY, selectedDayKey)
    } catch {}
  }, [interactivePresetActive, detailPinned, selectedDayKey])

  useEffect(() => {
    if (isPreset2 || isPreset3) return
    setHoveredDayKey(null)
  }, [isPreset2, isPreset3])

  if (!current) {
    return <div className="text-xs" style={{ color: subtlePrimary }}>Loading weather…</div>
  }

  const rootStyle = isMirrored
    ? { fontFamily: family, color: colorPrimary, width: '100%', textAlign: 'right' }
    : { fontFamily: family, color: colorPrimary }

  return (
    <div className="p-0 select-none" style={{ ...rootStyle, transform: `translateY(${Number(settings.verticalOffset || 0)}px)` }}>
      {!isPreset2 && !isPreset3 && (
        <div className={`mb-2 flex items-end gap-3 ${isMirrored ? 'justify-end text-right' : ''}`}>
          <div className="text-3xl font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums', color: colorPrimary }}>
            {currentTempDisplay}
          </div>
          <div className="text-xs uppercase tracking-widest font-industrial-jp" style={{ color: subtlePrimary }}>
            {current.name || 'Local'} · {current.cond || '—'}
          </div>
        </div>
      )}

      {/* Forecast */}
      {isPreset1 && (
        <div>
          <div className={`mb-2 text-xs tracking-widest font-industrial-jp uppercase ${isMirrored ? 'text-right' : ''}`} style={{ color: colorAccent }}>7-Day Forecast</div>
          <div
            className={removeOutlines ? 'rounded-xl overflow-hidden' : 'border-y'}
            style={{
              borderColor,
              boxShadow: removeOutlines ? `0 16px 36px -26px ${cardShadowSoft}` : undefined,
              backgroundColor: removeOutlines && !removeBackgrounds ? hexToRgba(colorPrimary, 0.06) : 'transparent'
            }}
          >
            {forecast.map((d, idx) => {
              const Ico = ICONS[d.cond] || Sun
              const larger = idx === 0
              return (
                <div key={idx} className={`flex items-center ${larger ? 'py-2' : 'py-1.5'} gap-2 ${isMirrored ? 'justify-end text-right' : ''}`}>
                  <div className={`w-10 text-[11px] tracking-widest font-industrial-jp ${isMirrored ? 'text-right' : ''}`} style={{ color: colorAccent }}>{d.label}</div>
                  <div className={`${larger ? 'w-6 h-6' : 'w-5 h-5'}`} style={{ color: colorAccent }}><Ico className={`${larger ? 'w-6 h-6' : 'w-5 h-5'}`} /></div>
                  <div className={`${isMirrored ? '' : 'ml-auto'} flex items-center gap-3 font-industrial-jp`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span className={`${larger ? 'text-base' : 'text-sm'}`} style={{ color: colorPrimary }}>{d.hi}°</span>
                    <span className={`${larger ? 'text-base' : 'text-sm'}`} style={{ color: faintPrimary }}>{d.lo}°</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {isPreset2 && (
        <div className={`space-y-2 ${isMirrored ? 'text-right' : ''}`}>
          <button
            ref={currentButtonRef}
            type="button"
            onClick={() => handleSelectDay('current')}
            onMouseEnter={() => handleHoverDay('current')}
            onMouseLeave={() => clearHoverDay('current')}
            aria-pressed={selectedDayKey === 'current'}
            className={`w-full rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-left transition-all ${removeOutlines ? '' : 'border'}`}
            style={{
              borderColor: removeOutlines ? 'transparent' : borderColor,
              background: currentTileBackground,
              boxShadow: selectedDayKey === 'current'
                ? `0 18px 36px -24px ${cardShadowStrong}`
                : `0 12px 28px -26px ${cardShadowSoft}`
            }}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-widest font-industrial-jp" style={{ color: subtlePrimary }}>Current</span>
              <span className="text-sm font-medium leading-tight" style={{ color: colorPrimary }}>{current.name || 'Local'}</span>
              <span className="text-xs" style={{ color: subtlePrimary }}>{current.cond || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="rounded-full p-2"
                style={{
                  background: currentIconBackground,
                  color: isCurrentHighlighted ? colorPrimary : colorAccent
                }}
              >
                <CurrentIcon className="w-5 h-5" />
              </div>
              <div className="text-3xl font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums', color: colorPrimary }}>
                {currentTempDisplay}
              </div>
            </div>
          </button>
          <div
            ref={dayButtonsRef}
            className="grid gap-1 rounded-lg"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, preset2Days.length)}, minmax(0, 1fr))`,
              border: showOutlineWeek ? `1px solid ${borderColor}` : 'none',
              backgroundColor: shadeWeekActive ? hexToRgba(colorAccent, 0.08) : 'transparent',
              boxShadow: settings.p2OutlineWeek && removeOutlines ? `0 18px 38px -24px ${cardShadowSoft}` : 'none',
              padding: removeOutlines ? '6px' : '2px'
            }}
          >
            {preset2Days.map((d) => {
              const Ico = ICONS[d.cond] || Sun
              const dayKey = d.key
              const selected = selectedDayKey === dayKey
              const hovered = hoveredDayKey === dayKey
              const isHighlighted = selected || hovered
              const buttonBackground = isHighlighted
                ? hexToRgba(colorAccent, removeBackgrounds ? 0.18 : 0.15)
                : 'transparent'
              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => handleSelectDay(dayKey)}
                  onMouseEnter={() => handleHoverDay(dayKey)}
                  onMouseLeave={() => clearHoverDay(dayKey)}
                  aria-pressed={selected}
                  className={`flex flex-col items-center justify-center rounded-md px-2 py-2 text-center transition-colors focus-visible:outline-none ${isMirrored ? 'text-right' : ''}`}
                  style={{
                    background: buttonBackground,
                    boxShadow: selected ? `0 12px 28px -24px ${cardShadowStrong}` : 'none',
                    border: removeOutlines ? 'none' : `1px solid ${hexToRgba(colorPrimary, isHighlighted ? 0.35 : 0.12)}`
                  }}
                >
                  <span className="text-[9px] tracking-widest font-industrial-jp" style={{ color: isHighlighted ? colorPrimary : colorAccent }}>{d.label}</span>
                  <Ico className="w-4 h-4 my-1" style={{ color: isHighlighted ? colorPrimary : colorAccent }} />
                  <span className="text-[10px] font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums', color: colorPrimary }}>
                    {d.hi}°/<span style={{ color: faintPrimary }}>{d.lo}°</span>
                  </span>
                </button>
              )
            })}
          </div>
          {detailPanel}
        </div>
      )}

      {isPreset3 && (
        <div className={`space-y-2 ${isMirrored ? 'text-right' : ''}`}>
          <button
            ref={currentButtonRef}
            type="button"
            onClick={() => handleSelectDay('current')}
            onMouseEnter={() => handleHoverDay('current')}
            onMouseLeave={() => clearHoverDay('current')}
            aria-pressed={selectedDayKey === 'current'}
            className={`w-full rounded-xl px-3 py-3 flex flex-col gap-3 text-left transition-all ${removeOutlines ? '' : 'border'}`}
            style={{
              borderColor: removeOutlines ? 'transparent' : borderColor,
              background: currentTileBackground,
              boxShadow: 'none'
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-widest font-industrial-jp" style={{ color: subtlePrimary }}>Current</span>
                <div className="text-4xl font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums', color: colorPrimary }}>
                  {currentTempDisplay}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col text-right">
                  <span className="text-sm font-medium" style={{ color: colorPrimary }}>{current.name || 'Local'}</span>
                  <span className="text-xs" style={{ color: subtlePrimary }}>{current.cond || '—'}</span>
                </div>
                <div
                  className="rounded-full p-2"
                  style={{
                    background: currentIconBackground,
                    color: isCurrentHighlighted ? colorPrimary : colorAccent
                  }}
                >
                  <CurrentIcon className="w-5 h-5" />
                </div>
              </div>
            </div>
          </button>
          <div
            ref={dayButtonsRef}
            className="grid gap-1 rounded-lg"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, preset3Days.length)}, minmax(0, 1fr))`,
              border: showOutlineWeek ? `1px solid ${borderColor}` : 'none',
              backgroundColor: shadeWeekActive ? hexToRgba(colorAccent, 0.08) : 'transparent',
              boxShadow: 'none',
              padding: removeOutlines ? '4px' : '2px'
            }}
          >
            {preset3Days.map((d) => {
              const Ico = ICONS[d.cond] || Sun
              const dayKey = d.key
              const selected = selectedDayKey === dayKey
              const hovered = hoveredDayKey === dayKey
              const isHighlighted = selected || hovered
              const buttonBackground = isHighlighted
                ? hexToRgba(colorAccent, removeBackgrounds ? 0.16 : 0.12)
                : 'transparent'
              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => handleSelectDay(dayKey)}
                  onMouseEnter={() => handleHoverDay(dayKey)}
                  onMouseLeave={() => clearHoverDay(dayKey)}
                  aria-pressed={selected}
                  className={`flex flex-col items-center justify-center rounded-md px-1.5 py-1.5 text-center transition-colors focus-visible:outline-none ${isMirrored ? 'text-right' : ''}`}
                  style={{
                    background: buttonBackground,
                    boxShadow: 'none',
                    border: removeOutlines ? 'none' : `1px solid ${hexToRgba(colorPrimary, isHighlighted ? 0.35 : 0.12)}`
                  }}
                >
                  <span className="text-[9px] tracking-widest font-industrial-jp" style={{ color: isHighlighted ? colorPrimary : colorAccent }}>{d.label}</span>
                  <Ico className="w-3.5 h-3.5 my-1" style={{ color: isHighlighted ? colorPrimary : colorAccent }} />
                  <span className="text-[9px] font-industrial-jp" style={{ fontVariantNumeric: 'tabular-nums', color: colorPrimary }}>
                    {d.hi}°/<span style={{ color: faintPrimary }}>{d.lo}°</span>
                  </span>
                </button>
              )
            })}
          </div>
          {detailPanel}
        </div>
      )}
      {loading && <div className="mt-2 text-[11px]" style={{ color: faintPrimary }}>Updating…</div>}
      {error && <div className="mt-2 text-red-400 text-xs">{error}</div>}
    </div>
  )
}

function normalizeCurrent(data) {
  try {
    if (!data) return null
    const fallbackDateKey = new Date().toISOString().slice(0, 10)
    if (data?.main?.temp != null) {
      const derivedDateKey = data?.dt ? new Date(data.dt * 1000).toISOString().slice(0, 10) : fallbackDateKey
      return {
        temp: data.main.temp,
        cond: data.weather?.[0]?.main?.toLowerCase() || '',
        name: data.name || '',
        humidity: roundMaybe(data.main?.humidity),
        wind: roundMaybe(data.wind?.speed),
        dateKey: derivedDateKey
      }
    }
    if (data?.temp != null) {
      const rawDate = data?.date instanceof Date ? data.date : null
      const derivedDateKey = data?.dateKey || (rawDate ? rawDate.toISOString().slice(0, 10) : fallbackDateKey)
      return {
        temp: data.temp,
        cond: data.condition || '',
        name: data.name || '',
        humidity: roundMaybe(data.humidity),
        wind: roundMaybe(data.wind),
        dateKey: derivedDateKey
      }
    }
  } catch {}
  return null
}

function normalizeForecast(data) {
  try {
    if (!data) return null
    const daily = Array.isArray(data.daily) ? data.daily : Array.isArray(data) ? data : []
    const days = daily.slice(0, 7).map((d, i) => {
      const date = d.dt ? new Date(d.dt * 1000) : new Date(Date.now() + i * 86400000)
      const hi = roundMaybe(d.temp?.max ?? d.hi ?? 20, 20)
      const lo = roundMaybe(d.temp?.min ?? d.lo ?? 12, 12)
      const cond = (d.weather?.[0]?.main || d.cond || 'sunny').toLowerCase()
      const key = d.key
        || (d.dt ? new Date(d.dt * 1000).toISOString().slice(0, 10) : date.toISOString().slice(0, 10))
      return {
        date,
        label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date),
        hi,
        lo,
        cond,
        humidityMin: roundMaybe(d.humidity?.min ?? d.humidityMin),
        humidityMax: roundMaybe(d.humidity?.max ?? d.humidityMax),
        wind: roundMaybe(d.wind?.max ?? d.wind),
        key
      }
    })
    return days
  } catch {}
  return null
}

// Open-Meteo normalization
function omCodeToCond(code) {
  // Simplified mapping
  if (code === 0) return 'sunny'
  if ([1,2,3,45,48].includes(code)) return 'cloudy'
  if ([51,53,55,56,57,61,63,65,80,81,82].includes(code)) return 'rainy'
  if ([71,73,75,77,85,86].includes(code)) return 'snowy'
  if ([95,96,99].includes(code)) return 'rainy'
  return 'cloudy'
}

function normalizeOpenMeteoCurrent(om) {
  try {
    const current = om?.current
    if (!current) return null
    const temp = current.temperature_2m
    const code = current.weather_code
    const time = current.time || new Date().toISOString()
    return {
      temp,
      cond: omCodeToCond(code),
      name: '',
      humidity: roundMaybe(current.relative_humidity_2m),
      wind: roundMaybe(current.wind_speed_10m),
      dateKey: time.slice(0, 10)
    }
  } catch { return null }
}

function normalizeOpenMeteoForecast(om) {
  try {
    const daily = om?.daily
    if (!daily) return null
    const times = daily.time || []
    const today = new Date()
    today.setHours(0,0,0,0)
    const startIdx = times.findIndex(t => {
      const d = new Date(t)
      d.setHours(0,0,0,0)
      return d.getTime() > today.getTime()
    })
    const start = startIdx === -1 ? 0 : startIdx
    const len = Math.max(0, Math.min(7, times.length - start))
    const days = []
    for (let i = 0; i < len; i++) {
      const idx = start + i
      const iso = times[idx]
      if (!iso) continue
      const date = new Date(iso)
      const hi = roundMaybe(daily.temperature_2m_max?.[idx], 20)
      const lo = roundMaybe(daily.temperature_2m_min?.[idx], 12)
      const cond = omCodeToCond(daily.weather_code?.[idx])
      days.push({
        date,
        label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date),
        hi,
        lo,
        cond,
        humidityMin: roundMaybe(daily.relative_humidity_2m_min?.[idx]),
        humidityMax: roundMaybe(daily.relative_humidity_2m_max?.[idx]),
        wind: roundMaybe(daily.wind_speed_10m_max?.[idx]),
        key: iso.slice(0, 10)
      })
    }
    return days
  } catch { return null }
}

function normalizeOpenMeteoHourly(om) {
  try {
    const hourly = om?.hourly
    if (!hourly?.time?.length) return null
    const map = {}
    hourly.time.forEach((timestamp, idx) => {
      if (!timestamp) return
      const key = timestamp.slice(0, 10)
      if (!key) return
      const dt = new Date(timestamp)
      const hour = Number.isFinite(dt.getTime()) ? dt.getHours() : undefined
      const label = Number.isFinite(dt.getTime())
        ? new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(dt)
        : timestamp.slice(11, 16)
      const entry = {
        hour,
        label,
        temp: roundMaybe(hourly.temperature_2m?.[idx]),
        humidity: roundMaybe(hourly.relative_humidity_2m?.[idx]),
        wind: roundMaybe(hourly.wind_speed_10m?.[idx])
      }
      if (!map[key]) map[key] = []
      map[key].push(entry)
    })
    Object.keys(map).forEach(k => {
      map[k].sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0))
    })
    return map
  } catch { return null }
}

function buildHourlyPreview(entries) {
  if (!Array.isArray(entries) || !entries.length) return []
  const sorted = [...entries].sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0))
  const targets = [6, 12, 18, 0]
  const used = new Set()
  const preview = []
  targets.forEach(target => {
    let best = null
    let bestDiff = Infinity
    sorted.forEach(entry => {
      if (entry.hour == null || used.has(entry.hour)) return
      const diff = Math.abs(entry.hour - target)
      if (diff < bestDiff) {
        best = entry
        bestDiff = diff
      }
    })
    if (best) {
      preview.push(best)
      used.add(best.hour)
    }
  })
  if (!preview.length) {
    return sorted.slice(0, Math.min(4, sorted.length))
  }
  return preview
}

function formatRange(min, max, suffix = '', fallback = '—') {
  const hasMin = Number.isFinite(min)
  const hasMax = Number.isFinite(max)
  if (!hasMin && !hasMax) return fallback
  if (hasMin && hasMax && Math.round(min) !== Math.round(max)) {
    return `${Math.round(min)}–${Math.round(max)}${suffix}`
  }
  const value = hasMax ? max : min
  return `${Math.round(value)}${suffix}`
}

export default memo(WeatherWidget)
