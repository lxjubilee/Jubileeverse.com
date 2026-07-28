/**
 * AuthorChatPanel.tsx — Phase 7 contextual author chat panel
 *
 * Shown as the "Chat" tab in ContextualDashboard.
 * Allows editors to brainstorm with an author in the context of a taxonomy node,
 * and convert chat messages to content drafts.
 */

import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Trash2, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card'
import { Button }    from '../ui/Button'
import { Select }    from '../ui/Select'
import { ScrollArea } from '../ui/ScrollArea'
import { useCockpitStore }        from '../../hooks/useCockpitStore'
import { useTaxonomyNode }        from '../../hooks/useTaxonomy'
import { useAuthors }             from '../../hooks/useAuthors'
import { useAuthorChatHistory, useSendAuthorMessage, useClearAuthorChat } from '../../hooks/useAuthorChat'
import { useCreateContent }       from '../../hooks/useContent'
import type { TaxonomyType }      from '../../types/taxonomy'
import type { ObjectType }        from '../../types/content-objects'

const OBJECT_TYPE_OPTIONS: Array<{ value: ObjectType; label: string }> = [
  { value: 'article',      label: 'Article'      },
  { value: 'prayer',       label: 'Prayer'       },
  { value: 'music',        label: 'Music Concept'},
  { value: 'radio_episode', label: 'Radio Script'},
]

