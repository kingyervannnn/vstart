const NOTES_BASE = '/notes/api/v1'

async function safeFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
    if (!res.ok) {
      console.warn('notes-sync: non-OK response', url, res.status)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn('notes-sync: request failed', url, err)
    return null
  }
}

export async function loadNotesFromVault(vaultId) {
  if (!vaultId) return null
  const encVault = encodeURIComponent(vaultId)
  const data = await safeFetch(`${NOTES_BASE}/vault/${encVault}/notes`)
  if (!data || !Array.isArray(data.notes)) return null
  return data.notes
}

export async function saveNoteToVault(vaultId, note) {
  if (!vaultId || !note?.id) return
  const encVault = encodeURIComponent(vaultId)
  const encId = encodeURIComponent(note.id)
  const payload = {
    id: note.id,
    title: note.title || '',
    content: note.content || '',
    workspaceId: note.workspaceId || null,
  }
  if (note.folder) {
    payload.folder = note.folder
  }
  await safeFetch(`${NOTES_BASE}/vault/${encVault}/notes/${encId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteNoteFromVault(vaultId, noteId, folder = '') {
  if (!vaultId || !noteId) return
  const encVault = encodeURIComponent(vaultId)
  const encId = encodeURIComponent(noteId)
  const params = folder ? `?folder=${encodeURIComponent(folder)}` : ''
  await safeFetch(`${NOTES_BASE}/vault/${encVault}/notes/${encId}${params}`, {
    method: 'DELETE',
  })
}

export async function ensureVaultFolders(folders) {
  if (!Array.isArray(folders) || !folders.length) return
  const cleaned = folders
    .map((f) => String(f || '').trim())
    .filter((f) => !!f)
  if (!cleaned.length) return
  await safeFetch(`${NOTES_BASE}/folders`, {
    method: 'POST',
    body: JSON.stringify({ folders: cleaned }),
  })
}

export async function deleteVaultFolders(folders) {
  if (!Array.isArray(folders) || !folders.length) return
  const cleaned = folders
    .map((f) => String(f || '').trim())
    .filter((f) => !!f)
  if (!cleaned.length) return
  await safeFetch(`${NOTES_BASE}/folders/delete`, {
    method: 'POST',
    body: JSON.stringify({ folders: cleaned }),
  })
}
