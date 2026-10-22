import { CSSProperties, ReactNode, useState } from 'react'

const OBJECT_ID = /^[a-f0-9]{24}$/

// Users the server has already told us have no profile picture. This avoids
// asking again for every circle that is rendered for the same person.
const usersWithoutAvatar = new Set<string>()

export function forgetMissingAvatar(userId: string) {
  usersWithoutAvatar.delete(userId)
}

// Fills the nearest positioned ancestor (e.g. a circle with `position: relative`)
const FILL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  objectFit: 'cover',
}

type Status = 'loading' | 'loaded' | 'missing'

type UserAvatarProps = {
  userId?: string | null
  // changes whenever the picture is replaced, to bypass the browser cache
  version?: number
  // what to show when the user has no picture, e.g. the first letter of their name
  fallback?: ReactNode
  imageStyle?: CSSProperties
  onStatusChange?: (status: 'loaded' | 'missing') => void
}

function UserAvatarImage({
  userId,
  version,
  fallback = null,
  imageStyle = FILL_STYLE,
  onStatusChange,
}: UserAvatarProps) {
  // anonymous (link sharing) users have no account, and so no picture
  const validId = userId != null && OBJECT_ID.test(userId) ? userId : null
  const [status, setStatus] = useState<Status>(
    validId != null && !usersWithoutAvatar.has(validId) ? 'loading' : 'missing'
  )

  if (validId == null) {
    return <>{fallback}</>
  }

  const src =
    `/user/${validId}/avatar` + (version != null ? `?v=${version}` : '')

  return (
    <>
      {status !== 'loaded' && fallback}
      {status !== 'missing' && (
        <img
          src={src}
          alt=""
          draggable={false}
          hidden={status !== 'loaded'}
          style={imageStyle}
          onLoad={() => {
            setStatus('loaded')
            onStatusChange?.('loaded')
          }}
          onError={() => {
            usersWithoutAvatar.add(validId)
            setStatus('missing')
            onStatusChange?.('missing')
          }}
        />
      )}
    </>
  )
}

export default function UserAvatar(props: UserAvatarProps) {
  // start over when a different user, or a new version of the picture, is shown
  return (
    <UserAvatarImage
      key={`${props.userId ?? ''}:${props.version ?? ''}`}
      {...props}
    />
  )
}
