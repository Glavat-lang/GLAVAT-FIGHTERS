'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
execFileSync(process.execPath,['--check','server.js'],{stdio:'inherit'});
const html=fs.readFileSync('public/index.html','utf8');
const match=html.match(/<script>([\\s\\S]*?)<\\/script>/);
assert(match,'inline browser game script must exist');
new Function(match[1]);
const svg=fs.readFileSync('public/fighters.svg','utf8');
assert.match(svg,/<svg\\b/);
for(const player of [1,2]){
 const frames=svg.match(new RegExp('id="p'+player+'f[0-9]+"','g'))||[];
 assert.equal(frames.length,17,'fighter '+player+' must expose 17 sprite poses');
}
process.stdout.write('Server, browser script and 17-pose sprite atlas validation passed.\\n');
