import { useEffect, useRef, useState, memo } from 'react'

const BackgroundRenderer = ({
  src,
  placeholderSrc = null,
  mode = 'cover',
  zoom = 1,
  alt = 'Background',
  deferLoad = false,
  deferDelay = 300
}) => {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [shouldRenderAsset, setShouldRenderAsset] = useState(!deferLoad)
  const idleHandleRef = useRef(null)
  const timeoutHandleRef = useRef(null)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  useEffect(() => {
    if (!deferLoad) {
      setShouldRenderAsset(true)
      return
    }

    setShouldRenderAsset(false)
    setLoaded(false)
    setFailed(false)

    let cancelled = false

    const enable = () => {
      if (!cancelled) {
        setShouldRenderAsset(true)
      }
    }

    if (typeof window !== 'undefined') {
      if (typeof window.requestIdleCallback === 'function') {
        idleHandleRef.current = window.requestIdleCallback(enable, { timeout: Math.max(500, deferDelay * 2) })
      } else {
        timeoutHandleRef.current = window.setTimeout(enable, deferDelay)
      }
    } else {
      enable()
    }

    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        if (idleHandleRef.current !== null && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleHandleRef.current)
        }
        if (timeoutHandleRef.current !== null) {
          window.clearTimeout(timeoutHandleRef.current)
        }
      }
      idleHandleRef.current = null
      timeoutHandleRef.current = null
    }
  }, [src, deferLoad, deferDelay])

  const objectFit = mode === 'contain' ? 'contain' : 'cover'
  const transformValue = `scale(${zoom || 1})`

  if (mode === 'tile') {
    return (
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${src})`,
          backgroundRepeat: 'repeat',
          // Scale tiles relative to container; not exact natural-size scaling
          backgroundSize: `${Math.max(1, zoom) * 100}% auto`,
          backgroundPosition: 'top left'
        }}
      />
    )
  }

  return (
    <div className="absolute inset-0">
      {placeholderSrc && (!loaded || failed) && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="eager"
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${loaded && !failed ? 'opacity-0' : 'opacity-100'}`}
          style={{
            objectFit,
            transform: transformValue,
            transformOrigin: 'center center',
            imageRendering: 'auto',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
          draggable={false}
        />
      )}
      {!placeholderSrc && !loaded && !failed && <div className="absolute inset-0 bg-black" />}
      {shouldRenderAsset && (
        <img
          src={src}
          alt={alt}
          decoding="async"
          loading={deferLoad ? 'lazy' : 'eager'}
          fetchpriority={deferLoad ? 'low' : 'high'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`w-full h-full transition-opacity duration-500 ${loaded && !failed ? 'opacity-100' : 'opacity-0'}`}
          style={{ 
            willChange: 'opacity, transform', 
            objectFit,
            transform: transformValue,
            transformOrigin: 'center center',
            imageRendering: 'auto'
          }}
        />
      )}
    </div>
  )
}

export default memo(BackgroundRenderer)
