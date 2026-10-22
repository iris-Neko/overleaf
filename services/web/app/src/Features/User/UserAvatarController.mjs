import crypto from 'node:crypto'
import express from 'express'
import mongodb from 'mongodb-legacy'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { db } from '../../infrastructure/mongodb.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import { z, zz, parseReq } from '../../infrastructure/Validation.mjs'

const { ObjectId } = mongodb

// Profile pictures for Community Edition. The browser crops and downsizes the
// picture before uploading it (see profile-picture-section.tsx), so the server
// only has to make sure that what it stores really is a small PNG, JPEG or
// WebP image. SVG is deliberately not accepted.
const MAX_BYTES = 256 * 1024
const MAX_DIMENSION = 512

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

// The raw body parser is only used by the upload route. Requests with another
// content type are left unparsed and rejected by the schema below.
const parseRawBody = express.raw({
  type: ['image/png', 'image/jpeg', 'image/webp'],
  limit: MAX_BYTES,
})

function rawBody(req, res, next) {
  parseRawBody(req, res, error => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ message: 'image is too large' })
    }
    next(error)
  })
}

const getAvatarSchema = z.object({
  params: z.strictObject({
    user_id: zz.objectId(),
  }),
})

const uploadAvatarSchema = z.object({
  body: z.instanceof(Buffer),
})

/**
 * Read the pixel size from the image header without decoding the image.
 *
 * @param {Buffer} buf
 * @returns {{ contentType: string, width: number, height: number } | null}
 */
function readImageInfo(buf) {
  try {
    if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
      if (buf.toString('latin1', 12, 16) !== 'IHDR') return null
      return {
        contentType: 'image/png',
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      }
    }

    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 4 <= buf.length) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1]
        if (marker === 0xff) {
          i += 1 // fill byte
          continue
        }
        if (
          marker === 0xd8 ||
          marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7)
        ) {
          i += 2 // marker without a length field
          continue
        }
        const isStartOfFrame =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        if (isStartOfFrame) {
          return {
            contentType: 'image/jpeg',
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          }
        }
        i += 2 + buf.readUInt16BE(i + 2)
      }
      return null
    }

    if (
      buf.length >= 30 &&
      buf.toString('latin1', 0, 4) === 'RIFF' &&
      buf.toString('latin1', 8, 12) === 'WEBP'
    ) {
      const chunk = buf.toString('latin1', 12, 16)
      if (chunk === 'VP8 ') {
        if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) {
          return null
        }
        return {
          contentType: 'image/webp',
          width: buf.readUInt16LE(26) & 0x3fff,
          height: buf.readUInt16LE(28) & 0x3fff,
        }
      }
      if (chunk === 'VP8L') {
        if (buf[20] !== 0x2f) return null
        const bits = buf.readUInt32LE(21)
        return {
          contentType: 'image/webp',
          width: (bits & 0x3fff) + 1,
          height: ((bits >>> 14) & 0x3fff) + 1,
        }
      }
      if (chunk === 'VP8X') {
        return {
          contentType: 'image/webp',
          width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
          height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
        }
      }
    }
  } catch {
    // truncated header
  }
  return null
}

function etagFor(avatar) {
  return `"${avatar.updatedAt.getTime().toString(36)}-${avatar.size}"`
}

async function getAvatar(req, res) {
  const { params } = parseReq(req, getAvatarSchema)
  const avatar = await db.userAvatars.findOne({
    _id: new ObjectId(params.user_id),
  })
  if (avatar == null) {
    return res.sendStatus(404)
  }
  res.set({
    'Content-Type': avatar.contentType,
    'Cache-Control': 'private, no-cache',
    ETag: etagFor(avatar),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  res.removeHeader('Pragma')
  res.removeHeader('Expires')
  res.removeHeader('Surrogate-Control')
  res.send(Buffer.from(avatar.data, 'base64'))
}

async function uploadAvatar(req, res) {
  const { body } = parseReq(req, uploadAvatarSchema)
  const userId = SessionManager.getLoggedInUserId(req.session)
  const info = readImageInfo(body)
  if (
    info == null ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > MAX_DIMENSION ||
    info.height > MAX_DIMENSION
  ) {
    return res.status(400).json({ message: 'not a supported image' })
  }
  const updatedAt = new Date()
  await db.userAvatars.updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        contentType: info.contentType,
        data: body.toString('base64'),
        size: body.length,
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
        updatedAt,
      },
    },
    { upsert: true }
  )
  logger.debug(
    { userId, size: body.length, contentType: info.contentType },
    'saved profile picture'
  )
  res.json({ version: updatedAt.getTime() })
}

async function deleteAvatar(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  await db.userAvatars.deleteOne({ _id: new ObjectId(userId) })
  res.sendStatus(204)
}

export default {
  rawBody,
  getAvatar: expressify(getAvatar),
  uploadAvatar: expressify(uploadAvatar),
  deleteAvatar: expressify(deleteAvatar),
  // exported for tests
  readImageInfo,
}
