/**
 * phase7-personas.test.js — Phase 7 Author Management System stubs
 *
 * Acceptance criteria from the Phase 7 spec:
 *   AC-P1: Author profile CRUD
 *   AC-P2: Contextual author chat
 *   AC-P3: Author-taxonomy binding
 *   AC-P4: Convert chat output to draft
 *   AC-P5: AuthorForm UI
 */

describe('AC-P1: Author profile CRUD', () => {
  test.todo('POST /api/authors creates author with voice_profile extension_data')
  test.todo('POST /api/authors returns 403 without manage_authors permission')
  test.todo('GET /api/authors returns list of author content objects')
  test.todo('PUT /api/authors/:id updates mission_statement and creates revision')
  test.todo('PUT /api/authors/:id with boundaries array persists as string[]')
  test.todo('PUT /api/authors/:id creates audit log entry with event_type=author.updated')
  test.todo('author_operator role can POST /api/authors but editor role cannot (403)')
})

describe('AC-P2: Contextual author chat', () => {
  test.todo('POST /api/author/chat returns assistant response text')
  test.todo('POST /api/author/chat creates jv_author_chat_sessions row on first message')
  test.todo('POST /api/author/chat appends user+assistant messages to existing session')
  test.todo('GET /api/author/chat/history returns messages array for user+author+node key')
  test.todo('GET /api/author/chat/history returns empty messages when no session exists')
  test.todo('DELETE /api/author/chat/history clears session for user+author+node')
  test.todo('Chat system prompt includes taxonomy context summary')
  test.todo('Chat system prompt includes author voice_profile and boundaries')
})

describe('AC-P3: Author-taxonomy binding', () => {
  test.todo('POST /api/generate with author_id differing from preferred_author logs author.override audit')
  test.todo('POST /api/generate with matching preferred_author does NOT log author.override')
  test.todo('GET /api/authors/usage returns content_count per author per taxonomy branch')
  test.todo('GET /api/authors/usage requires admin or site_owner role (non-admin gets 403)')
  test.todo('author.override audit entry contains override_reason when provided')
  test.todo('author.override audit entry contains preferred_authors array in details')
})

describe('AC-P4: Convert chat output to draft', () => {
  test.todo('POST /api/content with meta_data.generated_by=ai_chat preserves author_id attribution')
  test.todo('Converted draft appears in content list with author_id set')
  test.todo('Converting chat output fires content.created audit event')
})

describe('AC-P5: AuthorForm UI', () => {
  test.todo('AuthorForm renders for object_type=author in InlineEditorPanel')
  test.todo('AuthorForm saves voice_profile changes via updateContent mutation')
})
