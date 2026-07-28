/**
 * PubOS Content Object Types — Phase 1 TypeScript Interfaces
 *
 * Every content object shares a common lifecycle base. Type-specific fields
 * that don't warrant dedicated DB columns are stored in `extensions` (JSONB).
 */

// ── Shared lifecycle base ─────────────────────────────────────────────────────

export type ObjectStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived'

export interface ContentObjectBase<E = Record<string, unknown>> {
  id: number
  status: ObjectStatus
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  archived_at: string | null
  extensions: E
}

// ── 1. Article ────────────────────────────────────────────────────────────────

export interface ArticleExtensions {
  author_ids?: number[]
  tags?: string[]
  seo_title?: string
  seo_description?: string
}

export interface Article extends ContentObjectBase<ArticleExtensions> {
  object_type: 'article'
  title: string
  body_html: string | null
  word_count: number
  reading_time: number
  featured_image_id: number | null
  category_id: number | null
}

// ── 2. Prayer ─────────────────────────────────────────────────────────────────

export interface PrayerExtensions {
  scripture_refs?: string[]
  persona_id?: number
  language_code?: string
}

export interface Prayer extends ContentObjectBase<PrayerExtensions> {
  object_type: 'prayer'
  title: string
  prayer_text: string | null
  occasion_type: string | null
  liturgical_season: string | null
}

// ── 3. Music ──────────────────────────────────────────────────────────────────

export interface MusicExtensions {
  chord_chart?: string
  genre?: string
  artist?: string
}

export interface Music extends ContentObjectBase<MusicExtensions> {
  object_type: 'music'
  title: string
  lyrics_text: string | null
  audio_asset_id: number | null
  bpm: number | null
  key_signature: string | null
  album_id: number | null
}

// ── 4. Radio Episode ──────────────────────────────────────────────────────────

export interface RadioEpisodeExtensions {
  tags?: string[]
  sponsor?: string
  transcript_url?: string
}

export interface RadioEpisode extends ContentObjectBase<RadioEpisodeExtensions> {
  object_type: 'radio_episode'
  title: string
  script_text: string | null
  show_notes: string | null
  audio_asset_id: number | null
  episode_number: number | null
  series_id: number | null
  duration_seconds: number | null
}

// ── 5. Podcast ────────────────────────────────────────────────────────────────

export interface PodcastChapter {
  start_seconds: number
  title: string
}

export interface PodcastExtensions {
  chapters?: PodcastChapter[]
  feed_url?: string
  rss_guid?: string
}

export interface Podcast extends ContentObjectBase<PodcastExtensions> {
  object_type: 'podcast'
  title: string
  transcript_text: string | null
  audio_asset_id: number | null
  episode_number: number | null
  series_id: number | null
}

// ── 6. Image ──────────────────────────────────────────────────────────────────

export interface ImageDimensions {
  width: number
  height: number
}

export interface FocalPoint {
  x: number
  y: number
}

export interface ImageExtensions {
  dimensions?: ImageDimensions
  focal_point?: FocalPoint
  generation_prompt?: string
  generation_model?: string
}

export interface Image extends ContentObjectBase<ImageExtensions> {
  object_type: 'image'
  file_url: string
  alt_text: string | null
  caption: string | null
  license_type: string | null
}

// ── 7. Video ──────────────────────────────────────────────────────────────────

export interface VideoChapter {
  start_seconds: number
  title: string
}

export interface VideoExtensions {
  chapters?: VideoChapter[]
  transcript_text?: string
  streaming_urls?: Record<string, string>
}

export interface Video extends ContentObjectBase<VideoExtensions> {
  object_type: 'video'
  title: string
  video_url: string | null
  thumbnail_id: number | null
  duration_seconds: number | null
}

// ── 8. Taxonomy Node ──────────────────────────────────────────────────────────

export type TaxonomyType = 'topic' | 'genre' | 'audience' | 'region' | 'liturgical'

export interface TaxonomyExtensions {
  allowed_types?: ContentObjectType[]
  generation_recipes?: number[]
  icon?: string
  color?: string
}

export interface TaxonomyNode extends ContentObjectBase<TaxonomyExtensions> {
  object_type: 'taxonomy_node'
  name: string
  slug: string
  parent_id: number | null
  taxonomy_type: TaxonomyType
  depth: number
}

// ── 9. Author ─────────────────────────────────────────────────────────────────

export interface VoiceProfile {
  tone: string
  style: string
  vocabulary_level: 'elementary' | 'conversational' | 'academic' | 'prophetic'
  scripture_translation: string
  example_opening?: string
}

export interface AuthorExtensions {
  voice_profile?: VoiceProfile
  boundaries?: string[]
  example_outputs?: string[]
  ai_model?: string
  ai_provider?: string
}

export interface Author extends ContentObjectBase<AuthorExtensions> {
  object_type: 'author'
  name: string
  slug: string
  mission: string | null
}

// ── 10. Site ──────────────────────────────────────────────────────────────────

export interface SiteExtensions {
  theme_id?: string
  nav_mapping?: Record<string, string>
  taxonomy_mapping?: Record<string, number>
  publishing_rules?: {
    require_approval: boolean
    auto_publish_drafts: boolean
    default_status: ObjectStatus
  }
}

export interface Site extends ContentObjectBase<SiteExtensions> {
  object_type: 'site'
  domain: string
  slug: string
}

// ── 11. Page Template ─────────────────────────────────────────────────────────

export type TemplateEngine = 'html' | 'handlebars' | 'react' | 'markdown'

export interface LayoutSlot {
  id: string
  label: string
  allowed_types: ContentObjectType[]
  required: boolean
}

export interface PageTemplateExtensions {
  layout_slots?: LayoutSlot[]
  css_bundle_id?: string
  preview_url?: string
}

export interface PageTemplate extends ContentObjectBase<PageTemplateExtensions> {
  object_type: 'page_template'
  name: string
  slug: string
  template_engine: TemplateEngine
}

// ── 12. Asset ─────────────────────────────────────────────────────────────────

export interface AssetExtensions {
  original_filename?: string
  uploaded_by?: string
  tags?: string[]
}

export interface Asset extends ContentObjectBase<AssetExtensions> {
  object_type: 'asset'
  storage_url: string
  mime_type: string
  file_size: number | null
  checksum: string | null
  cdn_url: string | null
}

// ── 13. Prompt Recipe ─────────────────────────────────────────────────────────

export interface RecipeConstraints {
  max_tokens?: number
  temperature?: number
  min_word_count?: number
  forbidden_phrases?: string[]
  required_sections?: string[]
}

export interface PromptRecipeExtensions {
  constraints?: RecipeConstraints
  output_schema?: Record<string, unknown>
  example_output?: string
  target_object_type?: ContentObjectType
}

export interface PromptRecipe extends ContentObjectBase<PromptRecipeExtensions> {
  object_type: 'prompt_recipe'
  name: string
  slug: string
  system_prompt: string | null
  user_template: string | null
}

// ── Union type ────────────────────────────────────────────────────────────────

export type ContentObject =
  | Article
  | Prayer
  | Music
  | RadioEpisode
  | Podcast
  | Image
  | Video
  | TaxonomyNode
  | Author
  | Site
  | PageTemplate
  | Asset
  | PromptRecipe

export type ContentObjectType = ContentObject['object_type']

export const CONTENT_OBJECT_TYPES: ContentObjectType[] = [
  'article',
  'prayer',
  'music',
  'radio_episode',
  'podcast',
  'image',
  'video',
  'taxonomy_node',
  'author',
  'site',
  'page_template',
  'asset',
  'prompt_recipe',
]
