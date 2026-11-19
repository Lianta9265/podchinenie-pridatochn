(() => {
  'use strict';
  const lessons = [...(window.DEFAULT_LESSONS || []), ...(window.OGE_LESSONS || [])];
  const colors = {
    m: {tone:'#9850C5',pale:'#F2E0FB',dark:'#67338D',name:'Сливовый'},
    a: {tone:'#00AFA4',pale:'#C6F8F0',dark:'#006E6A',name:'Бирюзовый'},
    b: {tone:'#EF9F22',pale:'#FFF0BC',dark:'#9B5900',name:'Янтарный'},
    c: {tone:'#E75F61',pale:'#FFE3DC',dark:'#A4333D',name:'Коралловый'},
    d: {tone:'#377DD8',pale:'#DCEBFF',dark:'#19539B',name:'Синий'}
  };
  const names = {sequential:'Последовательное', parallel:'Параллельное', homogeneous:'Однородное', mixed:'Смешанная связь'};
  const isMain = p => p.id==='m' || p.main===true;
  const subordinateParts = lesson => lesson.parts.filter(p=>!isMain(p));
  const basisReviewFor = id => lessons[lessonIndex].parts.find(p=>p.id===tokenParts.get(id))?.basisReview;
  const stepTitles = ['Выдели союзы','Выдели основы','Схема и ниточки'];
  const $ = id => document.getElementById(id);
  const html = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const storageKey = 'niti-smysla-oge-v5';
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) { progress = {}; }
  let lessonIndex = 0, mode = 'play', reviewOnly = false, schemeLayout = 'vertical';
  let activeFilter='all', lessonOrder=[];
  const isRegular = (l) => !l.teacherReview;
  const shuffled = arr => {const result=[...arr];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
  function buildOrder(pinFirst=false){
    const matches=lessons.map((l,i)=>({l,i})).filter(({l})=>isRegular(l)&&(activeFilter==='oge' ? l.collection==='oge' : l.collection!=='oge'&&(activeFilter==='all'||l.kind===activeFilter))).map(x=>x.i);
    lessonOrder=['all','oge'].includes(activeFilter)?shuffled(matches):matches;
    if(pinFirst && lessonOrder.includes(0)){lessonOrder=lessonOrder.filter(i=>i!==0);lessonOrder.unshift(0);}
  }
  function visibleOrder(){return lessonOrder.filter(i=>!reviewOnly||progress[lessons[i].id]?.hadError);}
  function gotoRelative(delta){const list=visibleOrder();if(!list.length)return;let at=list.indexOf(lessonIndex);setLesson(list[(at<0?(delta>0?0:list.length-1):at+delta+list.length)%list.length]);}
  let state, tokens, lookup, basisMap, linksMap, edgeMap, phraseMap, phraseGroups, optionalPreps, tokenParts;
  const paletteKeys=['a','b','c','m','d'];
  let feedback = {text:'', type:''};
  let resizePending = false;

  function tokenise(s) {
    const matches = s.match(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*|[A-Za-z]+|[0-9]+|\s+|[^\s]/gu) || [];
    return matches.map((value,i) => ({id:i, value, isWord:/^[А-Яа-яЁёA-Za-z0-9]/u.test(value)}));
  }
  function prepareLesson() {
    const lesson = lessons[lessonIndex];
    tokens = tokenise(lesson.text);
    lookup = (x) => {
      const found = tokens.filter(t => t.isWord && t.value.toLocaleLowerCase('ru-RU') === x.w.toLocaleLowerCase('ru-RU'));
      return found[x.n || 0]?.id ?? -1;
    };
    // Explicit boundaries in data.js cover words, spaces and punctuation, including
    // separate fragments of a main or subordinate clause interrupted by another.
    tokenParts = new Map();
    const fragments = (lesson.fragments || []).map(f => ({part:f.part, start:lookup(f.from)}));
    fragments.forEach((f,i) => {
      const end = fragments[i+1]?.start ?? tokens.length;
      if(f.start<0 || end<=f.start || (i===0 && f.start!==0))throw new Error('Некорректные границы частей: '+lesson.id);
      for(let id=f.start;id<end;id++)tokenParts.set(id,f.part);
    });
    basisMap = new Map(); linksMap = new Map(); edgeMap = new Map(); phraseMap = new Map(); phraseGroups = new Map(); optionalPreps = new Set();
    lesson.parts.forEach(p => p.base.forEach(ref => {
      const idx = lookup(ref);
      if (idx >= 0) basisMap.set(idx, {partId:p.id, role:ref.role});
    }));
    lesson.links.forEach(l => { const idx=lookup(l); if(idx>=0) linksMap.set(idx,{type:l.type,part:l.part}); });
    lesson.edges.forEach(e => edgeMap.set(e.target, {anchor:lookup(e.from), question:e.question}));
    (lesson.phrases || []).forEach(refs => {
      const ids = refs.map(lookup);
      if(ids.length>1 && ids.every(i=>i>=0) && ids.every((v,i)=>i===0 || v>ids[i-1]))
        {
          phraseMap.set(ids[0],{end:ids[ids.length-1],ids});
          ids.forEach(id=>phraseGroups.set(id,ids));
          // A preposition beside a relative word is optional, unlike parts of a compound conjunction.
          if(ids.length===2 && /предлог/i.test(linksMap.get(ids[0])?.type||''))optionalPreps.add(ids[0]);
        }
    });
  }
  function makeState() {
    return {step:0, demoStage:0, basisMarks:new Map(), linkMarks:new Map(), activeColor:null, activeRole:null, showThreads:false, basesApproved:false, demoBasis:new Set(), demoLinks:new Set(), edges:{}, activeAnchor:null, selectedScheme:null, selectedType:null, hadError:false, revealed:false, positions:{}, invalidBasis:new Set(), invalidLinks:new Set(), wrongEdges:new Set()};
  }
  function setLesson(idx) {
    lessonIndex = (idx + lessons.length) % lessons.length;
    prepareLesson();
    state = makeState();
    feedback={text:'',type:''}; schemeLayout='vertical';
    render();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function setFeedback(text, type='') { feedback={text,type}; renderFeedback(); }
  function renderFeedback() { const el=$('feedback');el.className='feedback '+(feedback.type || '');el.textContent=feedback.text; }
  function currentStep() { return mode==='demo'?state.demoStage:state.step; }
  function teacherColors() {return Object.fromEntries(lessons[lessonIndex].parts.map(p=>[p.id,p.id]));}
  function partColors() {
    if(mode==='demo' || state.revealed) return teacherColors();
    const mapping={};
    for(const [idx,base] of basisMap) {
      const mark=state.basisMarks.get(idx);
      if(mark && !mapping[base.partId])mapping[base.partId]=mark.color;
    }
    for(const p of lessons[lessonIndex].parts.filter(p=>p.basisReview)){
      const link=lessons[lessonIndex].links.find(l=>l.part===p.id);
      const mark=link && state.linkMarks.get(lookup(link));
      if(mark)mapping[p.id]=mark.color;
    }
    return mapping;
  }
  function basisMark(id) {
    if(mode==='demo' || state.revealed) {
      if(state.demoStage<2 && !state.demoBasis.has(id) && !state.revealed)return null;
      const expected=basisMap.get(id);
      return expected ? {role:expected.role==='s'?'s':'p',color:expected.partId} : null;
    }
    return state.basisMarks.get(id)||null;
  }
  function linkMark(id) {
    if(mode==='demo' || state.revealed) {
      if(state.demoStage<1 && !state.demoLinks.has(id) && !state.revealed)return null;
      const expected=linksMap.get(id);
      return expected ? {color:expected.part} : null;
    }
    return state.linkMarks.get(id)||null;
  }
  function shownEdges() {return (mode==='demo' && state.demoStage>=3) || state.revealed ? Object.fromEntries([...edgeMap.entries()].map(([k,v])=>[k,v.anchor])) : state.edges;}
  function showBoard() {return (mode==='demo' ? state.demoStage>=3 : state.step===2 && state.showThreads) || state.revealed;}
  function solved() {return (mode==='demo' && state.demoStage>=3) || (mode==='play' && state.step>=3);}

  function render() {
    if (!lessons.length) return;
    $('mode-play').classList.toggle('active',mode==='play');
    $('mode-demo').classList.toggle('active',mode==='demo');
    const pos=lessonOrder.indexOf(lessonIndex);
    $('section-label').textContent=lessons[lessonIndex].teacherReview?'Особый случай · разбор с учителем':`Задание ${Math.max(0,pos)+1} из ${lessonOrder.length} · ${mode==='demo'?'объяснение':'самостоятельная работа'}`;
    $('kind-filter').value=activeFilter;
    $('reshuffle').hidden=!['all','oge'].includes(activeFilter);
    $('special-lesson').classList.toggle('active',Boolean(lessons[lessonIndex].teacherReview));
    $('level-label').textContent='Сложность '+'●'.repeat(lessons[lessonIndex].level)+'○'.repeat(3-lessons[lessonIndex].level);
    renderSources(); renderList(); renderSteps(); renderInstruction(); renderNextPrompt(); renderColorTools(); renderSentence(); renderBoard(); renderSolution(); renderAnswerArea(); renderControls(); renderFeedback(); scheduleThreads();
  }
  function renderList() {
    const ids = visibleOrder().map(i=>({l:lessons[i],i}));
    $('progress').textContent=`${lessonOrder.filter(i=>progress[lessons[i].id]?.done).length}/${lessonOrder.length}`;
    $('lesson-list').innerHTML = ids.map(({l,i})=>{
      const p=progress[l.id];
      const text=l.text.length>31?l.text.slice(0,31)+'…':l.text;
      return `<button class="lesson-item ${i===lessonIndex?'active':''} ${p?.done?'done':''}" data-index="${i}" type="button" title="${html(l.text)}"><span class="lesson-num">${p?.done?'✓':l.source?.problemId||i+1}</span><span class="lesson-title">${html(text)}</span>${p?.hadError?'<span class="lesson-state" title="Были ошибки">•</span>':''}</button>`;
    }).join('');
    $('lesson-list').querySelectorAll('[data-index]').forEach(btn=>btn.addEventListener('click',()=>setLesson(+btn.dataset.index)));
    $('repeat-errors').textContent=reviewOnly?'← Все предложения этого вида':'↺ Повторить ошибки';
  }
  function renderSources() {
    const source=lessons[lessonIndex].source;
    const el=$('lesson-source');el.hidden=!source;
    el.innerHTML=source?`ОГЭ · задание 3 · <a href="${html(source.url)}" target="_blank" rel="noopener noreferrer">№ ${source.problemId}</a> · предложение ${source.sentence}`:'';

  }
  function renderSteps() {
    const s=currentStep();
    $('steps').innerHTML=stepTitles.map((v,i)=>`<div class="step ${i<s?'passed':i===s?'current':''}"><span class="step-bubble">${i<s?'✓':i+1}</span><span>${v}</span></div>`).join('');
  }
  function renderInstruction() {
    const st=currentStep();
    const messages = mode==='demo' ? [
      'Выдели подчинительные союзы и союзные слова разными цветами.',
      'Выдели грамматические основы: цвет каждой придаточной части — как у её союза или союзного слова.',
      'Подбери схему и определи вид подчинения. При необходимости распутай ниточки и задай вопросы.',
      'Разбор завершён. Объясни связи между частями.'
    ] : [
      'Выдели подчинительные союзы и союзные слова разными цветами.',
      'Выдели грамматические основы. Цвет каждой придаточной части должен совпадать с цветом её союза или союзного слова.',
      'Подбери схему и определи вид подчинения. При необходимости распутай ниточки и задай вопросы к придаточным.',
      state.revealed?'Открыт разбор преподавателя.':'Готово! Проверь схему и объяснение.'
    ];
    $('instruction').textContent=lessons[lessonIndex].teacherReview?'Особый пример для разбора с учителем. Автоматическая проверка основ в нём отключена.':messages[Math.min(st,messages.length-1)];
    if(st===1){
      const review=lessons[lessonIndex].parts.find(p=>p.basisReview)?.basisReview;
      if(review)$('instruction').textContent+=' '+review.instruction;
    }
    if(lessons[lessonIndex].kind==='mixed')$('instruction').textContent=$('instruction').textContent.replaceAll('вид подчинения','вид связи');
  }
  function renderNextPrompt() {
    const btn=$('scheme-jump');
    const ready=mode==='play' && state.step===2 && !state.revealed;
    btn.hidden=!ready;
    if(ready)btn.textContent=lessons[lessonIndex].kind==='mixed'?'✓ Выделение верное — перейти к схемам и виду связи ↓':'✓ Выделение верное — перейти к схемам и виду подчинения ↓';
  }
  function goToBases() {
    if(mode!=='play' || state.step!==0 || state.revealed)return;
    state.step=1;state.activeColor=null;
    feedback={text:'Теперь выдели основы. Используй для каждого придаточного цвет его союза или союзного слова. Главной части выбери отдельный цвет.',type:''};
    if(lessons[lessonIndex].kind==='mixed')feedback.text=feedback.text.replace('Главной части выбери','Каждой главной части выбери');
    render();
  }
  function backToConjunctions() {
    if(mode!=='play'||state.step!==1)return;
    state.step=0;state.activeColor=null;
    feedback={text:'Можно исправить союзы. Уже выделенные основы сохранятся.',type:''};
    render();
  }
  function renderColorTools() {
    const el=$('color-tools'),st=currentStep();
    const show=mode==='play' && st<=1 && !state.revealed;
    el.hidden=!show;
    if(!show){el.innerHTML='';return;}
    el.innerHTML=`<div class="palette-row"><strong>Выбери цвет</strong><div class="palette-buttons">${paletteKeys.map(k=>`<button type="button" class="marker-btn ${state.activeColor===k?'active':''}" style="--marker:${colors[k].tone}" data-color="${k}" aria-label="${colors[k].name}" aria-pressed="${state.activeColor===k}"><span class="marker-dot"></span><span>${colors[k].name}</span></button>`).join('')}</div></div>
      ${st===1?`<div class="grammar-tools" role="group" aria-label="Выбери инструмент"><span class="grammar-tools-label">Инструмент</span><button type="button" data-role="s" class="grammar-btn ${state.activeRole==='s'?'active':''}" aria-pressed="${state.activeRole==='s'}"><span class="syntax-example single">Подлежащее</span><span class="syntax-caption">1 черта</span></button><button type="button" data-role="p" class="grammar-btn ${state.activeRole==='p'?'active':''}" aria-pressed="${state.activeRole==='p'}"><span class="syntax-example double">Сказуемое</span><span class="syntax-caption">2 черты</span></button></div>`:''}
      <div class="palette-help"><span>${state.activeColor?'Маркер: '+colors[state.activeColor].name.toLowerCase():'Выбери маркер'}</span><span>${st===0?'Нажми на подчинительный союз или союзное слово.':state.activeRole?'Нажми на слово в предложении.':'Выбери «Подлежащее» или «Сказуемое».'}</span></div>
      <div class="grammar-actions">${st===0?'<button type="button" id="go-to-bases" class="btn btn-primary grammar-next">Выдели грамматические основы →</button>':'<button type="button" id="back-to-conjunctions" class="btn btn-outline">← Вернуться к союзам</button><button type="button" id="check-marking-top" class="btn btn-primary grammar-next">Проверить выделение ✓</button>'}</div>`;
    el.querySelectorAll('[data-color]').forEach(btn=>btn.addEventListener('click',()=>{
      state.activeColor=btn.dataset.color;renderColorTools();
    }));
    el.querySelectorAll('[data-role]').forEach(btn=>btn.addEventListener('click',()=>{
      state.activeRole=btn.dataset.role;renderColorTools();
    }));
    if(st===0)$('go-to-bases').addEventListener('click',goToBases);
    else{
      $('back-to-conjunctions').addEventListener('click',backToConjunctions);
      $('check-marking-top').addEventListener('click',checkStep);
    }
  }
  function renderSentence() {
    const target=$('sentence');target.innerHTML='';
    const st=currentStep(),isInteractive=((st<2 || (st===2 && state.showThreads)) && !state.revealed);
    const mapping=partColors();
    // Independent practice never reveals clause ownership before both checks pass.
    // In the teaching mode the completed demonstration is the explicit reveal.
    const highlight=(state.step>=2 && state.basesApproved) || state.revealed || (mode==='demo' && state.demoStage>=3);
    function appendToken(parent,t,inPhrase=false) {
      parent.append(t.isWord?wordButton(t,inPhrase):document.createTextNode(t.value));
    }
    function wordButton(t,inPhrase=false) {
      const el=document.createElement('button');el.type='button';el.className='word';el.dataset.id=t.id;el.textContent=t.value;
      const mark=basisMark(t.id), lmark=linkMark(t.id);
      if(mark){
        el.classList.add(mark.role==='s'?'role-s':'role-p');
        el.style.setProperty('--basis-color',colors[mark.color]?.tone||colors.a.tone);
        el.style.setProperty('--basis-pale',colors[mark.color]?.pale||colors.a.pale);
      }
      if(lmark){
        el.classList.add(inPhrase?'link-inside':'link-mark');
        el.style.setProperty('--link-color',colors[lmark.color]?.tone||colors.a.tone);
        el.style.setProperty('--link-pale',colors[lmark.color]?.pale||colors.a.pale);
      }
      // Ошибки показываем текстом, НЕ прямоугольниками вокруг слов.
      if(state.invalidBasis.has(t.id)&&st===1 || state.invalidLinks.has(t.id)&&st===0)el.classList.add('needs-review');
      if(st===2 && state.showThreads)el.classList.add('is-anchor');
      if(st===2 && state.showThreads && state.activeAnchor===t.id)el.classList.add('anchor-active');
      if(lmark && linksMap.has(t.id))el.title=linksMap.get(t.id).type;
      if(isInteractive)el.addEventListener('click',()=>onWordClick(t.id));
      else {el.tabIndex=-1;el.style.cursor='default';}
      return el;
    }
    let fragment=null, previousPart=null;
    for(let i=0;i<tokens.length;i++){
      const part=tokenParts.get(i);
      if(highlight && mapping[part] && (part!==previousPart || !fragment)){
        fragment=document.createElement('span');fragment.className='clause-highlight';fragment.dataset.part=part;
        fragment.dataset.color=mapping[part];
        fragment.style.setProperty('--clause-fill',colors[mapping[part]].tone+'33');
        target.append(fragment);
      }
      previousPart=part;
      const container=highlight && mapping[part]?fragment:target;
      const phrase=phraseMap.get(i),marks=phrase?.ids.map(id=>linkMark(id));
      if(phrase && marks.every(m=>m && m.color===marks[0].color)){
        const wrapper=document.createElement('span');wrapper.className='link-phrase';
        wrapper.style.setProperty('--link-color',colors[marks[0].color].tone);
        wrapper.style.setProperty('--link-pale',colors[marks[0].color].pale);
        for(let j=i;j<=phrase.end;j++)appendToken(wrapper,tokens[j],true);
        container.append(wrapper);i=phrase.end;continue;
      }
      appendToken(container,tokens[i]);
    }
    const drawn=(mode==='demo'||state.basesApproved||state.revealed)?lessons[lessonIndex].parts.filter(p=>mapping[p.id]):[];
    $('legend').innerHTML=drawn.map(p=>`<span class="legend-chip" style="--chip:${colors[mapping[p.id]].tone}">${html(p.title)}</span>`).join('') || '<span class="answer-note">'+(st===0?'Выдели подчинительные союзы и союзные слова.':'Выдели основы в цветах соответствующих союзов.')+'</span>';
  }
  function onWordClick(id) {
    const st=currentStep();
    if(mode==='demo'){
      if(st===0 && linksMap.has(id)){state.demoLinks.add(id);renderSentence();}
      else if(st===1 && basisMap.has(id)){state.demoBasis.add(id);renderSentence();}
      else if(st===2 && state.showThreads){state.activeAnchor=id;renderSentence();setFeedback('Теперь нажми на узелок нужного придаточного.');}
      return;
    }
    if(st===0){
      if(!state.activeColor){setFeedback('Сначала выбери цвет маркера.','error');return;}
      // Составные союзы отмечаются целиком, предлог при союзном слове — по выбору.
      const group=phraseGroups.get(id) || [id];
      const optional=group.length===2 && optionalPreps.has(group[0]);
      const desired=optional && id!==group[0]?[id]:group;
      const markedInGroup=group.filter(i=>state.linkMarks.has(i));
      const alreadyMarked=markedInGroup.length===desired.length && desired.every(i=>state.linkMarks.get(i)?.color===state.activeColor);
      group.forEach(i=>{state.linkMarks.delete(i);state.invalidLinks.delete(i);});
      if(!alreadyMarked) desired.forEach(i=>state.linkMarks.set(i,{color:state.activeColor}));
      renderSentence();
    } else if(st===1){
      if(state.basesApproved)return;
      const review=basisReviewFor(id);
      if(review){setFeedback(review.instruction);return;}
      if(!state.activeColor){setFeedback('Сначала выбери цвет маркера.','error');return;}
      if(!state.activeRole){setFeedback('Выбери инструмент: «Подлежащее» или «Сказуемое».','error');return;}
      const m=state.basisMarks.get(id);
      if(m && m.role===state.activeRole && m.color===state.activeColor) state.basisMarks.delete(id);
      else state.basisMarks.set(id,{role:state.activeRole,color:state.activeColor});
      state.invalidBasis.delete(id);renderSentence();
    } else if(st===2){
      state.activeAnchor=id;renderSentence();setFeedback('Выбрано опорное слово: «'+tokens[id].value+'». Нажми на узелок придаточной части.');
    }
  }
  function renderBoard() {
    $('thread-zone').hidden=!showBoard();
    const board=$('thread-board');
    if(!showBoard()){board.innerHTML='';return;}
    board.innerHTML='';
    const parts=subordinateParts(lessons[lessonIndex]);
    parts.forEach((p,i)=>{
      const col=colors[partColors()[p.id]||p.id]||colors.c;
      const card=document.createElement('button');card.type='button';card.className='clause-card';card.dataset.part=p.id;
      card.style.setProperty('--tone',col.tone);card.style.setProperty('--tone-fade',col.pale);card.style.setProperty('--tone-dark',col.dark);
      const pos=state.positions[p.id] || defaultPosition(i,parts.length);
      card.style.left=pos.x+'%';card.style.top=pos.y+'px';
      if(state.wrongEdges.has(p.id))card.classList.add('wrong-edge');
      if(state.activeAnchor!==null && currentStep()===2)card.classList.add('selected');
      const edge=shownEdges()[p.id], label=edge==null ? 'Выбери опорное слово' : '← '+tokens[edge]?.value;
      // Вопрос всегда виден рядом с соответствующей перемещаемой карточкой,
      // не на линии под панелью маркеров. Цвет совпадает с нитью и карточкой.
      const question=edge==null ? '' : (edgeMap.get(p.id)?.question||'?');
      card.innerHTML=`${question?`<span class="thread-question">${html(question)}</span>`:''}<span class="clause-title">${html(p.title)}</span><span class="clause-short">${html(p.short)}</span><span class="clause-tag">${html(label)}</span><span class="drag-handle" title="Передвинуть узелок" aria-label="Передвинуть узелок" role="button" tabindex="0">⠿</span>`;
      card.addEventListener('click',()=>onTargetClick(p.id));
      const handle=card.querySelector('.drag-handle');
      handle.addEventListener('click',e=>e.stopPropagation());
      handle.addEventListener('pointerdown',e=>startDrag(e,card,p.id));
      board.append(card);
    });
    scheduleThreads();
  }
  function defaultPosition(i,count) {
    const compact=$('thread-board').clientWidth<550;
    if(compact) return count>2 && i===2?{x:50,y:195}:{x:i===0?26:74,y:35};
    if(count===1)return{x:50,y:40};
    if(count===2)return{x:i===0?27:73,y:45};
    return{x:18+i*(64/(count-1)),y:42};
  }
  function onTargetClick(partId) {
    if(currentStep()!==2 || !state.showThreads)return;
    if(state.activeAnchor===null){setFeedback('Сначала выбери опорное слово в предложении.','error');return;}
    state.edges[partId]=state.activeAnchor;
    const text=tokens[state.activeAnchor].value;
    state.activeAnchor=null;state.wrongEdges.delete(partId);
    renderSentence();renderBoard();
    setFeedback('Ниточка проведена от слова «'+text+'». Её можно изменить, выбрав другое опорное слово.','');
  }
  function startDrag(e,card,partId) {
    if(e.button!==0 && e.pointerType!=='touch')return;
    e.preventDefault();e.stopPropagation();
    const board=$('thread-board'), r=board.getBoundingClientRect(), start=card.getBoundingClientRect();
    const offsetX=e.clientX-(start.left+start.width/2), offsetY=e.clientY-start.top;
    const handle=e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const move=ev=>{
      if(ev.pointerId!==e.pointerId)return;
      const cx=Math.max(start.width/2,Math.min(r.width-start.width/2,ev.clientX-r.left-offsetX));
      const cy=Math.max(8,Math.min(r.height-start.height-8,ev.clientY-r.top-offsetY));
      const p={x:cx/r.width*100,y:cy};state.positions[partId]=p;
      card.style.left=p.x+'%';card.style.top=p.y+'px';scheduleThreads();
    };
    const end=ev=>{if(ev.pointerId!==e.pointerId)return;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  }
  function scheduleThreads() {
    if(resizePending)return;resizePending=true;
    requestAnimationFrame(()=>{resizePending=false;drawThreads();});
  }
  function drawThreads() {
    const svg=$('threads-svg');svg.innerHTML='';
    if(!showBoard())return;
    const area=$('work-area').getBoundingClientRect();
    svg.setAttribute('viewBox',`0 0 ${area.width} ${area.height}`);
    const shown=shownEdges();
    for(const p of subordinateParts(lessons[lessonIndex])){
      const tId=shown[p.id];if(tId===undefined||tId===null)continue;
      const from=$('sentence').querySelector(`[data-id="${tId}"]`), to=$('thread-board').querySelector(`[data-part="${p.id}"]`);
      if(!from||!to)continue;
      const sr=from.getBoundingClientRect(),tr=to.getBoundingClientRect();
      const x1=sr.left+sr.width/2-area.left, y1=sr.bottom-area.top;
      const x2=tr.left+tr.width/2-area.left, y2=tr.top-area.top+2;
      const diff=Math.max(25,Math.min(72,(y2-y1)*.5));
      const isWrong = (mode==='play'&&state.wrongEdges.has(p.id));
      const col=isWrong?'#df716a':(colors[partColors()[p.id]||p.id]||colors.c).tone;
      const mk=(tag,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));svg.append(el);return el;};
      mk('path',{d:`M ${x1} ${y1} C ${x1} ${y1+diff}, ${x2} ${y2-diff}, ${x2} ${y2}`,stroke:col,class:'thread-path'});
      mk('circle',{cx:x1,cy:y1,r:5,fill:col,class:'thread-dot'});
      mk('circle',{cx:x2,cy:y2,r:5,fill:col,class:'thread-dot'});
      // Вопрос расположен на передвижной карточке; на линии его больше нет.
    }
  }
  function schemeSvg(shape,count) {
    if(shape==='mixed')return `<svg class="schema-mini" viewBox="0 0 320 203" role="img" aria-label="Две главные части соединены сочинением; у каждой своё придаточное">
      <defs><marker id="arr-mixed" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5 Z" fill="#18A79D"/></marker></defs>
      <rect x="8" y="14" width="115" height="38" rx="12" fill="#654477"/><rect x="197" y="14" width="115" height="38" rx="12" fill="#654477"/>
      <text x="65" y="38" font-size="14" font-weight="bold" fill="white" text-anchor="middle">Главная 1</text><text x="255" y="38" font-size="14" font-weight="bold" fill="white" text-anchor="middle">Главная 2</text>
      <path d="M123 42 H197" stroke="#6C4C80" stroke-width="2.5"/><text x="160" y="30" text-anchor="middle" font-size="12" fill="#382A45">однако</text>
      <path d="M65 52 V125 M255 52 V125" stroke="#18A79D" stroke-width="3" fill="none" marker-end="url(#arr-mixed)"/>
      <circle cx="65" cy="151" r="23" fill="#FFF9F2" stroke="#6C4C80" stroke-width="2.5"/><circle cx="255" cy="151" r="23" fill="#FFF9F2" stroke="#6C4C80" stroke-width="2.5"/>
      <text x="65" y="156" text-anchor="middle" font-size="14" fill="#382A45">1</text><text x="255" y="156" text-anchor="middle" font-size="14" fill="#382A45">2</text></svg>`;
    const W=320,H=203;
    let strokes='';
    let circles='';
    const startX=count===2?[83,237]:[48,160,272];
    const targetPositions=shape==='sequential' ?
      Array.from({length:count},(_,i)=>({x:160,y:88+i*(count===2?79:50)})) :
      startX.map(x=>({x,y:148}));
    const circle=(x,y,i)=>`<circle cx="${x}" cy="${y}" r="23" fill="#FFF9F2" stroke="#6C4C80" stroke-width="2.5"/><text x="${x}" y="${y+5}" text-anchor="middle" font-size="14" fill="#382A45" font-weight="800">${i+1}</text>`;
    const dot=(x,y)=>`<circle cx="${x}" cy="${y}" r="4.3" fill="#D88536"/>`;
    for(let i=0;i<count;i++){
      const to=targetPositions[i],bottom=to.y-23;
      let x,y;
      if(shape==='sequential'){
        if(i===0){x=160;y=46;} else {x=targetPositions[i-1].x;y=targetPositions[i-1].y+23;}
      } else if(shape==='homogeneous'){x=160;y=46;}
      else {x=startX[i]===83?123:startX[i]===237?197:115+i*45;y=46;}
      strokes+=`<path d="M ${x} ${y} Q ${(x+to.x)/2} ${Math.min(bottom-13,(y+bottom)/2+9)} ${to.x} ${bottom-2}" stroke="#18A79D" stroke-width="3" fill="none" stroke-linecap="round" marker-end="url(#arr)"/>`;
      if(shape!=='sequential' || i===0) strokes+=dot(x,y);
      circles+=circle(to.x,to.y,i);
    }
    return `<svg class="schema-mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Графическая схема: ${shape==='sequential'?'цепочка зависимостей':shape==='homogeneous'?'общее опорное слово':'разные опорные слова'}">
      <defs><marker id="arr" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5 Z" fill="#18A79D"/></marker></defs>
      <rect x="97" y="7" width="126" height="39" rx="12" fill="#654477"/>
      <text x="160" y="31" font-size="14" font-weight="bold" fill="white" text-anchor="middle">Главная</text>${strokes}${circles}</svg>`;
  }
  function renderAnswerArea() {
    const el=$('answer-area'),st=currentStep();
    if(mode==='demo') {
      el.innerHTML='<div class="answer-note">Режим объяснения: сначала союзы, затем основы, затем связи и схемы.</div>';
      return;
    }
    if(st===2){
      const mixed=lessons[lessonIndex].kind==='mixed';
      const opts=['parallel','sequential','homogeneous',...(mixed?['mixed']:[])];
      const typeOptions=Object.entries(names).filter(([v])=>mixed||v!=='mixed');
      const count=subordinateParts(lessons[lessonIndex]).length;
      el.innerHTML=`<div class="choice-section"><button id="toggle-threads" class="threads-toggle" type="button" aria-expanded="${state.showThreads}">${state.showThreads?'Скрыть ниточки':'Распутать ниточки и задать вопросы (по желанию)'} ${state.showThreads?'↑':'↓'}</button><div class="answer-note">Схему и ниточки можно использовать одновременно.</div></div><div class="choice-section"><div class="answer-title">Подбери схему к предложению</div><div class="scheme-choices${mixed?' scheme-choices-mixed':''}">${opts.map((shape,i)=>`<button class="scheme-choice ${state.selectedScheme===shape?'selected':''}" data-shape="${shape}" type="button" aria-pressed="${state.selectedScheme===shape}"><span class="scheme-choice-number">Схема ${['А','Б','В','Г'][i]}</span>${schemeSvg(shape,count)}</button>`).join('')}</div></div>
        <div class="choice-section kind-section"><div class="answer-title">Сделай вывод: ${mixed?'какова связь между частями?':'какой это вид подчинения?'}</div><div class="answer-options">${typeOptions.map(([v,label])=>`<button class="type-btn ${state.selectedType===v?'selected':''}" data-type="${v}" type="button" aria-pressed="${state.selectedType===v}">${label}</button>`).join('')}</div></div>`;
      el.querySelectorAll('[data-shape]').forEach(btn=>btn.addEventListener('click',()=>{state.selectedScheme=btn.dataset.shape;renderAnswerArea();}));
      el.querySelectorAll('[data-type]').forEach(btn=>btn.addEventListener('click',()=>{state.selectedType=btn.dataset.type;renderAnswerArea();}));
      $('toggle-threads').addEventListener('click',()=>{
        state.showThreads=!state.showThreads;state.activeAnchor=null;
        renderSentence();renderBoard();renderAnswerArea();scheduleThreads();
      });
    } else if(st===3){
      el.innerHTML='<div class="answer-title">'+(state.revealed?'Разбор преподавателя':'Задание выполнено')+'</div><div class="answer-note">Можно перейти к следующему предложению или разобрать это ещё раз.</div>';
    } else {
      const message=st===0?'Сначала выдели подчинительные союзы и союзные слова.': 'Затем выдели грамматические основы в тех же цветах. Проверка будет общей.';
      el.innerHTML=`<div class="answer-note">${message}</div>${st===1?'<button id="back-to-conjunctions-bottom" type="button" class="small-action">← Исправить союзы, сохранив основы</button>':''}<button id="reveal-answer" type="button" class="small-action">Показать решение</button>`;
      if(st===1)$('back-to-conjunctions-bottom').addEventListener('click',backToConjunctions);
      $('reveal-answer').addEventListener('click',()=>{
        if(confirm('Показать готовый разбор? Самостоятельное выполнение не будет засчитано.')){
          state.revealed=true;state.step=3;state.activeAnchor=null;
          setFeedback('Открыт готовый разбор — самостоятельное выполнение не засчитано.');render();
        }
      });
    }
  }
  function renderControls() {
    // В режиме выделения кнопка действия есть только рядом с текстом.
    $('check-button').hidden=(mode==='play' && state.step<=1 && !state.revealed);
    if(mode==='demo'){
      $('clear-step').textContent='← Шаг назад';
      $('check-button').textContent=state.demoStage>=3?'Начать показ заново':'Следующий шаг →';
    } else if(state.step>=3){
      $('clear-step').textContent='Разобрать заново';
      $('check-button').textContent='Следующее предложение →';
    } else if(state.step===0){
      $('clear-step').textContent='Очистить союзы';
      $('check-button').textContent='Выдели грамматические основы →';
    } else if(state.step===1){
      $('clear-step').textContent='Очистить основы';
      $('check-button').textContent='Проверить выделение ✓';
    } else {
      $('clear-step').textContent='Изменить ответ';
      $('check-button').textContent='Проверить схему и вид ✓';
    }
  }
  function recordError(){state.hadError=true;}
  function checkBases() {
    const expectedIds=[...basisMap.keys()], actual=state.basisMarks;
    const incorrect=new Set();
    for(const id of actual.keys()) if(!basisMap.has(id)) incorrect.add(id);
    for(const id of expectedIds){
      const mark=actual.get(id),base=basisMap.get(id);
      if(mark && mark.role!==(base.role==='s'?'s':'p'))incorrect.add(id);
    }
    const owners={},usedColors=new Set();
    for(const id of expectedIds){
      const mark=actual.get(id);
      if(!mark)continue;
      const part=basisMap.get(id).partId;
      if(owners[part] && owners[part]!==mark.color)incorrect.add(id);
      else owners[part]=mark.color;
    }
    for(const p of lessons[lessonIndex].parts.filter(p=>p.basisReview))owners[p.id]=partColors()[p.id];
    let distinct=true;
    for(const p of lessons[lessonIndex].parts){
      if(!owners[p.id] || usedColors.has(owners[p.id]))distinct=false;
      usedColors.add(owners[p.id]);
    }
    const allCorrect=actual.size===expectedIds.length && incorrect.size===0 && distinct;
    if(allCorrect)return true;
    state.invalidBasis=incorrect;recordError();
    let msg='Проверь основы: выделено '+actual.size+' из '+expectedIds.length+' нужных слов.';
    if(incorrect.size)msg+=' Есть лишние слова или неверный вид подчёркивания. Цвета выделения не изменены.';
    if(!distinct)msg+=' Каждая основа должна быть целиком одним цветом; разные основы — разными цветами.';
    feedback={text:msg,type:'error'};return false;
  }
  function checkLinks() {
    const requiredIds=[...linksMap.keys()].filter(id=>!optionalPreps.has(id)), actual=state.linkMarks;
    const owners=partColors();
    const invalid=new Set();
    for(const [id,mark] of actual){
      const expected=linksMap.get(id);
      if(!expected || owners[expected.part]!==mark.color)invalid.add(id);
    }
    const missing=requiredIds.filter(id=>!actual.has(id));
    if(missing.length===0 && invalid.size===0)return true;
    state.invalidLinks=invalid;recordError();
    feedback={text:'Проверь овальчики: отмечено '+(requiredIds.length-missing.length)+' из '+requiredIds.length+' обязательных союзов и союзных слов. Предлог при союзном слове необязателен. Цвет овальчика должен совпадать с цветом своей придаточной части.'+(invalid.size?' Есть лишняя рамка или неверный цвет.':''),type:'error'};
    return false;
  }
  function checkStep() {
    if(mode==='demo'){nextDemo();return;}
    const st=state.step;
    if(st===3){gotoRelative(1);return;}
    if(st===0){
      // Сначала отмечаются союзы, затем основы; проверяем оба выделения вместе.
      goToBases();return;
    }
    if(st===1){
      const basesOK=checkBases();
      const basesMessage=feedback.text;
      const linksOK=checkLinks();
      const linksMessage=feedback.text;
      if(basesOK && linksOK){
        state.step=2;state.basesApproved=true;state.invalidBasis.clear();state.invalidLinks.clear();
        feedback={text:'Верно! Теперь выбери схему и вид подчинения. Ниточки доступны одновременно со схемами.',type:'success'};
        if(lessons[lessonIndex].kind==='mixed')feedback.text=feedback.text.replace('вид подчинения','вид связи');
      }else{
        feedback={text:[!basesOK?basesMessage:'',!linksOK?linksMessage:''].filter(Boolean).join(' '),type:'error'};
      }
      render();
      if(basesOK && linksOK)requestAnimationFrame(()=>$('answer-area').scrollIntoView({behavior:'smooth',block:'start'}));
      return;
    }
    if(st===2){
      if(!state.selectedScheme || !state.selectedType){
        setFeedback('Выбери и графическую схему, и вид подчинения.','error');return;
      }
      const kind=lessons[lessonIndex].kind;
      if(state.selectedScheme!==kind || state.selectedType!==kind){
        recordError();setFeedback('Есть ошибка в '+(state.selectedScheme!==kind && state.selectedType!==kind?'схеме и определении вида':state.selectedScheme!==kind?'схеме':kind==='mixed'?'виде связи':'виде подчинения')+'. Сравни точки начала стрелок и смысловые вопросы.','error');return;
      }
      state.step=3;progress[lessons[lessonIndex].id]={done:true,hadError:state.hadError};
      try{localStorage.setItem(storageKey,JSON.stringify(progress));}catch(_){}
      feedback={text:'Верно! Основы, союзы, схема и вид подчинения определены правильно.',type:'success'};
      if(kind==='mixed')feedback.text=feedback.text.replace('вид подчинения','вид связи');
      render();return;
    }
  }
  function nextDemo() {
    if(state.demoStage>=3){state=makeState();setFeedback('Показ начат заново.');render();return;}
    state.demoStage++;state.activeAnchor=null;
    feedback={text:['','Союзы и союзные слова выделены.','Грамматические основы выделены.','Показаны ниточки и правильный разбор.'][state.demoStage],type:'success'};
    render();
  }
  function clearStep() {
    if(mode==='demo') {
      state.demoStage=Math.max(0,state.demoStage-1);
      state.demoBasis.clear();state.demoLinks.clear();state.activeAnchor=null;
      feedback={text:'Возврат к предыдущему шагу.',type:''};render();return;
    }
    if(state.step===3){state=makeState();feedback={text:'Разбор начат заново.',type:''};render();return;}
    if(state.step===0){state.linkMarks.clear();state.invalidLinks.clear();}
    if(state.step===1){state.basisMarks.clear();state.invalidBasis.clear();state.basesApproved=false;}
    if(state.step===2){state.edges={};state.activeAnchor=null;state.wrongEdges.clear();state.selectedScheme=null;state.selectedType=null;state.showThreads=false;}
    
    feedback={text:'Выделения текущего шага очищены.',type:''};render();
  }
  function renderSolution() {
    const el=$('solution');el.hidden=!solved();if(!solved())return;
    const l=lessons[lessonIndex], col=colors;
    const edgeStrings=l.edges.map((e,i)=>({p:l.parts.find(p=>p.id===e.target),from:tokens[edgeMap.get(e.target).anchor]?.value||'',question:e.question,index:i}));
    const card=(id,text,cap)=>{const c=col[partColors()[id]||id]||col.c;return `<div class="scheme-cell" style="--tone:${c.tone};--tone-fade:${c.pale}">${text}${cap?`<div class="scheme-caption">${html(cap)}</div>`:''}</div>`;};
    const main=card('m','[ &nbsp;Главная&nbsp; ]','');
    let graphic='';
    if(l.kind==='mixed') {
      const branches=l.parts.filter(isMain).map(p=>{
        const e=edgeStrings.find(e=>l.edges.find(edge=>edge.target===e.p.id)?.parent===p.id);
        return `<div class="mixed-branch">${card(p.id,'[ '+html(p.title)+' ]','')}<div class="scheme-arrow">↓ <span class="scheme-caption">«${html(e.from)}» — ${html(e.question)}</span></div>${card(e.p.id,'( '+html(e.p.title)+' )','')}</div>`;
      });
      graphic=`<div class="mixed-scheme">${branches[0]}<div class="mixed-coordination">однако<br><small>сочинительная связь</small></div>${branches[1]}</div>`;
    } else if(l.kind==='sequential') {
      if(schemeLayout==='vertical'){
        graphic=main+edgeStrings.map(e=>`<div class="scheme-arrow">↓ <span class="scheme-caption">«${html(e.from)}» — ${html(e.question)}</span></div>`+card(e.p.id,'( &nbsp;Придаточная '+(e.index+1)+'&nbsp; )','')).join('');
      } else {
        graphic=[main,...edgeStrings.map(e=>card(e.p.id,'( &nbsp;'+html(e.p.title)+'&nbsp; )',`← от «${e.from}», ${e.question}`))].join('');
      }
    } else {
      if(schemeLayout==='vertical') {
        graphic=main+`<div class="scheme-arrow">↙ &nbsp; ↘ <div class="scheme-caption">${l.kind==='homogeneous'?'Общее опорное слово, одинаковый вопрос':'Сравни конкретные опорные слова'}</div></div>`+
          `<div style="display:grid;grid-template-columns:repeat(${edgeStrings.length},minmax(0,1fr));gap:9px">`+edgeStrings.map(e=>card(e.p.id,'( '+html(e.p.title)+' )',`от «${e.from}» · ${e.question}`)).join('')+'</div>';
      } else {
        graphic=[main,...edgeStrings.map(e=>card(e.p.id,'( '+html(e.p.title)+' )',`от «${e.from}» · ${e.question}`))].join('');
      }
    }
    const nested = l.embedded && l.nestParts ? `
      <div class="nest-demo" aria-label="Вложенная придаточная часть">
        <div class="nest-demo-head">Как одна придаточная часть оказывается внутри другой</div>
        <div class="nest-outer">
          <div class="nest-outer-label">Придаточная 1</div>
          <span class="nest-text">${html(l.nestParts.before)}</span>
          <div class="nest-inner"><div class="nest-inner-label">Придаточная 2</div>${html(l.parts[2].short)}</div>
          <span class="nest-text">${html(l.nestParts.after)}</span>
        </div>
        <div class="nest-caption">Вложение частей не меняет направления зависимости: стрелка идёт от опорного слова в первом придаточном ко второму.</div>
      </div>` : '';
    const teacherNotes=l.parts.filter(p=>p.basisReview).map(p=>`<div class="teacher-note"><strong>Разбор с преподавателем: ${html(p.short)}</strong><p>${html(p.basisReview.explanation)}</p></div>`).join('');
    el.innerHTML=`<div class="solution-top"><h2>Схема: ${html(names[l.kind])}${l.kind==='mixed'?'':' подчинение'}</h2><div class="scheme-switch"><button data-layout="vertical" type="button" class="${schemeLayout==='vertical'?'active':''}">Вертикальная</button><button data-layout="horizontal" type="button" class="${schemeLayout==='horizontal'?'active':''}">Горизонтальная</button></div></div><div class="scheme-visual ${schemeLayout}">${graphic}</div><p class="solution-note">${html(l.note)}</p>${l.source?`<details class="exam-answer"><summary>Ответ исходного задания ОГЭ № ${l.source.problemId}</summary><p>${html(l.source.claim)} — ${l.source.claimCorrect===false?'неверно':'верно'}. Полный ответ задания 3: <strong>${html(l.source.answer)}</strong>.</p></details>`:''}${teacherNotes}${nested}`;
    el.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>{schemeLayout=b.dataset.layout;renderSolution();}));
  }
  function showRules() { const d=$('rules-dialog');if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open',''); }
  function hideRules() {$('rules-dialog').close?.();$('rules-dialog').removeAttribute('open');}
  $('scheme-jump').addEventListener('click',()=>$('answer-area').scrollIntoView({behavior:'smooth',block:'start'}));
  $('mode-play').addEventListener('click',()=>{if(mode==='play'&&!lessons[lessonIndex].teacherReview)return;mode='play';setLesson(lessons[lessonIndex].teacherReview?lessonOrder[0]:lessonIndex);});
  $('mode-demo').addEventListener('click',()=>{if(mode==='demo')return;mode='demo';setLesson(lessonIndex);});
  $('prev-lesson').addEventListener('click',()=>gotoRelative(-1));
  $('next-lesson').addEventListener('click',()=>gotoRelative(1));
  $('clear-step').addEventListener('click',clearStep);
  $('check-button').addEventListener('click',checkStep);
  $('rules-open').addEventListener('click',showRules);
  $('rules-main').addEventListener('click',showRules);
  $('rules-close').addEventListener('click',hideRules);
  $('rules-ok').addEventListener('click',hideRules);
  $('kind-filter').addEventListener('change',e=>{
    activeFilter=e.target.value;reviewOnly=false;buildOrder();
    if(lessonOrder.length)setLesson(lessonOrder[0]);
  });
  $('reshuffle').addEventListener('click',()=>{
    buildOrder();reviewOnly=false;
    if(lessonOrder.length)setLesson(lessonOrder[0]);
  });
  $('special-lesson').addEventListener('click',()=>{mode='demo';setLesson(lessons.findIndex(l=>l.teacherReview));});
  $('repeat-errors').addEventListener('click',()=>{
    if(reviewOnly){reviewOnly=false;renderList();return;}
    const first=lessonOrder.find(i=>progress[lessons[i].id]?.hadError);
    if(first===undefined){setFeedback('В выбранной теме пока нет завершённых карточек с ошибками.','');return;}
    reviewOnly=true;setLesson(first);
  });
  window.addEventListener('resize',()=>{if(showBoard() && !Object.keys(state.positions).length)renderBoard();else scheduleThreads();});
  if(typeof ResizeObserver!=='undefined'){new ResizeObserver(()=>scheduleThreads()).observe($('work-area'));}
  // Diagnostics for content review and browser smoke tests. Read-only.
  window.NITI_DIAGNOSTICS={getLesson:()=>lessons[lessonIndex],getFilter:()=>activeFilter,getOrder:()=>[...lessonOrder],getState:()=>({...state}),tokens:()=>tokens.map(t=>({id:t.id,value:t.value})),getKeys:()=>({bases:[...basisMap.entries()],links:[...linksMap.entries()],edges:[...edgeMap.entries()],optionalPreps:[...optionalPreps],tokenParts:[...tokenParts.entries()]})};
  buildOrder(true);
  setLesson(lessonOrder[0]);
})();
