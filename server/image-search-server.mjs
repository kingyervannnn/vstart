import http from 'node:http'
import { createWriteStream } from 'node:fs'
import { unlink, mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'

const PORT = process.env.IMAGE_SEARCH_PORT ? Number(process.env.IMAGE_SEARCH_PORT) : 3300
const LENS_UPLOAD_DIR = process.env.LENS_UPLOAD_DIR || join(tmpdir(), 'lens-uploads')

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, x-api-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers,
  })
  res.end(payload)
}

async function parseMultipartFormData(req) {
  const chunks = []
  let totalSize = 0
  const MAX_SIZE = 50 * 1024 * 1024 // 50MB limit
  
  for await (const chunk of req) {
    totalSize += chunk.length
    if (totalSize > MAX_SIZE) {
      throw new Error('Request body too large. Maximum size is 50MB.')
    }
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)
  
  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=([^;]+)/)
  if (!boundaryMatch) {
    throw new Error('No boundary found in Content-Type')
  }
  
  const boundary = `--${boundaryMatch[1]}`
  const boundaryBuffer = Buffer.from(boundary)
  const parts = []
  let start = 0
  
  while (true) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start)
    if (boundaryIndex === -1) break
    
    const nextBoundary = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length)
    if (nextBoundary === -1) break
    
    const partBuffer = buffer.slice(boundaryIndex + boundaryBuffer.length, nextBoundary)
    const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd === -1) {
      start = nextBoundary
      continue
    }
    
    const headers = partBuffer.slice(0, headerEnd).toString('utf8')
    const body = partBuffer.slice(headerEnd + 4)
    
    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i)
    
    if (nameMatch) {
      const name = nameMatch[1]
      if (filenameMatch) {
        const filename = filenameMatch[1]
        const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream'
        const tempPath = join(tmpdir(), `img-${randomBytes(8).toString('hex')}-${filename}`)
        
        await new Promise((resolveWrite, rejectWrite) => {
          const stream = createWriteStream(tempPath)
          stream.write(body)
          stream.end()
          stream.on('finish', () => resolveWrite())
          stream.on('error', rejectWrite)
        })
        
        parts.push({
          name: `${name}_file`,
          file: {
            path: tempPath,
            filename,
            contentType,
            size: body.length,
          },
        })
      } else {
        const value = body.toString('utf8').trim()
        parts.push({ name, value })
      }
    }
    
    start = nextBoundary
  }
  
  return parts
}

// Removed OpenWeb Ninja, Yandex, and TinEye functions - no longer used
// Only SearXNG and Google Lens (via ImgBB) are supported now


