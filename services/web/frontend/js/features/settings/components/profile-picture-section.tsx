import { ChangeEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FetchError,
  deleteJSON,
  getUserFacingMessage,
} from '../../../infrastructure/fetch-json'
import getMeta from '../../../utils/meta'
import { useUserContext } from '../../../shared/context/user-context'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormText from '@/shared/components/ol/ol-form-text'
import Notification from '@/shared/components/notification'
import UserAvatar, {
  forgetMissingAvatar,
} from '@/shared/components/user-avatar'
import firstCharacter from '@/shared/utils/first-character'
import {
  getBackgroundColorForUserId,
  hslStringToLuminance,
} from '@/shared/utils/colors'
import {
  AvatarImageError,
  prepareAvatarImage,
} from '../utils/prepare-avatar-image'

const PREVIEW_SIZE = 72

type Message = { type: 'success' | 'error'; text: string }

async function uploadAvatar(file: File): Promise<{ version: number }> {
  const blob = await prepareAvatarImage(file)
  const response = await fetch('/user/avatar', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': blob.type,
      'X-Csrf-Token': getMeta('ol-csrfToken'),
    },
    body: blob,
  })
  if (!response.ok) {
    throw new FetchError(
      response.statusText,
      '/user/avatar',
      undefined,
      response
    )
  }
  return response.json()
}

function ProfilePictureSection() {
  const { t } = useTranslation()
  const { id, first_name: firstName, email } = useUserContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [version, setVersion] = useState<number>()
  const [hasPicture, setHasPicture] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  const backgroundColor = getBackgroundColorForUserId(id ?? undefined)
  const isLightFont = hslStringToLuminance(backgroundColor) < 0.5
  const letter = firstCharacter(firstName || email || '')

  const errorText = (error: unknown) => {
    if (error instanceof AvatarImageError) {
      return error.reason === 'too-large'
        ? t('profile_picture_too_large')
        : t('profile_picture_invalid_image')
    }
    if (error instanceof FetchError) {
      const status = error.response?.status
      if (status === 413) return t('profile_picture_too_large')
      if (status === 400) return t('profile_picture_invalid_image')
    }
    return (
      getUserFacingMessage(error instanceof Error ? error : null) ??
      t('generic_something_went_wrong')
    )
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // allow choosing the same file again later
    event.target.value = ''
    if (!file) {
      return
    }
    setMessage(null)
    setIsBusy(true)
    try {
      const result = await uploadAvatar(file)
      if (id) {
        forgetMissingAvatar(id)
      }
      setVersion(result.version)
      setMessage({ type: 'success', text: t('profile_picture_updated') })
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) })
    } finally {
      setIsBusy(false)
    }
  }

  const handleRemove = async () => {
    setMessage(null)
    setIsBusy(true)
    try {
      await deleteJSON('/user/avatar')
      setVersion(Date.now())
      setHasPicture(false)
      setMessage({ type: 'success', text: t('profile_picture_removed') })
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) })
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <h3 id="profile-picture">{t('profile_picture')}</h3>
      <OLFormGroup>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              position: 'relative',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: PREVIEW_SIZE,
              height: PREVIEW_SIZE,
              borderRadius: '50%',
              backgroundColor,
              color: isLightFont
                ? 'var(--content-primary-dark)'
                : 'var(--content-primary)',
              fontSize: PREVIEW_SIZE / 2,
              textTransform: 'uppercase',
            }}
          >
            <UserAvatar
              userId={id}
              version={version}
              fallback={letter}
              onStatusChange={status => setHasPicture(status === 'loaded')}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={handleFileChange}
            />
            <OLButton
              variant="secondary"
              isLoading={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              {t('upload_profile_picture')}
            </OLButton>
            {hasPicture ? (
              <OLButton
                variant="danger-ghost"
                disabled={isBusy}
                onClick={handleRemove}
              >
                {t('remove_profile_picture')}
              </OLButton>
            ) : null}
          </div>
        </div>
        <OLFormText>{t('profile_picture_hint')}</OLFormText>
      </OLFormGroup>
      {message ? (
        <OLFormGroup>
          <div className="notification-list">
            <Notification type={message.type} content={message.text} />
          </div>
        </OLFormGroup>
      ) : null}
    </>
  )
}

export default ProfilePictureSection
