// Profile pictures are shown at most a few dozen pixels wide, so the browser
// crops the chosen image to a square and shrinks it before uploading. That keeps
// uploads tiny and means the server never has to decode untrusted images.
const AVATAR_SIZE = 128
const MAX_INPUT_BYTES = 20 * 1024 * 1024

export class AvatarImageError extends Error {
  constructor(readonly reason: 'too-large' | 'invalid') {
    super(reason)
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
) {
  return new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, type, quality)
  )
}

export async function prepareAvatarImage(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new AvatarImageError('too-large')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new AvatarImageError('invalid')
  }

  try {
    const side = Math.min(bitmap.width, bitmap.height)
    if (side < 1) {
      throw new AvatarImageError('invalid')
    }
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) {
      throw new AvatarImageError('invalid')
    }
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE
    )
    // Browsers that cannot encode WebP fall back to PNG, which the server also accepts.
    const blob = await canvasToBlob(canvas, 'image/webp', 0.9)
    if (!blob) {
      throw new AvatarImageError('invalid')
    }
    return blob
  } finally {
    bitmap.close()
  }
}