const server = http.createServer(async (req, res) => {
  try {
    // Handle requests without Host header (e.g., from proxy)
    const host = req.headers.host || 'localhost:3300'
    const url = new URL(req.url, `http://${host}`)
    const path = url.pathname
    
    console.log(`[${req.method}] ${path}`)
    
    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }
    
    if (req.method === 'GET' && (path === '/image-search/health' || path === '/health')) {
      send(res, 200, { ok: true, service: 'image-search' })
      return
    }
    
    // ImgBB API key validation endpoint
    if (req.method === 'POST' && (path === '/image-search/validate-imgbb-key' || path === '/validate-imgbb-key')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const obj = JSON.parse(body || '{}')
          const apiKey = String(obj.apiKey || '').trim()
          
          if (!apiKey) {
            send(res, 400, { valid: false, error: 'No API key provided' })
            return
          }
          
          // Test by uploading a tiny 1x1 transparent PNG
          const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          
          try {
            // Use URLSearchParams for simpler form encoding
            const params = new URLSearchParams()
            params.append('key', apiKey)
            params.append('image', testImageBase64)
            
            const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params.toString(),
            })
            
            if (imgbbResponse.ok) {
              const result = await imgbbResponse.json()
              if (result.success && result.data && result.data.url) {
                send(res, 200, { valid: true, message: 'API key is valid' })
                return
              }
            }
            
            const errorText = await imgbbResponse.text()
            send(res, 200, { valid: false, error: `imgbb API error: ${imgbbResponse.status}`, details: errorText.substring(0, 200) })
          } catch (e) {
            send(res, 500, { valid: false, error: e.message })
          }
        } catch (error) {
          send(res, 500, { valid: false, error: error.message })
        }
      })
      
      req.on('error', (error) => {
        if (!res.headersSent) {
          send(res, 400, { valid: false, error: error.message })
        }
      })
      return
    }
    
    // Google Lens upload endpoint - uploads to free image hosting and returns public URL
    // Accept both /upload-for-lens and /image-search/upload-for-lens
    if (req.method === 'POST' && (path === '/upload-for-lens' || path === '/image-search/upload-for-lens' || path.endsWith('/upload-for-lens'))) {
      console.log('✅ Handling upload-for-lens request, path:', path, 'method:', req.method)
      try {
        const parts = await parseMultipartFormData(req)
        let imageFile = null
        let imgbbApiKey = null
        
        for (const part of parts) {
          if (part.file) {
            imageFile = part.file
          } else if (part.name === 'imgbbApiKey' && part.value) {
            imgbbApiKey = String(part.value).trim()
          }
        }
        
        if (!imageFile) {
          send(res, 400, { success: false, error: 'No image file provided' })
          return
        }
        
        // Store API key in request object for use in upload function
        req.imgbbApiKey = imgbbApiKey
        
        // Read the image file
        const imageBuffer = await fs.readFile(imageFile.path)
        const base64Image = imageBuffer.toString('base64')
        
        // Try to upload to free image hosting services
        let publicUrl = null
        let lastError = null
        
        // Method 1: Try imgbb.com (requires free API key)
        // Check request body first, then environment variable
        const finalImgbbApiKey = (imgbbApiKey && imgbbApiKey.length > 0) ? imgbbApiKey : (process.env.IMGBB_API_KEY || '')
        console.log('ImgBB API key check:', { hasKey: !!finalImgbbApiKey, keyLength: finalImgbbApiKey ? finalImgbbApiKey.length : 0, fromRequest: !!imgbbApiKey, fromEnv: !!process.env.IMGBB_API_KEY })
        
        if (finalImgbbApiKey) {
          try {
            // imgbb API expects form data with 'image' field containing base64 string
            // Use URLSearchParams for simpler form encoding
            const params = new URLSearchParams()
            params.append('key', finalImgbbApiKey)
            params.append('image', base64Image)
            
            console.log('Uploading to imgbb, image size:', Math.round(base64Image.length / 1024), 'KB (base64), key length:', finalImgbbApiKey.length)
            
            const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params.toString(),
            })
            
            console.log('imgbb response status:', imgbbResponse.status)
            
            if (imgbbResponse.ok) {
              const imgbbData = await imgbbResponse.json()
              console.log('imgbb response data:', JSON.stringify(imgbbData).substring(0, 200))
              
              if (imgbbData.success && imgbbData.data && imgbbData.data.url) {
                publicUrl = imgbbData.data.url
                console.log('✅ Image uploaded to imgbb:', publicUrl)
              } else {
                console.warn('imgbb upload response missing URL:', imgbbData)
                lastError = imgbbData.error?.message || 'imgbb returned success but no URL'
              }
            } else {
              const errorText = await imgbbResponse.text()
              console.error('❌ imgbb upload failed:', imgbbResponse.status, errorText.substring(0, 500))
              lastError = `imgbb API error: ${imgbbResponse.status} - ${errorText.substring(0, 200)}`
            }
          } catch (e) {
            lastError = e.message
            console.error('❌ imgbb upload exception:', e.message, e.stack)
          }
        } else {
          console.warn('No ImgBB API key provided (neither in request nor environment)')
        }
        
        // Clean up temporary file
        try {
          await unlink(imageFile.path)
        } catch {}
        
        // Method 2: Fallback to local storage (but this won't work with Google Lens due to localhost)
        if (!publicUrl) {
          console.warn('No public URL obtained, falling back to local storage')
          // Save locally as fallback (though Google Lens can't access localhost)
          await fs.mkdir(LENS_UPLOAD_DIR, { recursive: true })
          const timestamp = Date.now()
          const random = randomBytes(8).toString('hex')
          const ext = imageFile.filename?.split('.').pop() || 'jpg'
          const fileName = `lens-${timestamp}-${random}.${ext}`
          const filePath = join(LENS_UPLOAD_DIR, fileName)
          await fs.writeFile(filePath, imageBuffer)
          const localUrl = `/lens-image/${fileName}`
          
          // Return local URL with warning
          send(res, 200, { 
            success: true, 
            url: localUrl,
            fileName,
            warning: 'Local URL - Google Lens cannot access localhost. Consider setting IMGBB_API_KEY environment variable for public hosting.',
            needsPublicUrl: true
          })
          return
        }
        
        // Return public URL
        if (publicUrl) {
          console.log('✅ Returning public URL to client:', publicUrl)
          send(res, 200, { 
            success: true, 
            url: publicUrl,
            public: true
          })
        } else {
          // This shouldn't happen if we got here, but just in case
          send(res, 500, { 
            success: false, 
            error: lastError || 'Failed to upload image to public hosting',
            needsPublicUrl: true
          })
        }
      } catch (error) {
        send(res, 500, { success: false, error: error.message })
      }
      return
    }
    
    // Serve uploaded lens images
    if (req.method === 'GET' && (path.startsWith('/lens-image/') || path.startsWith('/image-search/lens-image/'))) {
      try {
        const fileName = path.replace(/^\/image-search\/lens-image\//, '').replace(/^\/lens-image\//, '')
        // Sanitize filename to prevent directory traversal
        if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
          send(res, 400, 'Invalid filename')
          return
        }
        
        const filePath = join(LENS_UPLOAD_DIR, fileName)
        
        // Check if file exists
        try {
          await fs.access(filePath)
        } catch {
          send(res, 404, 'File not found')
          return
        }
        
        // Read and serve file
        const imageBuffer = await fs.readFile(filePath)
        const ext = fileName.split('.').pop()?.toLowerCase()
        const mimeTypes = {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'gif': 'image/gif',
          'webp': 'image/webp',
        }
        const contentType = mimeTypes[ext] || 'image/jpeg'
        
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': imageBuffer.length,
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          'Access-Control-Allow-Origin': '*',
        })
        res.end(imageBuffer)
      } catch (error) {
        send(res, 500, { error: error.message })
      }
      return
    }
    
    if (req.method === 'POST' && (path === '/image-search/search' || path === '/search')) {
      try {
        const parts = await parseMultipartFormData(req)
        const fields = {}
        let imageFile = null
        
        for (const part of parts) {
          if (part.file) {
            imageFile = part.file
          } else if (part.name && part.value !== undefined) {
            fields[part.name] = part.value
          }
        }
        
        if (!imageFile) {
          send(res, 400, { success: false, error: 'No image file provided' })
          return
        }
        
        // This endpoint is no longer used - SearXNG and Google Lens are handled client-side
        send(res, 400, { success: false, error: 'This endpoint is deprecated. Use SearXNG or Google Lens instead.' })
        return
      } catch (error) {
        send(res, 500, { success: false, error: error.message })
      }
      return
    }
    
    // Log unmatched requests for debugging
    console.log(`❌ Unmatched request: ${req.method} ${path}`)
    send(res, 404, { error: 'Not found', path, method: req.method })
  } catch (error) {
    console.error('Server error:', error)
    send(res, 500, { error: error.message || 'Server error' })
  }
})

server.listen(PORT, () => {
  console.log(`image-search-server listening on :${PORT}`)
})
