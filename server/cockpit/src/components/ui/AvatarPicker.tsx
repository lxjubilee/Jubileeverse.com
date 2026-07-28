/**
 * AvatarPicker.tsx — Avatar selection component for AuthorEditorPanel
 *
 * Two modes:
 *   1. Upload — file input → POST /api/assets/upload-url → PUT presigned URL → POST /api/assets/confirm
 *   2. Browse Library — modal grid of existing assets (object_type=asset)
 *
 * Props:
 *   value      — current avatar_asset_id (or null)
 *   currentUrl — resolved public URL of the current avatar (or null)
 *   name       — display name for initials fallback
 *   onChange   — called with (assetId, publicUrl) after upload or browse selection
 *   disabled   — locks the picker
 */

import * as React from 'react'
import { Upload, ImageIcon, X } from 'lucide-react'
import * as api from '../../lib/api'
import type { ContentObject, AssetExtension } from '../../types/content-objects'

interface AvatarPickerProps {
  value:      string | null
  currentUrl: string | null
  name:       string
  onChange:   (assetId: string, publicUrl: string) => void
  disabled?:  boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

// ── Library modal ─────────────────────────────────────────────────────────────

interface LibraryModalProps {
  onSelect: (assetId: string, publicUrl: string) => void
  onClose:  () => void
}

function LibraryModal({ onSelect, onClose }: LibraryModalProps) {
  const [assets, setAssets] = React.useState<ContentObject[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    api.listContent({ type: 'asset', limit: 40 })
      .then(r => setAssets(r.items))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg shadow-xl border w-[520px] max-h-[480px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-semibold">Asset Library</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
          ) : assets.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">No assets found.</div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {assets.map(asset => {
                const ext = asset.extension_data as unknown as AssetExtension
                const url = ext?.public_url
                return (
                  <button
                    key={asset.id}
                    onClick={() => url && onSelect(asset.id, url)}
                    disabled={!url}
                    className="aspect-square rounded border bg-muted/30 overflow-hidden hover:border-primary/50 hover:bg-muted/60 transition-colors flex items-center justify-center"
                    title={asset.title ?? ext?.filename ?? asset.id}
                  >
                    {url ? (
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={20} className="text-muted-foreground" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AvatarPicker({ value, currentUrl, name, onChange, disabled = false }: AvatarPickerProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading]     = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [showLibrary, setShowLibrary] = React.useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      // 1. Get presigned upload URL
      const { uploadUrl, publicUrl, key } = await api.getUploadUrl({
        filename:     file.name,
        content_type: file.type,
        object_type:  'asset',
      })
      // 2. PUT file to presigned URL
      await fetch(uploadUrl, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type },
      })
      // 3. Confirm asset in DB
      const asset = await api.confirmAsset({
        key,
        public_url:   publicUrl,
        filename:     file.name,
        content_type: file.type,
        file_size:    file.size,
        object_type:  'asset',
      })
      onChange(asset.id, publicUrl)
    } catch (err) {
      setUploadError((err as Error).message ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleLibrarySelect(assetId: string, publicUrl: string) {
    setShowLibrary(false)
    onChange(assetId, publicUrl)
  }

  const hasAvatar = !!value

  return (
    <>
      <div className="flex items-center gap-3">
        {/* Avatar preview */}
        <div className="shrink-0 w-14 h-14 rounded-full overflow-hidden border bg-muted flex items-center justify-center">
          {currentUrl ? (
            <img src={currentUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-base font-semibold text-muted-foreground">
              {name ? initials(name) : '?'}
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-input hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Upload size={11} />
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => setShowLibrary(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-input hover:bg-muted transition-colors disabled:opacity-50"
            >
              <ImageIcon size={11} />
              Library
            </button>
          </div>
          {hasAvatar && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
              Asset ID: {value!.slice(0, 8)}…
            </span>
          )}
          {uploadError && (
            <span className="text-[10px] text-destructive">{uploadError}</span>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Library modal */}
      {showLibrary && (
        <LibraryModal
          onSelect={handleLibrarySelect}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </>
  )
}
