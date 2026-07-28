/**
 * GenerateButton.tsx — Phase 6 inline transform button for InlineEditorPanel
 *
 * Shows applicable transform recipes for the current content object.
 * Opens an absolute-positioned panel listing transform options.
 */

import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Wand2, Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react'
import { useGenerateContent } from '../../hooks/useGeneration'
import type { ContentObject, ObjectType } from '../../types/content-objects'

interface TransformOption {
  slug:       string
  label:      string
  objectType: ObjectType
}

function getApplicableTransforms(objectType: string): TransformOption[] {
  if (['article', 'blog_post', 'page', 'news_item', 'devotional'].includes(objectType)) {
    return [
      { slug: 'article-to-prayer',          label: 'To Prayer',         objectType: 'prayer'        },
      { slug: 'article-to-radio-script',    label: 'To Radio Script',   objectType: 'radio_episode' },
      { slug: 'article-to-social-snippets', label: 'To Social Snippets', objectType: 'article'      },
    ]
  }
  if (objectType === 'prayer') {
    return [
      { slug: 'prayer-to-music-concept', label: 'To Music Concept', objectType: 'music' },
    ]
  }
  return []
}

interface GenerateButtonProps {
  item: ContentObject
}

export function GenerateButton({ item }: GenerateButtonProps) {
  const navigate  = useNavigate()
  const generate  = useGenerateContent()
  const [open,    setOpen]    = React.useState(false)
  const [created, setCreated] = React.useState<string | null>(null)
  const [errMsg,  setErrMsg]  = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)

  const transforms = getApplicableTransforms(item.object_type)
  if (transforms.length === 0) return null

  // Close panel on outside click
  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleTransform(t: TransformOption) {
    setCreated(null)
    setErrMsg(null)
    try {
      const result = await generate.mutateAsync({
        recipe_slug:      t.slug,
        object_type:      t.objectType,
        source_object_id: item.id,
      })
      setCreated(result.content_object.id)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Generation failed')
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); setCreated(null); setErrMsg(null) }}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Transform content with AI"
        title="AI Transform"
        disabled={generate.isPending}
      >
        {generate.isPending
          ? <Loader2 size={13} className="animate-spin" />
          : <Wand2 size={13} />
        }
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-md border bg-popover shadow-md text-xs">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="font-medium">AI Transform</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={11} />
            </button>
          </div>

          <div className="p-1 space-y-0.5">
            {transforms.map(t => (
              <button
                key={t.slug}
                onClick={() => handleTransform(t)}
                disabled={generate.isPending}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted disabled:opacity-50 transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Feedback */}
          {generate.isPending && (
            <div className="px-3 py-2 border-t flex items-center gap-1.5 text-muted-foreground">
              <Loader2 size={10} className="animate-spin" />
              <span>Generating…</span>
            </div>
          )}
          {created && !generate.isPending && (
            <div className="px-3 py-2 border-t flex items-center gap-1.5 text-green-700">
              <CheckCircle size={10} />
              <span>Created!</span>
              <button
                onClick={() => { setOpen(false); navigate(`/editor/${created}`) }}
                className="ml-auto underline font-medium"
              >
                Open →
              </button>
            </div>
          )}
          {errMsg && (
            <div className="px-3 py-2 border-t flex items-start gap-1.5 text-destructive">
              <AlertTriangle size={10} className="shrink-0 mt-0.5" />
              <span className="break-words">{errMsg}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
