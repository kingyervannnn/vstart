// Simple STT transcriber using local Whisper ASR service

async function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctl = new AbortController()
  const id = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal })
    return r
  } finally {
    clearTimeout(id)
  }
}

export async function transcribeAudioBlob(blob, { mime = 'audio/webm' } = {}) {
  // Vite/ESM-safe dev flag without referencing the reserved "import" identifier
  const DEV = (typeof import.meta !== 'undefined') && import.meta.env && import.meta.env.DEV
  try {
    // Build the STT endpoint URL
    const url = '/stt/asr?task=transcribe&language=en'
    
    DEV && console.log('STT Request:', {
      url,
      blobSize: blob.size,
      blobType: blob.type,
      mime
    })
    
    // Create form data with the audio file
    const form = new FormData()
    const filename = (() => {
      const m = String(mime || '').toLowerCase()
      if (m.includes('wav')) return 'recording.wav'
      if (m.includes('ogg')) return 'recording.ogg'
      if (m.includes('mp4') || m.includes('m4a')) return 'recording.m4a'
      return 'recording.webm'
    })()
    form.append('audio_file', blob, filename)
    
    DEV && console.log('Uploading as filename:', filename)
    
    // Send the request
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      body: form
    }, 30000)
    
    DEV && console.log('STT Response status:', resp.status, 'Content-Type:', resp.headers.get('content-type'))
    
    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '')
      console.error('STT Error response:', errorText)
      throw new Error(`STT HTTP ${resp.status}`)
    }
    
    // Parse the response
    const contentType = resp.headers.get('content-type') || ''
    const responseText = await resp.text()
    DEV && console.log('STT Raw response:', responseText)
    
    let result
    
    // Check if response is JSON or plain text
    if (contentType.includes('application/json')) {
      // JSON response
      const json = JSON.parse(responseText)
      DEV && console.log('STT Parsed JSON:', json)
      result = { 
        text: String(json?.text || ''), 
        language: json?.language || 'en' 
      }
    } else {
      // Plain text response (fast-whisper returns text/plain)
      DEV && console.log('STT Plain text response detected')
      result = {
        text: responseText.trim(),
        language: 'en'
      }
    }
    
    DEV && console.log('STT Final result:', result)
    
    // If empty text, log warning
    if (!result.text || !result.text.trim()) {
      if (DEV) {
        console.warn('STT returned empty text. This could mean:')
        console.warn('1. No speech was detected in the audio')
        console.warn('2. Audio format is not compatible with fast-whisper')
        console.warn('3. Audio duration is too short')
        console.warn('4. Fast-whisper model issue')
      }
    }
    
    return result
  } catch (err) {
    console.error('Transcription error:', err)
    return { text: '', language: 'en' }
  }
}
