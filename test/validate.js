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
for(const state of ["p.kind==='grab'","p.kind==='counter'","p.kind==='special'","p.kind==='heavyPunch'","p.kind==='heavyKick'","p.kind==='kick'","p.dodgeTimer>0","p.crouch","p.run","p.block","p.stun>0","p.y<0","moveVx*face<-.5","p.hp<=0","p.victory"]){
 assert(html.includes(state),'animation state must be mapped to a sprite clip: '+state);
}
assert(html.includes('id="voice"'),'announcer voice must be user-toggleable');
assert(html.includes('u.volume=Math.max(0,Math.min(1,effectsVolume))'),'announcer voice must follow the effects volume control');
assert(html.includes("function clipFrame(frames,phase)"),'sprite animation clips must advance through timed frames');
process.stdout.write('Server, browser script, 17 sprite poses and animation state mappings validated.\\n');
