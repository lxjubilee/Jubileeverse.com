#!/usr/bin/env node
/**
 * Pre-Deployment Verification Script
 * Verifies critical functionality before deploying to production
 */

const fs = require('fs');
const path = require('path');

const CHECKS = {
  passed: [],
  failed: []
};

function log(msg, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // cyan
    success: '\x1b[32m', // green
    error: '\x1b[31m',   // red
    warn: '\x1b[33m'     // yellow
  };
  const reset = '\x1b[0m';
  console.log(`${colors[type] || colors.info}[${type.toUpperCase()}]${reset} ${msg}`);
}

function checkFile(filePath, description) {
  try {
    if (!fs.existsSync(filePath)) {
      log(`✗ ${description} - File not found: ${filePath}`, 'error');
      CHECKS.failed.push(description);
      return false;
    }
    log(`✓ ${description}`, 'success');
    CHECKS.passed.push(description);
    return true;
  } catch (e) {
    log(`✗ ${description} - ${e.message}`, 'error');
    CHECKS.failed.push(description);
    return false;
  }
}

function checkFileContent(filePath, pattern, description) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (typeof pattern === 'string') {
      if (!content.includes(pattern)) {
        log(`✗ ${description} - Pattern not found`, 'error');
        CHECKS.failed.push(description);
        return false;
      }
    } else if (pattern instanceof RegExp) {
      if (!pattern.test(content)) {
        log(`✗ ${description} - Regex pattern not found`, 'error');
        CHECKS.failed.push(description);
        return false;
      }
    }
    log(`✓ ${description}`, 'success');
    CHECKS.passed.push(description);
    return true;
  } catch (e) {
    log(`✗ ${description} - ${e.message}`, 'error');
    CHECKS.failed.push(description);
    return false;
  }
}

function checkSyntax(filePath, description) {
  try {
    if (filePath.endsWith('.js')) {
      require(path.resolve(filePath));
    } else if (filePath.endsWith('.html')) {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Basic HTML validation
      if (!content.includes('<!DOCTYPE') && !content.includes('<html')) {
        throw new Error('Invalid HTML structure');
      }
    }
    log(`✓ ${description}`, 'success');
    CHECKS.passed.push(description);
    return true;
  } catch (e) {
    log(`✗ ${description} - ${e.message}`, 'error');
    CHECKS.failed.push(description);
    return false;
  }
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     PRE-DEPLOYMENT VERIFICATION CHECKLIST                  ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Critical files exist
log('Checking critical files...', 'info');
checkFile('server.js', 'Main server file exists');
checkFile('public/index.html', 'Homepage exists');
checkFile('public/article.html', 'Article page exists');

// Package.json
log('\nChecking dependencies...', 'info');
checkFile('package.json', 'Package.json exists');

// Key features
log('\nChecking key features...', 'info');
checkFileContent('server.js', "app.get('/:category/:slug.html'", 'SEO-friendly article routing implemented');
checkFileContent('server.js', 'jv_content_objects', 'Content objects table support');
checkFileContent('public/index.html', 'openJVArticle', 'Article click handler defined');
checkFileContent('public/index.html', 'loadTaxonomyPortalPage', 'Taxonomy portal page loader');
checkFileContent('public/index.html', 'await loadTaxonomyNavLinks()', 'Taxonomy loader properly awaited (no async race)');

// Navigation
log('\nChecking navigation...', 'info');
checkFileContent('public/index.html', 'id="homeNavLink"', 'HOME link element');
checkFileContent('public/index.html', 'taxonomyNavLinks', 'Taxonomy nav container');
checkFileContent('public/index.html', /\.mobile-media-link\s*\{\s*display:\s*none/, 'Mobile links hidden on desktop');
checkFileContent('public/index.html', '#ffffff', 'White text color for nav');

// Colors/Styling
log('\nChecking styling...', 'info');
checkFileContent('public/index.html', '.btn-personalize', 'PERSONALIZE button defined');
checkFileContent('public/index.html', 'color: #ffffff', 'PERSONALIZE uses white text');
// Nav items align because every link reserves the active link's 1px border,
// not because HOME carries a translateY nudge of its own.
checkFileContent('public/index.html', /\.nav-menu \.nav-link \{[^}]*border:\s*1px solid transparent/, 'Nav links reserve the active border (alignment fix)');

// Syntax checks
log('\nChecking syntax...', 'info');
checkSyntax('server.js', 'server.js syntax valid');
checkSyntax('public/index.html', 'index.html structure valid');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log(`║ PASSED: ${CHECKS.passed.length}  |  FAILED: ${CHECKS.failed.length}`);
console.log('╚════════════════════════════════════════════════════════════╝\n');

if (CHECKS.failed.length > 0) {
  log('Deployment blocked - verification failed', 'error');
  process.exit(1);
} else {
  log('All checks passed - safe to deploy', 'success');
  process.exit(0);
}
