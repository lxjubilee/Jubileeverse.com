/**
 * AIGenerationPanel.tsx — Phase 6 AI generation panel
 *
 * Uses POST /api/generate (recipe-based) instead of persona/invoke stub.
 * Supports: standard generation + transformation mode (when object selected).
 */

import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { Button }  from '../ui/Button'
import { Select }  from '../ui/Select'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card'
import { useTaxonomyNode }  from '../../hooks/useTaxonomy'
import { useContentList }   from '../../hooks/useContent'
import { useRecipes }       from '../../hooks/useRecipes'
import { useGenerateContent } from '../../hooks/useGeneration'
import { useCockpitStore }  from '../../hooks/useCockpitStore'
import type { ObjectType }  from '../../types/content-objects'
import type { TaxonomyType } from '../../types/taxonomy'

const TRANSFORM_SLUGS = new Set([
  'article-to-prayer',
  'article-to-radio-script',
  'article-to-social-snippets',
  'prayer-to-music-concept',
])

// Map transform recipe slug → target object_type
const TRANSFORM_TARGET: Record<string, ObjectType> = {
  'article-to-prayer':          'prayer',
  'article-to-radio-script':    'radio_episode',
  'article-to-social-snippets': 'article',
  'prayer-to-music-concept':    'music',
}

interface AIGenerationPanelProps {
  // initialType kept for backwards-compatibility; ignored in Phase 6 (recipe drives type)
  initialType?: ObjectType
}

