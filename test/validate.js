'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
execFileSync(process.execPath,['--check','server.js'],{stdio:'inherit'});
const html=fs.readFileSync('public/index.html','utf8');
const start=html.indexOf('<script>');
const end=html.lastIndexOf('</script>');
assert(start>=0&&end>start,'inline browser game script must exist');
new Function(html.slice(start+8,end));
const svg=fs.readFileSync('public/fighters.svg','utf8');
assert(svg.includes('<svg'),'sprite atlas SVG must exist');
for(const player of [1,2]){
 const frames=svg.match(new RegExp('id="p'+player+'f[0-9]+"','g'))||[];
 assert.equal(frames.length,17,'fighter '+player+' must expose 17 sprite poses');
}
process.stdout.write('Server, browser script and 17-pose sprite atlas validation passed.\n');
