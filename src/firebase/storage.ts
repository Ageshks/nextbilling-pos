import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { getFirebaseApp } from './config'

// Firebase Storage is used only for optional product images / store logos.
// Images are downscaled client-side before upload to keep storage/bandwidth low.

let _storage: ReturnType<typeof getStorage> | null = null

export function getStorageInstance(): ReturnType<typeof getStorage> {
  if (!_storage) _storage = getStorage(getFirebaseApp())
  return _storage
}

export async function uploadImage(
  path: string,
  file: Blob,
): Promise<string> {
  const storageRef = ref(getStorageInstance(), path)
  await uploadBytes(storageRef, file)
  return await getDownloadURL(storageRef)
}

export async function deleteImage(path: string): Promise<void> {
  try {
    await deleteObject(ref(getStorageInstance(), path))
  } catch {
    // best effort cleanup
  }
}

export function makeImagePath(storeId: string, kind: 'products' | 'settings', name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  return `${storeId}/${kind}/${Date.now()}-${safe}`
}

/** Downscale an image file to at most 800x800 JPEG (or PNG if transparent). */
export async function optimizeImage(file: File, maxSize = 800, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image conversion failed'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image file'))
    }
    img.src = url
  })
}