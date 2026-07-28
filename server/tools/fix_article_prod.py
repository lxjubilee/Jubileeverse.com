#!/usr/bin/env python3
"""Fix formatArticleContent on production to use marked.js for markdown rendering."""

path = '/var/www/jubileeverse.com/public/article.html'
with open(path, 'rb') as f:
    raw = f.read()

# Find the marked.js block we inserted and fix the split calls
# Replace any actual newline bytes inside split('...') with proper \n escapes
# The bad line contains: content.split(' followed by 0x0A followed by ')
bad_split  = b"content.split('\x0a')"
good_split = b"content.split('\\n')"
bad_join   = b"lines.slice(1).join('\x0a')"
good_join  = b"lines.slice(1).join('\\n')"

count = 0
if bad_split in raw:
    raw = raw.replace(bad_split, good_split)
    count += 1
if bad_join in raw:
    raw = raw.replace(bad_join, good_join)
    count += 1

# Also fix the outer split('\n\n') if broken
bad_split2  = b"content.split('\x0a\x0a')"
good_split2 = b"content.split('\\n\\n')"
if bad_split2 in raw:
    raw = raw.replace(bad_split2, good_split2)
    count += 1

if count > 0:
    with open(path, 'wb') as f:
        f.write(raw)
    print(f'OK: fixed {count} occurrences')
else:
    print('No bad newlines found - checking state...')
    idx = raw.find(b'const lines = content.split')
    if idx >= 0:
        print('Current state:', repr(raw[idx:idx+120]))
    else:
        print('marked.js block not found at all')
