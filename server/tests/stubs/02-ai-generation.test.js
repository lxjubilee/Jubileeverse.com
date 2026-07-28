/**
 * MVP Criterion #2 — AI-Assisted Generation
 *
 * An editor can select a taxonomy node and generate a draft Article using a
 * prompt recipe, with metadata auto-populated from the node context.
 *
 * Implementation target: Phase 2
 * Relevant tables: jv_prompt_recipes, jv_articles, jv_taxonomy
 * Relevant lib: lib/jubilee-inspire-persona.js, lib/task-executor.js
 */

describe('MVP Criterion 2: AI-Assisted Generation', () => {
  test.todo(
    'POST /api/generate/article with taxonomy_node_id and recipe_id returns a draft article'
  )

  test.todo(
    'Generated article has title, body_html, word_count, and reading_time auto-populated'
  )

  test.todo(
    'Generated article status is "draft" and version is 1'
  )

  test.todo(
    'Generated article category_id is set from the taxonomy node context'
  )

  test.todo(
    'Generation request with invalid recipe_id returns HTTP 422'
  )

  test.todo(
    'Generation request by a user with role "editor" succeeds'
  )

  test.todo(
    'Generation request by a user without create_content permission returns HTTP 403'
  )
})
