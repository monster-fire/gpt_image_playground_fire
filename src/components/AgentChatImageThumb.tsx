import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { REBUILDABLE_CACHE_CLEARED_EVENT } from '../lib/db'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail } from '../lib/imageCache'

export default function AgentChatImageThumb({ imageId, imageIndex, imageIds, maskImageId }: { imageId: string; imageIndex: number; imageIds: string[]; maskImageId?: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const loadSeqRef = useRef(0)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState('')
  const [reloadSeq, setReloadSeq] = useState(0)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const openLightbox = () => setLightboxImageId(imageId, imageIds)

  useEffect(() => {
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px 0px' })

    observer.observe(node)
    return () => observer.disconnect()
  }, [imageId])

  useEffect(() => {
    setSrc('')
    if (!visible) return

    let cancelled = false
    let unsubscribe: (() => void) | undefined
    const seq = ++loadSeqRef.current
    const reload = () => {
      loadSeqRef.current += 1
      setSrc('')
      setReloadSeq((value) => value + 1)
    }

    if (maskImageId) {
      window.addEventListener(REBUILDABLE_CACHE_CLEARED_EVENT, reload)
      Promise.all([ensureImageCached(imageId), ensureImageCached(maskImageId)])
        .then(async ([baseUrl, maskUrl]) => {
          if (!baseUrl || !maskUrl) return baseUrl || ''
          return createMaskPreviewDataUrl(baseUrl, maskUrl)
        })
        .then((url) => {
          if (!cancelled && loadSeqRef.current === seq && url) setSrc(url)
        })
        .catch(() => {
          if (!cancelled && loadSeqRef.current === seq) setSrc('')
        })
      return () => {
        cancelled = true
        window.removeEventListener(REBUILDABLE_CACHE_CLEARED_EVENT, reload)
      }
    }

    window.addEventListener(REBUILDABLE_CACHE_CLEARED_EVENT, reload)

    unsubscribe = subscribeImageThumbnail(imageId, (thumbnail) => {
      if (!cancelled && loadSeqRef.current === seq) setSrc(thumbnail.dataUrl)
    })
    ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (!cancelled && loadSeqRef.current === seq && thumbnail?.dataUrl) setSrc(thumbnail.dataUrl)
      })
      .catch(() => {
        if (!cancelled && loadSeqRef.current === seq) setSrc('')
      })
    return () => {
      cancelled = true
      unsubscribe?.()
      window.removeEventListener(REBUILDABLE_CACHE_CLEARED_EVENT, reload)
    }
  }, [imageId, maskImageId, reloadSeq, visible])

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      data-agent-chat-image-thumb={imageId}
      aria-label={`打开第 ${imageIndex + 1} 张图片`}
      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg shadow-sm cursor-pointer transition-opacity hover:opacity-90 ${
        maskImageId ? 'border-2 border-blue-500' : 'border border-gray-200 dark:border-white/[0.08]'
      }`}
      onClick={openLightbox}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        openLightbox()
      }}
    >
      {src ? <img src={src} data-agent-chat-image-thumb-img={imageId} className="h-full w-full object-cover" alt="" /> : <div className="h-full w-full bg-gray-100 dark:bg-white/[0.04]" />}
      {maskImageId && (
        <span className="absolute left-1 top-1 z-10 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] font-bold leading-none tracking-wider text-white backdrop-blur-sm pointer-events-none">
          MASK
        </span>
      )}
      <span className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] font-semibold text-white backdrop-blur-sm pointer-events-none">
        {imageIndex + 1}
      </span>
    </div>
  )
}
