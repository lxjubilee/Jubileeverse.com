/**
 * PubOS Taxonomy Types — Phase 2
 *
 * Seven parallel taxonomy systems, each with independent hierarchies.
 * Content objects can belong to nodes in multiple taxonomies simultaneously
 * via jv_content_taxonomy_map (polymorphic reference by object_table + object_id).
 *
 * See ADR 002 (docs/adr/002-database.md) for the jv_taxonomy schema.
 * See lib/taxonomy.js for server-side helpers.
 */

import type { ContentObjectType } from './objects'

// ── Taxonomy Type Enum ────────────────────────────────────────────────────────

export type TaxonomyType =
  | 'topics'
  | 'audience'
  | 'geography'
  | 'format'
  | 'persona'
  | 'language'
  | 'season'

export const TAXONOMY_TYPES: TaxonomyType[] = [
  'topics',
  'audience',
  'geography',
  'format',
  'persona',
  'language',
  'season',
]

export const TAXONOMY_TYPE_LABELS: Record<TaxonomyType, string> = {
  topics:    'Topics',
  audience:  'Audience',
  geography: 'Geography',
  format:    'Format',
  persona:   'Persona',
  language:  'Language',
  season:    'Season',
}

export const TAXONOMY_TYPE_DESCRIPTIONS: Record<TaxonomyType, string> = {
  topics:    'Primary subject matter organization for all content.',
  audience:  'Target demographic and spiritual maturity level.',
  geography: 'Regional and cultural context for localized content.',
  format:    'Content presentation format.',
  persona:   'Mapping to AI persona voices.',
  language:  'Multilingual content support.',
  season:    'Liturgical, calendar, and cultural seasons.',
}

// ── Navigation Contract ───────────────────────────────────────────────────────

export type HeroSectionType = 'featured_article' | 'featured_video' | 'image_banner' | 'none'
export type LayoutType = 'full_width' | 'split' | 'overlay'
export type DisplayType = 'grid' | 'list' | 'carousel'
export type FeedSortOrder = 'newest' | 'popular' | 'editorial_rank'

export type SidebarWidget =
  | 'related_prayers'
  | 'recent_music'
  | 'popular_articles'
  | 'persona_spotlight'
  | 'taxonomy_children_nav'

export type DynamicComponent =
  | 'newsletter_signup'
  | 'prayer_request_form'
  | 'donation_cta'
  | 'social_share_bar'

export interface HeroSection {
  type: HeroSectionType
  /** Manual content object ID or 'auto-latest' */
  source: string | number
  layout: LayoutType
}

export interface ContentFeed {
  display_type: DisplayType
  items_per_page: number
  sort_order: FeedSortOrder
  /** Filter to specific content types; empty array = all types */
  content_type_filter: ContentObjectType[]
}

export interface NavigationContract {
  hero_section: HeroSection
  content_feed: ContentFeed
  sidebar_widgets: SidebarWidget[]
  dynamic_components: DynamicComponent[]
}

// ── Node Config ───────────────────────────────────────────────────────────────

export interface TaxonomyNodeConfig {
  /**
   * Restricts which content object types can be assigned to this node.
   * Empty or absent = all types allowed.
   */
  allowed_content_types?: ContentObjectType[]

  /**
   * Metadata fields required on content assigned to this node.
   * Keys are field names; values are always true (required flag).
   */
  required_metadata?: Record<string, boolean>

  /**
   * IDs of jv_prompt_recipes available for AI generation in this node's context.
   */
  generation_recipes?: number[]

  /**
   * IDs of jv_sites that content in this node should be published to by default.
   */
  publishing_destinations?: number[]

  /**
   * IDs of authors preferred for content generation, ranked by preference.
   */
  preferred_authors?: number[]

  /**
   * Defines how portal/category pages render content for this node.
   */
  navigation_contract?: NavigationContract
}

// ── Taxonomy Node ─────────────────────────────────────────────────────────────

export interface TaxonomyNode {
  id: number
  taxonomy_type: TaxonomyType
  parent_id: number | null
  /** URL-safe identifier, unique within (taxonomy_type, parent_id) scope */
  slug: string
  /** Phase 1 name column — kept for backward compatibility */
  name: string
  /** Phase 2 human-readable display name */
  title: string | null
  description: string | null
  /** Root = 0, increments with each level */
  depth: number
  sort_order: number
  /** Slash-separated ancestor chain e.g. '/topics/faith-and-life/prayer' */
  materialized_path: string | null
  config: TaxonomyNodeConfig
  is_active: boolean
  created_at: string
  updated_at: string
  /** Populated on tree queries (depth +1 expansion) */
  children?: TaxonomyNode[]
  /** Populated on list queries */
  content_count?: number
}

// ── Content-Taxonomy Mapping ──────────────────────────────────────────────────

export interface ContentTaxonomyMap {
  id: number
  /** jv_articles | jv_prayers | jv_music | etc. */
  object_table: string
  /** SERIAL PK from the content table */
  object_id: number
  taxonomy_node_id: number
  /** One primary assignment per taxonomy_type per content object */
  is_primary: boolean
  assigned_at: string
  assigned_by: string | null
}

// ── API Response Types ────────────────────────────────────────────────────────

/** Response from GET /api/taxonomy */
export type TaxonomyRoots = Record<TaxonomyType, TaxonomyNode[]>

/** Response from GET /api/taxonomy/:type/:slug */
export interface TaxonomyNodeDetail extends TaxonomyNode {
  /** Direct children (depth + 1) */
  children: TaxonomyNode[]
  /** Ancestor chain from root to this node */
  breadcrumb: Array<{ id: number; slug: string; title: string | null; name: string }>
}

/** Response from GET /api/taxonomy/:type/:slug/content */
export interface TaxonomyContentResult {
  node: TaxonomyNode
  descendant_node_ids: number[]
  items: Array<{
    id: number
    object_table: string
    title?: string
    name?: string
    status: string
    created_at: string
  }>
  total: number
  limit: number
  offset: number
}

/** Request body for POST /api/taxonomy */
export interface CreateTaxonomyNodeRequest {
  taxonomy_type: TaxonomyType
  parent_id?: number | null
  slug: string
  name: string
  title?: string
  description?: string
  sort_order?: number
  config?: TaxonomyNodeConfig
}

/** Request body for POST /api/content-taxonomy */
export interface AssignContentTaxonomyRequest {
  object_table: string
  object_id: number
  taxonomy_node_id: number
  is_primary?: boolean
}
