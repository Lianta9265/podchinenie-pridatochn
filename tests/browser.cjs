const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=process.argv[2]||path.join(__dirname,'..');
const out=process.env.NITI_TEST_OUTPUT||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'niti-browser-'));
fs.mkdirSync(out,{recursive:true});
const chrome=process.env.NITI_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
  if(!['index.html','app.js','data.js','styles.css'].includes(name)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,name)));
});
let browser,ws;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${path.join(out,'chrome-profile-'+Date.now())}`,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let endpoint='';
  browser.stderr.on('data',buf=>{const match=String(buf).match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)endpoint=match[1];});
  for(let i=0;i<100&&!endpoint;i++)await sleep(100);
  assert(endpoint,'Chrome DevTools endpoint');
  const port=new URL(endpoint).port;
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:'PUT',signal:AbortSignal.timeout(10000)})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let seq=0;const calls=new Map(),errors=[];
  ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const pending=calls.get(msg.id);calls.delete(msg.id);msg.error?pending.reject(Error(msg.error.message)):pending.resolve(msg.result);}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;calls.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<100;i++){if(await evaluate('!!window.NITI_DIAGNOSTICS'))break;await sleep(100);}
  await evaluate(`window.qa={
    assert(value,message){if(!value)throw Error(message);},
    click(selector){const el=document.querySelector(selector);this.assert(el,'Missing '+selector);el.click();},
    filter(value){const el=document.getElementById('kind-filter');el.value=value;el.dispatchEvent(new Event('change'));},
    select(id){const l=[...window.DEFAULT_LESSONS,...window.OGE_LESSONS];this.click('[data-index="'+l.findIndex(x=>x.id===id)+'"]');},
    mark(includePreps=false,fault=null){
      const d=NITI_DIAGNOSTICS,l=d.getLesson(),keys=d.getKeys(),colors=['d','m','c','a','b'];
      const mapping=Object.fromEntries(l.parts.map((p,i)=>[p.id,colors[i]]));
      this.assert(!document.querySelector('.clause-highlight'),'No early highlight');
      for(const [id,link] of keys.links){
        if(!includePreps&&keys.optionalPreps.includes(id))continue;
        if(d.getState().linkMarks.has(id))continue;
        this.click('[data-color="'+mapping[link.part]+'"]');this.click('#sentence [data-id="'+id+'"]');
      }
      this.click('#go-to-bases');
      this.assert(!document.querySelector('.clause-highlight'),'No highlight before bases');
      for(const [id,base] of keys.bases){
        this.click('[data-color="'+mapping[base.partId]+'"]');
        this.click('[data-role="'+(base.role==='s'?'s':'p')+'"]');
        this.click('#sentence [data-id="'+id+'"]');
      }
      if(l.id==='oge28854'){
        const ids=['немало','примеров'].map(w=>d.tokens().find(t=>t.value===w).id);
        const word=id=>'#sentence [data-id="'+id+'"]';
        this.click('[data-color="'+mapping.m+'"]');this.click('[data-role="s"]');
        // The previous one-word predicate must fail; both words are subjects.
        ids.forEach(id=>this.click(word(id)));this.click('[data-role="p"]');this.click(word(ids[0]));this.click('#check-marking-top');
        this.assert(d.getState().step===1&&!document.querySelector('.clause-highlight'),'Old erroneous predicate rejected');
        this.click(word(ids[0]));this.click('[data-role="s"]');ids.forEach(id=>this.click(word(id)));
        this.click(word(ids[1]));this.click('#check-marking-top');this.assert(d.getState().step===1,'Both subject words required');this.click(word(ids[1]));
        this.click('[data-color="a"]');this.click(word(ids[1]));this.click('#check-marking-top');this.assert(d.getState().step===1,'Subject words must share one color');
        this.click('[data-color="'+mapping.m+'"]');this.click(word(ids[1]));
      }
      if(l.id==='oge38519'){
        const id=d.tokens().find(t=>t.value==='нет').id;
        this.assert(!keys.bases.some(([baseId])=>baseId===id),'No invented key for ellipsis');
        this.assert(document.getElementById('instruction').textContent.includes('преподавателем'),'Ellipsis guidance');
        this.click('[data-color="'+mapping.a+'"]');this.click('[data-role="p"]');this.click('#sentence [data-id="'+id+'"]');
        this.assert(!d.getState().basisMarks.has(id),'Elliptic element is explained, not marked as predicate');
        const linkId=keys.links.find(([,link])=>link.part==='a')[0];
        this.click('#back-to-conjunctions');this.click('[data-color="'+mapping.m+'"]');this.click('#sentence [data-id="'+linkId+'"]');this.click('#go-to-bases');this.click('#check-marking-top');
        this.assert(d.getState().step===1&&!document.querySelector('.clause-highlight'),'Elliptic clause requires a distinct chosen color');
        this.click('#back-to-conjunctions');this.click('[data-color="'+mapping.a+'"]');this.click('#sentence [data-id="'+linkId+'"]');this.click('#go-to-bases');
      }
      if(l.id==='oge28539'){
        const id=d.tokens().find(t=>t.value==='однако').id;
        this.click('#back-to-conjunctions');this.click('[data-color="'+mapping.c+'"]');this.click('#sentence [data-id="'+id+'"]');this.click('#go-to-bases');this.click('#check-marking-top');
        this.assert(d.getState().step===1,'Coordinating conjunction not accepted as subordinate');
        this.click('#back-to-conjunctions');this.click('[data-color="'+mapping.c+'"]');this.click('#sentence [data-id="'+id+'"]');this.click('#go-to-bases');
      }
      if(fault){
        const [id,key]=fault==='role'?keys.bases[0]:keys.links.find(([id])=>!keys.optionalPreps.includes(id));
        const correct=mapping[key.partId||key.part];
        if(fault==='role'){
          this.click('[data-color="'+correct+'"]');this.click('[data-role="'+(key.role==='s'?'p':'s')+'"]');this.click('#sentence [data-id="'+id+'"]');
        }else{
          this.click('#back-to-conjunctions');this.click('[data-color="'+colors.find(c=>c!==correct)+'"]');this.click('#sentence [data-id="'+id+'"]');this.click('#go-to-bases');
        }
        this.click('#check-marking-top');this.assert(d.getState().step===1,'Invalid '+fault+' rejected');this.assert(!document.querySelector('.clause-highlight'),'No highlight on invalid '+fault);
        if(fault==='role'){
          this.click('[data-color="'+correct+'"]');this.click('[data-role="'+(key.role==='s'?'s':'p')+'"]');this.click('#sentence [data-id="'+id+'"]');
        }else{
          this.click('#back-to-conjunctions');this.click('[data-color="'+correct+'"]');this.click('#sentence [data-id="'+id+'"]');this.click('#go-to-bases');
        }
      }
      this.click('#check-marking-top');
      this.assert(d.getState().step===2,l.id+' marking rejected: '+document.getElementById('feedback').textContent);
      this.assert(!l.source||!document.body.innerText.includes(l.source.claim),'Exam assertion not shown before answer');
      this.assert(document.querySelectorAll('[data-shape]').length===(l.kind==='mixed'?4:3),'Choice count');
      this.assert(Boolean(document.querySelector('[data-type="mixed"]'))===(l.kind==='mixed'),'Old choices unchanged');
      this.assert(document.getElementById('sentence').textContent===l.text,'Sentence unchanged '+l.id);
      const owners=new Map(keys.tokenParts);
      for(const el of document.querySelectorAll('#sentence [data-id]')){
        const span=el.closest('.clause-highlight');this.assert(span,'Every word highlighted '+l.id);
        this.assert(span.dataset.part===owners.get(+el.dataset.id),'Word belongs to expected clause');
        this.assert(span.dataset.color===mapping[span.dataset.part],'Student-chosen color');
        const fill=getComputedStyle(span).backgroundColor;
        const alpha=Number(fill.split(',').at(-1).replace(')',''));
        this.assert(fill.startsWith('rgba(')&&alpha>=0.18&&alpha<=0.24, 'Translucent pastel: '+fill);
      }
      return {id:l.id,kind:l.kind};
    },
    connect(){
      const keys=NITI_DIAGNOSTICS.getKeys();this.click('#toggle-threads');
      for(const [part,e] of keys.edges){this.click('#sentence [data-id="'+e.anchor+'"]');this.click('#thread-board [data-part="'+part+'"]');}
      this.assert(document.querySelectorAll('.clause-card').length===keys.edges.length,'Only subordinate cards on thread board');
      for(const [part,e] of keys.edges){
        this.assert(NITI_DIAGNOSTICS.getState().edges[part]===e.anchor,'Correct anchor for '+part);
        const q=document.querySelector('#thread-board [data-part="'+part+'"] .thread-question');
        this.assert(q?.textContent===e.question,'Correct question for '+part);
        this.assert(parseFloat(getComputedStyle(q).fontSize)>=17,'Large question');
      }
    },
    finish(kind){this.click('[data-shape="'+kind+'"]');this.click('[data-type="'+kind+'"]');this.click('#check-button');this.assert(NITI_DIAGNOSTICS.getState().step===3,'Finished exercise');}
  }; true`);
  const counts=await evaluate(`({base:NITI_DIAGNOSTICS.getOrder().length,markers:document.querySelectorAll('[data-color]').length})`);
  assert.deepEqual(counts,{base:36,markers:5});
  // Rejected markings cannot reveal backgrounds; correction preserves valid marks.
  await evaluate(`qa.click('#go-to-bases');qa.click('#check-marking-top');qa.assert(NITI_DIAGNOSTICS.getState().step===1,'Empty check rejected');qa.assert(!document.querySelector('.clause-highlight'),'Failed check hidden');qa.click('#back-to-conjunctions');true`);
  const oldIds=await evaluate(`window.DEFAULT_LESSONS.filter(l=>!l.teacherReview).map(l=>l.id)`);
  for(const id of oldIds){
    const r=await evaluate(`qa.select(${JSON.stringify(id)});qa.mark(false,${JSON.stringify(id==='n01'?'linkColor':id==='n02'?'role':null)});`);
    if(id==='n01'){
      await evaluate(`qa.click('[data-shape="parallel"]');qa.click('[data-type="parallel"]');qa.click('#check-button');qa.assert(NITI_DIAGNOSTICS.getState().step===2,'Wrong scheme rejected');true`);
    }
    await evaluate(`qa.finish(${JSON.stringify(r.kind)});true`);
  }
  console.log('PASS: all 36 previous exercises completed with arbitrary marker colors.');
  await evaluate(`qa.click('#repeat-errors');qa.assert(document.querySelectorAll('.lesson-item').length===2,'Repeat errors');qa.click('#repeat-errors');true`);
  for(const kind of ['sequential','parallel','homogeneous']){
    const count=await evaluate(`qa.filter('${kind}');qa.assert(NITI_DIAGNOSTICS.getOrder().every(i=>window.DEFAULT_LESSONS[i]?.kind==='${kind}'),'Original filter isolation');NITI_DIAGNOSTICS.getOrder().length;`);
    assert(count>0);
  }
  await evaluate(`qa.filter('oge');qa.assert(NITI_DIAGNOSTICS.getOrder().length===10,'Ten OGE cards');qa.assert(document.querySelectorAll('.lesson-item').length===10,'All ten listed');qa.assert(!document.getElementById('oge-review'),'No excluded list');true`);
  await evaluate(`const orders=new Set();for(let i=0;i<5;i++){qa.click('#reshuffle');orders.add(NITI_DIAGNOSTICS.getOrder().join(','));}qa.assert(orders.size>1,'OGE order is shuffled');true`);
  const ogeIds=await evaluate(`window.OGE_LESSONS.map(l=>l.id)`);
  for(const id of ogeIds){
    const r=await evaluate(`qa.select('${id}');qa.mark();`);
    await evaluate(`qa.connect();true`);await sleep(40);
    await evaluate(`qa.assert(document.querySelectorAll('.thread-path').length===NITI_DIAGNOSTICS.getKeys().edges.length,'All threads drawn');true`);
    if(id==='oge28539')await evaluate(`qa.click('[data-shape="parallel"]');qa.click('[data-type="parallel"]');qa.click('#check-button');qa.assert(NITI_DIAGNOSTICS.getState().step===2,'Artificial parallel type rejected');true`);
    await evaluate(`qa.finish('${r.kind}');true`);
    if(id==='oge28854')await evaluate(`qa.assert([...document.querySelectorAll('#sentence .role-s')].filter(el=>['немало','примеров'].includes(el.textContent)).length===2,'Two single underlines');true`);
    if(id==='oge28539'){
      await evaluate(`qa.assert(document.querySelectorAll('.mixed-branch').length===2,'Two real main branches');qa.assert(document.querySelector('.mixed-coordination').textContent.includes('однако'),'Coordination retained');qa.click('[data-layout="horizontal"]');qa.assert(document.querySelectorAll('.mixed-branch').length===2,'Horizontal solution preserves roots');true`);
      await evaluate(`document.getElementById('solution').scrollIntoView({behavior:'instant'});true`);
      fs.writeFileSync(path.join(out,'desktop-oge28539-solution.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
    }
    if(id==='oge38519')await evaluate(`qa.assert(document.querySelector('.teacher-note').textContent.includes('эллипсис'),'Teacher ellipsis explanation');qa.assert(NITI_DIAGNOSTICS.getLesson().text.startsWith('Если нет, то'),'Original ellipse unchanged');true`);
    if(['oge28720','oge38422','oge38609','oge28539'].includes(id))await evaluate(`qa.assert(document.querySelector('.exam-answer').textContent.includes('— неверно'),'False original assertion explained only after answer');true`);
  }
  await evaluate(`qa.assert(document.getElementById('progress').textContent==='10/10','Ten of ten progress');qa.click('#repeat-errors');qa.assert(document.querySelectorAll('.lesson-item').length===3,'OGE error review');qa.click('#repeat-errors');true`);
  // Both modes work on every exam card, including the separate main root and ellipsis.
  for(const id of ogeIds){
    await evaluate(`qa.select('${id}');qa.click('#mode-demo');qa.click('#check-button');qa.click('#check-button');qa.click('#check-button');qa.assert(document.querySelector('.clause-highlight'),'Demo highlights for ${id}');qa.assert(document.querySelectorAll('.clause-card').length===NITI_DIAGNOSTICS.getKeys().edges.length,'Demo board for ${id}');qa.click('#mode-play');true`);
  }
  console.log('PASS: all 10 OGE exercises, real dependency threads, corrected quantity subject, mixed structure, ellipsis and both modes.');
  for(const id of ['oge28539','oge38519']){
    await evaluate(`qa.select('${id}');qa.mark();qa.connect();true`);await sleep(650);
    await evaluate(`document.querySelector('.drag-handle').scrollIntoView({behavior:'instant',block:'center'});true`);await sleep(80);
    const p=await evaluate(`(()=>{const r=document.querySelector('.drag-handle').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x+30,y:p.y+25});
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x+30,y:p.y+25});await sleep(60);
    await evaluate(`qa.assert(Object.keys(NITI_DIAGNOSTICS.getState().positions).length,'Special card drag: ${id}');qa.assert(document.querySelectorAll('.thread-path').length===2,'Threads follow drag: ${id}');true`);
  }
  // Include each optional preposition as well as accepting the relative word alone.
  for(const id of ['n01','n12','n28','n33','oge43368']){
    await evaluate(`qa.filter('${id.startsWith('oge')?'oge':'all'}');qa.select('${id}');qa.mark(true);true`);
  }
  // Wrong link color and wrong grammatical role must each block highlighting.
  await evaluate(`qa.filter('all');qa.select('n01');qa.click('[data-color="a"]');qa.click('#sentence [data-id="'+NITI_DIAGNOSTICS.getKeys().links[0][0]+'"]');qa.click('#go-to-bases');qa.click('#check-marking-top');qa.assert(!document.querySelector('.clause-highlight'),'No hint after invalid color');qa.assert(NITI_DIAGNOSTICS.getState().step===1,'Bad markings blocked');true`);
  // Demonstration reaches the reveal only at its final step.
  await evaluate(`qa.click('#mode-demo');qa.assert(!document.querySelector('.clause-highlight'),'Demo initial');qa.click('#check-button');qa.assert(!document.querySelector('.clause-highlight'),'Demo links');qa.click('#check-button');qa.assert(!document.querySelector('.clause-highlight'),'Demo bases');qa.click('#check-button');qa.assert(document.querySelector('.clause-highlight'),'Demo reveal');qa.click('#clear-step');qa.assert(!document.querySelector('.clause-highlight'),'Demo back hides reveal');qa.click('#mode-play');true`);
  // Real pointer events: link a clause, drag its card and check the SVG follows.
  await evaluate(`qa.select('n02');qa.mark();qa.click('#toggle-threads');const e=NITI_DIAGNOSTICS.getKeys().edges[0];qa.click('#sentence [data-id="'+e[1].anchor+'"]');qa.click('#thread-board [data-part="'+e[0]+'"]');true`);
  await sleep(650);
  await evaluate(`document.querySelector('.drag-handle').scrollIntoView({behavior:'instant',block:'center'});true`);
  await sleep(100);
  const drag=await evaluate(`(()=>{const r=document.querySelector('.drag-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:drag.x,y:drag.y});
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:drag.x+25,y:drag.y+25});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:drag.x+25,y:drag.y+25});
  await sleep(100);
  await evaluate(`qa.assert(Object.keys(NITI_DIAGNOSTICS.getState().positions).length,'Card dragged');qa.assert(document.querySelector('.thread-path'),'Thread rendered');true`);
  await evaluate(`document.getElementById('work-area').scrollIntoView();true`);await sleep(100);
  fs.writeFileSync(path.join(out,'desktop-n02.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  // Narrow screens: long clauses wrap naturally, without expanding the document.
  for(const width of [390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    for(const id of ['n01','n02',...ogeIds]){
      const dimensions=await evaluate(`qa.filter('${id.startsWith('oge')?'oge':'all'}');qa.select('${id}');qa.mark();({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
      assert(dimensions.scroll<=dimensions.width+1,`${id} horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
      await evaluate(`document.getElementById('work-area').scrollIntoView();true`);await sleep(50);
      if(width===390&&['n01','n02','oge28854','oge28539','oge38519'].includes(id))fs.writeFileSync(path.join(out,'mobile-'+id+'.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
      if(['oge28539','oge38519'].includes(id)){
        await evaluate(`document.getElementById('answer-area').scrollIntoView({behavior:'instant'});true`);await sleep(60);
        if(width===390)fs.writeFileSync(path.join(out,'mobile-'+id+'-choices.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
        await evaluate(`qa.finish('${id==='oge28539'?'mixed':'parallel'}');qa.click('[data-layout="horizontal"]');document.getElementById('solution').scrollIntoView({behavior:'instant'});true`);await sleep(60);
        const size=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
        assert(size.scroll<=size.width+1,'Special solution overflow: '+id+' at '+width);
        if(width===390)fs.writeFileSync(path.join(out,'mobile-'+id+'-solution.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
      }
    }
  }
  console.log('PASS: optional prepositions, failed checks, both modes, draggable threads, 390px and 320px layouts.');
  await evaluate(`qa.click('#rules-main');qa.assert(document.getElementById('rules-dialog').open,'Rules opened');qa.assert(document.querySelector('#rules-dialog li').textContent.startsWith('Союзы'),'Rules order');qa.click('#rules-ok');qa.click('#special-lesson');qa.assert(NITI_DIAGNOSTICS.getLesson().id==='n37','Teacher example preserved');true`);
  const saved=await evaluate(`JSON.parse(localStorage.getItem('niti-smysla-oge-v5'))`);
  assert(saved.n01.done&&saved.n01.hadError);assert(saved.oge38607.done);
  await cdp('Page.reload');
  for(let i=0;i<100;i++){await sleep(30);if(await evaluate('!!window.NITI_DIAGNOSTICS'))break;}
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('niti-smysla-oge-v5'))`),saved);
  assert.deepEqual(errors,[]);
  console.log('PASS: rules, old teacher example, existing progress storage, no JavaScript exceptions.');
  console.log('Screenshots: '+out);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{ws?.close();browser?.kill();server.close();});