export function AuthorChatPanel() {
  const navigate = useNavigate()
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)
  const selectedNodeSlug = useCockpitStore(s => s.selectedNodeSlug)
  const selectedTaxonomyType = useCockpitStore(s => s.selectedTaxonomyType)

  // Taxonomy node for preferred_authors default
  const { data: nodeDetail } = useTaxonomyNode(
    selectedTaxonomyType as TaxonomyType,
    selectedNodeSlug
  )
  const config = nodeDetail?.config as Record<string, unknown> | undefined
  const preferredAuthorId = String((config?.preferred_authors as unknown[])?.[0] ?? '')

  const { data: authorsData } = useAuthors()
  const authors = authorsData?.authors ?? []

  // Author selector — default to preferred, then first in list
  const [authorId, setAuthorId] = React.useState<string>('')
  React.useEffect(() => {
    if (authorId) return
    const preferred = preferredAuthorId && authors.find(p => p.id === preferredAuthorId)
    if (preferred) { setAuthorId(preferred.id); return }
    if (authors.length > 0) setAuthorId(authors[0].id)
  }, [authors, preferredAuthorId])

  const taxonomyNodeId = selectedNodeId ? Number(selectedNodeId) : null

  // Chat state
  const { data: historyData } = useAuthorChatHistory(authorId || null, taxonomyNodeId)
  const messages = historyData?.messages ?? []
  const sendMsg  = useSendAuthorMessage(authorId || null, taxonomyNodeId)
  const clearChat = useClearAuthorChat(authorId || null, taxonomyNodeId)

  const [inputText,   setInputText]   = React.useState('')
  const [convertFor,  setConvertFor]  = React.useState<string | null>(null)   // message content to convert
  const [convertType, setConvertType] = React.useState<ObjectType>('article')
  const [createdId,   setCreatedId]   = React.useState<string | null>(null)
  const [convertErr,  setConvertErr]  = React.useState<string | null>(null)

  const createContent = useCreateContent()

  // Scroll to bottom when messages change
  const bottomRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const authorOptions = authors.map(p => ({ value: p.id, label: p.title || p.id }))

  async function handleSend() {
    const text = inputText.trim()
    if (!text || !authorId || sendMsg.isPending) return
    setInputText('')
    try {
      await sendMsg.mutateAsync(text)
    } catch { /* error surfaces via sendMsg.error */ }
  }

  async function handleConvert() {
    if (!convertFor || !authorId) return
    setCreatedId(null)
    setConvertErr(null)
    try {
      const result = await createContent.mutateAsync({
        object_type:  convertType,
        title:        `Chat draft — ${new Date().toLocaleDateString()}`,
        status:       'draft',
        author_id:    authorId,
        extension_data: { body_html: convertFor },
        meta_data:    { generated_by: 'ai_chat' },
      })
      setCreatedId(result.id)
    } catch (err) {
      setConvertErr(err instanceof Error ? err.message : 'Failed to create draft')
    }
  }

  const hasNodeOrAuthor = !!selectedNodeId || !!authorId

  return (
    <Card className="m-3">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Author Chat</span>
          {messages.length > 0 && (
            <button
              onClick={() => clearChat.mutate()}
              disabled={clearChat.isPending}
              className="text-muted-foreground hover:text-destructive transition-colors"
              title="Clear chat history"
            >
              <Trash2 size={12} />
            </button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Author selector */}
        {authors.length > 0 ? (
          <Select
            className="w-full h-7 text-xs"
            value={authorId}
            onValueChange={setAuthorId}
            options={authorOptions}
            placeholder="Select author…"
          />
        ) : (
          <p className="text-xs text-muted-foreground">No authors found. Create one in the Authors tab.</p>
        )}

        {!hasNodeOrAuthor && (
          <p className="text-xs text-muted-foreground">Select a taxonomy node or author to start chatting.</p>
        )}

        {hasNodeOrAuthor && authorId && (
          <>
            {/* Message list */}
            <ScrollArea className="h-72 border rounded">
              <div className="p-2 space-y-2">
                {messages.length === 0 && !sendMsg.isPending && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No messages yet. Ask a question or request brainstorming ideas.
                  </p>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded px-2.5 py-1.5 text-xs ${
                      msg.role === 'user'
                        ? 'bg-blue-100 text-blue-900'
                        : 'bg-muted text-foreground'
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      {msg.role === 'assistant' && (
                        <button
                          onClick={() => {
                            setConvertFor(msg.content)
                            setCreatedId(null)
                            setConvertErr(null)
                          }}
                          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground underline block"
                        >
                          → Draft
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {sendMsg.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded px-2.5 py-1.5 text-xs flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 size={10} className="animate-spin" />
                      <span>Thinking…</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Send error */}
            {sendMsg.error && (
              <div className="flex items-start gap-1.5 text-xs text-destructive rounded border border-destructive/30 bg-destructive/5 p-2">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>{sendMsg.error instanceof Error ? sendMsg.error.message : 'Failed to send'}</span>
              </div>
            )}

            {/* Convert-to-draft panel */}
            {convertFor && (
              <div className="border rounded p-2 space-y-2 bg-muted/30">
                <p className="text-xs font-medium">Convert to Draft</p>
                <Select
                  className="w-full h-7 text-xs"
                  value={convertType}
                  onValueChange={v => setConvertType(v as ObjectType)}
                  options={OBJECT_TYPE_OPTIONS}
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleConvert} disabled={createContent.isPending}>
                    {createContent.isPending ? <><Loader2 size={10} className="animate-spin mr-1" />Creating…</> : 'Create Draft'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConvertFor(null)}>
                    Cancel
                  </Button>
                </div>
                {createdId && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700">
                    <CheckCircle size={10} />
                    <span>Created!</span>
                    <button
                      onClick={() => { setConvertFor(null); navigate(`/editor/${createdId}`) }}
                      className="underline font-medium"
                    >
                      Open →
                    </button>
                  </div>
                )}
                {convertErr && (
                  <p className="text-xs text-destructive">{convertErr}</p>
                )}
              </div>
            )}

            {/* Input area */}
            <div className="flex gap-2">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Ask something or request ideas…"
                rows={2}
                disabled={sendMsg.isPending}
                className="flex-1 text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
              />
              <Button
                size="sm"
                className="h-auto px-2 text-xs self-end"
                onClick={handleSend}
                disabled={sendMsg.isPending || !inputText.trim()}
              >
                {sendMsg.isPending
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Send size={12} />
                }
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
