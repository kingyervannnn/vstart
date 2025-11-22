// Minimal IndexedDB helper for storing large background images as Blobs

const DB_NAME = 'vivaldi-startpage-db'
const DB_VERSION = 1
const STORE = 'backgrounds'

// In-memory fallback if IndexedDB is unavailable (e.g., private mode restrictions)
const memoryStore = new Map()
let useMemory = false

function openDB() {
  if (typeof indexedDB === 'undefined') {
    useMemory = true
    return Promise.reject(new Error('IndexedDB not available'))
  }
  return new Promise((resolve, reject) => {
    let request
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      useMemory = true
      return reject(e)
    }
    request.onerror = () => {
      useMemory = true
      reject(request.error)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

export async function saveBackgroundFile(file) {
  const id = Date.now().toString()
  const record = {
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: Date.now(),
    blob: file
  }
  if (useMemory) {
    memoryStore.set(id, record)
    return record
  }
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE).put(record)
    })
    return record
  } catch (e) {
    // Fallback to memory if IDB fails mid-flight
    useMemory = true
    memoryStore.set(id, record)
    return record
  }
}

export async function listBackgrounds() {
  if (useMemory) {
    return Array.from(memoryStore.values()).map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      size: r.size,
      createdAt: r.createdAt,
      url: URL.createObjectURL(r.blob)
    }))
  }
  try {
    const db = await openDB()
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    return records.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      size: r.size,
      createdAt: r.createdAt,
      url: URL.createObjectURL(r.blob)
    }))
  } catch (e) {
    useMemory = true
    return []
  }
}

export async function getBackgroundURLById(id) {
  if (useMemory) {
    const r = memoryStore.get(id)
    return r ? URL.createObjectURL(r.blob) : null
  }
  try {
    const db = await openDB()
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    if (!record) return null
    return URL.createObjectURL(record.blob)
  } catch (e) {
    useMemory = true
    const r = memoryStore.get(id)
    return r ? URL.createObjectURL(r.blob) : null
  }
}

export async function deleteBackground(id) {
  if (useMemory) {
    memoryStore.delete(id)
    return
  }
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE).delete(id)
    })
  } catch (e) {
    useMemory = true
    memoryStore.delete(id)
  }
}

export function isUsingMemoryStore() {
  return useMemory
}
