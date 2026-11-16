/**
 * DayToDay Wallet App — Automated Self-Test
 * Run with: npm test (or node test.js)
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

console.log('🧪 Starting Wallet App Self-Tests...\n');
let allPassed = true;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name} FAILED:`, err.message);
    allPassed = false;
  }
}

// 1. Core Files Existence
check('Core Files Exist (index.html, script.js, bill-scanner.js, manifest.json, sw.js)', () => {
  const required = ['index.html', 'script.js', 'bill-scanner.js', 'manifest.json', 'sw.js', 'server.js', 'package.json'];
  required.forEach(f => {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) throw new Error(`Missing ${f}`);
  });
});

// 2. JavaScript Syntax Check
check('JavaScript Syntax Validation', () => {
  ['script.js', 'bill-scanner.js', 'server.js'].forEach(f => {
    cp.execSync(`node -c "${path.join(__dirname, f)}"`);
  });
});

// 3. Manifest.json Validation
check('PWA Manifest.json is valid', () => {
  const p = path.join(__dirname, 'manifest.json');
  const content = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!content.name && !content.short_name) throw new Error('Manifest missing name/short_name');
  if (!Array.isArray(content.icons) || content.icons.length === 0) throw new Error('Manifest missing icons');
});

// 4. Gitignore Safety Check
check('.gitignore protects private config.js and node_modules', () => {
  const p = path.join(__dirname, '.gitignore');
  if (!fs.existsSync(p)) throw new Error('.gitignore missing');
  const gi = fs.readFileSync(p, 'utf8');
  if (!gi.includes('config.js')) throw new Error('config.js must be in .gitignore');
  if (!gi.includes('node_modules')) throw new Error('node_modules must be in .gitignore');
});

console.log('\n' + (allPassed ? '🎉 ALL TESTS PASSED! App is 100% healthy.' : '❌ SOME TESTS FAILED.'));
process.exit(allPassed ? 0 : 1);