export function AIGenerationPanel(_props: AIGenerationPanelProps = {}) {
  const navigate = useNavigate()
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)
  const selectedNodeSlug = useCockpitStore(s => s.selectedNodeSlug)
  const selectedTaxonomyType = useCockpitStore(s => s.selectedTaxonomyType)
  const selectedObjectId = useCockpitStore(s => s.selectedObjectId)

  const [recipeSlug,         setRecipeSlug]         = React.useState<string>('')
  const [authorId,           setAuthorId]            = React.useState<string>('')
  const [customInstructions, setCustomInstructions]  = React.useState<string>('')
  const [confirmed,          setConfirmed]           = React.useState(false)
  const [lastObjectId,       setLastObjectId]        = React.useState<string | null>(null)

  const isTransformMode = !!selectedObjectId

  const { data: nodeDetail } = useTaxonomyNode(
    selectedTaxonomyType as TaxonomyType,
    selectedNodeSlug
  )

  const { data: recipesData, isLoading: recipesLoading } = useRecipes()
  const { data: authorsData } = useContentList({ type: 'author', status: 'published', limit: 50 })

  const generate = useGenerateContent()

  // Filter recipes based on mode
  const availableRecipes = React.useMemo(() => {
    if (!recipesData?.recipes) return []
    if (isTransformMode) {
      return recipesData.recipes.filter(r => TRANSFORM_SLUGS.has(r.slug))
    }
    return recipesData.recipes.filter(r => !TRANSFORM_SLUGS.has(r.slug))
  }, [recipesData, isTransformMode])

  // Auto-select first recipe when list changes
  React.useEffect(() => {
    if (availableRecipes.length > 0 && !recipeSlug) {
      setRecipeSlug(availableRecipes[0].slug)
    } else if (availableRecipes.length > 0 && !availableRecipes.find(r => r.slug === recipeSlug)) {
      setRecipeSlug(availableRecipes[0].slug)
    }
  }, [availableRecipes])

  const selectedRecipe = availableRecipes.find(r => r.slug === recipeSlug)
  const isSensitiveNode = nodeDetail?.config?.sensitive === true

  // Determine object_type from recipe
  function getObjectType(): ObjectType {
    if (isTransformMode && recipeSlug) {
      return TRANSFORM_TARGET[recipeSlug] || 'article'
    }
    return (selectedRecipe?.target_content_type as ObjectType) || 'article'
  }

  const recipeOptions = availableRecipes.map(r => ({
    value: r.slug,
    label: r.title || r.slug,
  }))

  const authorOptions = [
    { value: '', label: 'No author' },
    ...(authorsData?.items || []).map(p => ({ value: p.id, label: p.title || p.id })),
  ]

  async function handleGenerate() {
    if (!recipeSlug) return
    setLastObjectId(null)
    try {
      const result = await generate.mutateAsync({
        recipe_slug:          recipeSlug,
        object_type:          getObjectType(),
        taxonomy_node_id:     selectedNodeId ? Number(selectedNodeId) : null,
        author_id:            authorId || null,
        source_object_id:     isTransformMode ? selectedObjectId : null,
        custom_instructions:  customInstructions || null,
        confirmed:            isSensitiveNode ? confirmed : undefined,
      })
      setLastObjectId(result.content_object.id)
      setConfirmed(false)
    } catch {
      // error surfaces via generate.error
    }
  }

  const errorMsg = generate.error instanceof Error ? generate.error.message : null
  const is429 = errorMsg?.includes('Hourly limit') || errorMsg?.includes('daily generation limit')
  const is422 = errorMsg?.includes('marked sensitive')

  const safetyFlags = generate.data?.safety_flags ?? []
  const hasBlock    = safetyFlags.some(f => f.severity === 'block')

  return (
    <Card className="m-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Zap size={14} />
          AI Generate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Transform mode indicator */}
        {isTransformMode && (
          <div className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-1">
            Transform mode — will use selected content as source
          </div>
        )}

        {/* No node selected (non-transform) */}
        {!selectedNodeId && !isTransformMode && (
          <p className="text-xs text-muted-foreground">Select a taxonomy node to generate content.</p>
        )}

        {(selectedNodeId || isTransformMode) && (
          <>
            {/* Recipe selector */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Recipe</label>
              {recipesLoading ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> Loading recipes…
                </p>
              ) : (
                <Select
                  className="w-full h-7 text-xs"
                  value={recipeSlug}
                  onValueChange={setRecipeSlug}
                  options={recipeOptions}
                  placeholder="Select recipe…"
                />
              )}
            </div>

            {/* Author selector */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Author (optional)</label>
              <Select
                className="w-full h-7 text-xs"
                value={authorId}
                onValueChange={setAuthorId}
                options={authorOptions}
                placeholder="No author"
              />
            </div>

            {/* Custom instructions */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Custom instructions (optional)</label>
              <textarea
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                placeholder="Additional instructions for this generation…"
                rows={2}
                className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {/* Sensitive node warning */}
            {isSensitiveNode && (
              <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 rounded p-2">
                <AlertTriangle size={12} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-amber-700 font-medium">Sensitive taxonomy node</p>
                  <p className="text-xs text-amber-600 mt-0.5">This node requires explicit confirmation before generating.</p>
                  <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="accent-amber-600"
                    />
                    <span className="text-xs text-amber-700">I confirm I want to generate for this node</span>
                  </label>
                </div>
              </div>
            )}

            {/* Generate button */}
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleGenerate}
              disabled={generate.isPending || !recipeSlug || (isSensitiveNode && !confirmed)}
            >
              {generate.isPending ? (
                <><Loader2 size={10} className="animate-spin mr-1" /> Generating…</>
              ) : (
                <><Zap size={10} className="mr-1" /> Generate Draft</>
              )}
            </Button>

            {/* Error display */}
            {errorMsg && (
              <div className={`flex items-start gap-1.5 text-xs rounded p-2 border ${
                is429 || is422
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-destructive/30 bg-destructive/5 text-destructive'
              }`}>
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Safety flags */}
            {safetyFlags.length > 0 && (
              <div className={`rounded p-2 border text-xs space-y-1 ${
                hasBlock ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'
              }`}>
                <p className={`font-medium ${hasBlock ? 'text-red-700' : 'text-amber-700'}`}>
                  Safety review
                </p>
                {safetyFlags.map((f, i) => (
                  <p key={i} className={f.severity === 'block' ? 'text-red-600' : 'text-amber-600'}>
                    {f.severity === 'block' ? '⊘' : '⚠'} {f.message}
                  </p>
                ))}
              </div>
            )}

            {/* Success */}
            {lastObjectId && !generate.isPending && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                <CheckCircle size={12} />
                <span>Draft created!</span>
                <button
                  onClick={() => navigate(`/editor/${lastObjectId}`)}
                  className="underline font-medium ml-1"
                >
                  Open in editor →
                </button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
