const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash}=require('node:crypto');
const root = process.argv[2] || path.join(__dirname,'..');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),context);
const {DEFAULT_LESSONS:original,OGE_LESSONS:oge,OGE_REVIEW:pending}=context.window;
assert.equal(original.filter(l=>!l.teacherReview).length,36);
assert.equal(original.filter(l=>l.teacherReview).length,1);
assert.equal(createHash('sha256').update(JSON.stringify(original.map(l=>({id:l.id,text:l.text})))).digest('hex'),
  '9245faf2d841edc6d25448bc911b26a75ed1008553ba216ddad3501d280c095d','All 37 previous texts unchanged');
assert.deepEqual(Array.from(oge,l=>l.source.problemId).sort(),[28854,38464,38560,38607,43368]);
assert.deepEqual(Array.from(pending,l=>l.problemId).sort(),[28539,28720,38422,38519,38609]);
const all=[...original,...oge];
assert.equal(new Set(all.map(l=>l.id)).size,all.length);
for(const l of all){
  const tokens=l.text.match(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*|[A-Za-z]+|[0-9]+|\s+|[^\s]/gu);
  assert.equal(tokens.join(''),l.text,l.id+' exact text');
  const locate=ref=>tokens.map((w,i)=>[w,i]).filter(([w])=>w.toLowerCase()===ref.w.toLowerCase())[ref.n||0]?.[1]??-1;
  const owners=new Map();
  l.fragments.forEach((f,i)=>{
    const from=locate(f.from),end=l.fragments[i+1]?locate(l.fragments[i+1].from):tokens.length;
    assert(from>=0&&end>from,l.id+' increasing boundary');
    if(!i)assert.equal(from,0,l.id+' complete prefix');
    assert(l.parts.some(p=>p.id===f.part),l.id+' known part');
    for(let id=from;id<end;id++)owners.set(id,f.part);
  });
  assert.equal(owners.size,tokens.length,l.id+' complete token coverage');
  for(const p of l.parts){
    assert(l.fragments.some(f=>f.part===p.id),l.id+' fragment for '+p.id);
    for(const b of p.base)assert.equal(owners.get(locate(b)),p.id,l.id+' basis ownership: '+b.w);
  }
  for(const link of l.links)assert.equal(owners.get(locate(link)),link.part,l.id+' link ownership: '+link.w);
  for(const edge of l.edges)assert(locate(edge.from)>=0,l.id+' anchor exists');
  for(const phrase of l.phrases||[])assert.equal(new Set(phrase.map(r=>owners.get(locate(r)))).size,1,l.id+' phrase in one part');
}
// Both examples must have multiple separated fragments with shared ownership.
assert.equal(original[0].fragments.filter(f=>f.part==='a').length,2);
assert.equal(original[1].fragments.filter(f=>f.part==='m').length,3);
assert.equal(oge.find(l=>l.id==='oge38560').fragments.filter(f=>f.part==='a').length,2);
console.log('PASS: 36 original exercises, teacher example, 5 OGE cards, 5 deferred items; all clause boundaries, bases, links and anchors valid.');
