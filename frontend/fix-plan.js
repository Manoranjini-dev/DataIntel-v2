const fs = require('fs');
const file = 'c:/Users/user/Desktop/DataIntel-v2/IMPLEMENTATION_PLAN.md';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');
// Strip the first 18 lines
lines.splice(0, 18);

// Find the TOC and add item 17
const tocIndex = lines.findIndex(l => l.includes('16. [Migration Strategy]'));
if (tocIndex !== -1) {
  lines.splice(tocIndex + 1, 0, '17. [Design System & Unified UI Architecture](#17-design-system--unified-ui-architecture)');
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed file');
