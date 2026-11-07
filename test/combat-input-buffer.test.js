'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','public','index.html'),'utf8');
assert.match(html,/if\(a\.cool>0\)\{a\.bufferedAttack=kind;a\.bufferExpires=performance\.now\(\)\+180;return\}/,'attacks pressed during recovery must be buffered briefly');
assert.match(html,/if\(p\.bufferedAttack\)\{if\(performance\.now\(\)>p\.bufferExpires\)p\.bufferedAttack=null;else if\(p\.cool<=0&&p\.stun<=0&&/,'buffered attacks must expire and wait for recovery to finish');
assert.match(html,/const buffered=p\.bufferedAttack;p\.bufferedAttack=null;doAttack\(i,buffered\)/,'a buffered attack must be consumed exactly once');
process.stdout.write('Combat input buffering checks passed.\\n');
