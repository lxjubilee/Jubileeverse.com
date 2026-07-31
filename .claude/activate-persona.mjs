#!/usr/bin/env node
// SessionStart hook: activate an Inspire Family persona for this workspace.
//
// Emits the persona's activation prompt plus its office model overlay as
// SessionStart additionalContext, so every session in this repo opens already
// speaking as that persona.
//
// Persona: PERSONA_SLUG env var, else the DEFAULT_SLUG below.
// Credentials: PERSONA_KEY from server/.env (line 1, behind a UTF-8 BOM).
// Cache: .claude/cache/, 24h TTL, so session start costs no network call and
// still works offline. A failed refetch falls back to stale cache rather than
// dropping the persona.
//
// Manual test:
//   node .claude/activate-persona.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hookSpecificOutput.additionalContext.slice(0,400)))"

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SLUG = 'amir'
const API = 'https://api.inspirepersonas.com/personas'
const TTL_MS = 24 * 60 * 60 * 1000

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)
const ENV_FILE = path.join(REPO, 'server', '.env')
const CACHE_DIR = path.join(HERE, 'cache')

// A hook must never block a session. Every failure path emits empty context.
function emit(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context || '' },
    suppressOutput: true,
  }))
  process.exit(0)
}

function personaKey() {
  // No ^ anchor: line 1 carries a UTF-8 BOM, which defeats column-anchored matching.
  const raw = fs.readFileSync(ENV_FILE, 'utf8')
  const m = raw.match(/PERSONA_KEY\s*=\s*"?([^"\r\n]+)"?/)
  return m ? m[1].trim() : null
}

async function fetchCached(url, cacheFile, key) {
  try {
    const st = fs.statSync(cacheFile)
    if (st.size > 0 && Date.now() - st.mtimeMs < TTL_MS) return fs.readFileSync(cacheFile, 'utf8')
  } catch {}
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 25_000)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ac.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    if (!body) throw new Error('empty body')
    fs.writeFileSync(cacheFile, body, 'utf8')
    return body
  } catch {
    // Stale cache beats no persona.
    try { return fs.readFileSync(cacheFile, 'utf8') } catch { return '' }
  }
}

async function main() {
  const slug = (process.env.PERSONA_SLUG || DEFAULT_SLUG).replace(/[^a-z0-9-]/gi, '')
  if (!slug) emit('')

  let key
  try { key = personaKey() } catch { emit('') }
  if (!key) emit('')

  try { fs.mkdirSync(CACHE_DIR, { recursive: true }) } catch { emit('') }

  const prompt = await fetchCached(`${API}/${slug}/prompt`, path.join(CACHE_DIR, `${slug}.prompt.md`), key)
  if (!prompt) emit('')

  // The persona record names which office overlay composes over the kernel.
  let overlay = ''
  const recordText = await fetchCached(`${API}/${slug}`, path.join(CACHE_DIR, `${slug}.json`), key)
  try {
    const model = JSON.parse(recordText).defaultModel
    if (model) {
      overlay = await fetchCached(`${API}/models/${model}.md`, path.join(CACHE_DIR, `model_${model}.md`), key)
    }
  } catch {}

  emit(overlay ? `${prompt}\n\n---\n\n${overlay}` : prompt)
}

main().catch(() => emit(''))
