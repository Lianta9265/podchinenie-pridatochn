const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash}=require('node:crypto');
const root = process.argv[2] || path.join(__dirname,'..');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),context);
const {DEFAULT_LESSONS:original,OGE_LESSONS:oge}=context.window;
assert.equal(original.filter(l=>!l.teacherReview).length,36);
assert.equal(original.filter(l=>l.teacherReview).length,1);
assert.equal(createHash('sha256').update(JSON.stringify(original.map(l=>({id:l.id,text:l.text})))).digest('hex'),
  '9245faf2d841edc6d25448bc911b26a75ed1008553ba216ddad3501d280c095d','All 37 previous texts unchanged');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
assert.equal(digest(original),'ab60483b99552f89680c9dd9fcb1fd879e84dd74f25605c34e5a541b8765c0df','Complete original bank unchanged');
assert.equal(digest(oge.filter(l=>[38464,38560,38607,43368].includes(l.source.problemId))),
  '2c9a5c1cf54adb8645ebd14fe89dbb199cf0df452c0a63b534b8e7581c6a1c0a','Four approved OGE exercises unchanged');
assert.deepEqual(Array.from(oge,l=>l.source.problemId).sort(),[28539,28720,28854,38422,38464,38519,38560,38607,38609,43368]);
assert(oge.every(l=>!l.teacherReview&&l.collection==='oge'),'All ten are playable');
assert.equal(digest(oge.map(l=>({id:l.source.problemId,text:l.text})).sort((a,b)=>a.id-b.id)),
  '66c5a1db63b9183da7388e41ad0efce15cda52b54dbc0a27b582086432f61e4a','All ten source sentences retained verbatim');
const get=id=>oge.find(l=>l.source.problemId===id);
const quantityRest=JSON.parse(JSON.stringify(get(28854)));delete quantityRest.parts[0].base;delete quantityRest.note;
assert.equal(digest(quantityRest),'1cfec0c305b13a55f2dc49e57d2b4b92ada8443c7a4e59a7fc98cb892a72b009','Other parts, schemes, anchors and source of 28854 unchanged');
const bases=(id,part)=>Array.from(get(id).parts.find(p=>p.id===part).base,r=>[r.w,r.role]);
assert.deepEqual(bases(28854,'m'),[['немало','s'],['примеров','s']]);
assert.deepEqual(bases(28720,'m'),[['особенность','s'],['состоит','p']]);
assert.deepEqual(bases(28720,'a'),[['тело','s'],['покрыто','p']]);
assert.deepEqual(bases(28720,'b'),[['которые','s'],['переливаются','p']]);
assert.deepEqual(bases(38422,'m'),[['учёные','s'],['считают','p']]);
assert.deepEqual(bases(38422,'a'),[['совы','s'],['видят','p']]);
assert.deepEqual(bases(38422,'b'),[['тело','s'],['излучает','p']]);
assert.deepEqual(bases(38609,'m'),[['Получается','one']]);
assert.deepEqual(bases(38609,'a'),[['нет','one']]);
assert.deepEqual(bases(38609,'b'),[['уборка','s'],['не','p'],['проводилась','p'],['бы','p']]);
assert.deepEqual(bases(28539,'m'),[['достаточно','one']]);
assert.deepEqual(bases(28539,'a'),[['подавить','one']]);
assert.deepEqual(bases(28539,'c'),[['эксперты','s'],['предостерегают','p']]);
assert.deepEqual(bases(28539,'b'),[['ген','s'],['может','p'],['передаться','p']]);
assert.equal(get(28539).kind,'mixed');
assert.deepEqual(Array.from(get(28539).edges,e=>e.parent),['m','c']);
assert.deepEqual(bases(38519,'m'),[['предположение','s'],['напрашивается','p']]);
assert.deepEqual(bases(38519,'b'),[['свечение','s'],['отпугивает','p'],['приманивает','p']]);
assert.equal(get(38519).kind,'parallel');
assert.deepEqual(bases(38519,'a'),[['нет','one']]);
assert.equal(get(38519).parts.find(p=>p.id==='a').basisReview,undefined);
assert.deepEqual(Array.from(get(38519).links,r=>[r.w,r.part]),[['Если','a'],['что','b']]);
assert.deepEqual(Array.from(get(38519).edges,r=>[r.target,r.from.w,r.question]),[['a','напрашивается','при каком условии?'],['b','предположение','какое?']]);
for(const id of [28720,38422,38609])assert.equal(get(id).kind,'sequential');
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
  for(const edge of l.edges){
    assert(locate(edge.from)>=0,l.id+' anchor exists');
    if(edge.parent)assert.equal(owners.get(locate(edge.from)),edge.parent,l.id+' actual parent of dependency');
    if([28720,38422,38609].includes(l.source?.problemId))assert.equal(owners.get(locate(edge.from)),edge.target==='a'?'m':'a',l.id+' sequential chain');
  }
  for(const phrase of l.phrases||[])assert.equal(new Set(phrase.map(r=>owners.get(locate(r)))).size,1,l.id+' phrase in one part');
}
// Both examples must have multiple separated fragments with shared ownership.
assert.equal(original[0].fragments.filter(f=>f.part==='a').length,2);
assert.equal(original[1].fragments.filter(f=>f.part==='m').length,3);
assert.equal(oge.find(l=>l.id==='oge38560').fragments.filter(f=>f.part==='a').length,2);
console.log('PASS: unchanged original bank and four approved OGE keys; all 10 OGE cards, quantity subject, mixed parents, one-member predicate and complete fragment ownership.');
