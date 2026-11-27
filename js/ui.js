(() => {
  'use strict';
  const S = window.Sky, D = S.D, V = S.Save;
  const root = document.getElementById('view'), stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay'), notice = document.getElementById('toast');
  let state, invalidSave = false, lastFocus, toastTimer, lineIndex = 0, lobbyTimer;
  const lines = {
    h01:['今夜的梅，开得正好。陪我再看一会儿？','这盏灯照过忘川，也认得你的归途。','星港的风里，有一缕梅香。'],
    h02:['把手给我。星海再冷，也有霜华为你引路。','听，落在杖尖的星光也有声音。','云层散开了。我们该起航了。'],
    h03:['你听，锦鲤跃过水面，恰好落在这一拍。','清泉载月，这一曲只为故人。','这片星海的潮声，我替你记着。']
  };
  const marks = {
    star:'M12 1l2.1 7.8L22 12l-7.9 2.5L12 23l-2.6-8.5L2 12l7.4-2.5z',
    route:'M2 18l6-5 5 2 8-10 M16 5h5v5 M3 21h18',
    quests:'M6 4h3m6 0h3v17H6zM9 2h6v4H9zM9 11h6m-6 4h4',
    gift:'M3 9h18v4H3z M5 13v8h14v-8M12 9v12M12 9C4 9 5 2 8 4c3 1 4 5 4 5zm0 0s1-5 4-5c4-1 4 5-4 5z',
    album:'M3 5q5-2 9 1 5-3 9-1v14q-5-2-9 1-4-3-9-1z M12 6v14',
    bag:'M3 9l9-5 9 5v11H3z M3 9l9 4 9-4 M9 14h6v3H9z',
    diamond:'M2 8l4-5h12l4 5-10 13zM2 8h20M8 8l4 13 4-13M8 8l4-5 4 5',
    coin:'M12 2a10 10 0 1 0 .01 0z M12 5a7 7 0 1 0 .01 0z M12 8l3 4-3 4-3-4z',
    ticket:'M3 5h18v5q-4 2 0 4v5H3v-5q4-2 0-4z M15 7v2m0 2v2m0 2v2',
    sound:'M3 9h4l5-4v14l-5-4H3z M15 8q5 4 0 8m3-11q8 7 0 14',
    mute:'M3 9h4l5-4v14l-5-4H3z M16 9l5 6m0-6-5 6',
    power:'M12 2v9 M7 5a9 9 0 1 0 10 0',
    settings:'M9 3l1-2h4l1 3 3 1 3 1 1 4-2 2 1 4-3 3-3-1-3 3-4-1-1-3-4-1-1-4 2-2-1-3 3-3z M12 8a4 4 0 1 0 .01 0z',
    layers:'M12 2l10 5-10 5L2 7z M3 12l9 5 9-5 M3 17l9 5 9-5',
    roster:'M12 2l6 3v6l-6 4-6-4V5z M3 22v-3l6-3 3 3 3-3 6 3v3',
    summon:'M12 1l2.3 7.7L22 11l-7.7 2.5L12 22l-2.8-8.5L2 11l7.2-2.3z M19 2v4m-2-2h4',
    trial:'M12 2l8 8-8 12-8-12z M7 11h10 M12 3v16',
    idle:'M3 8l9-5 9 5-9 5z M3 8v9l9 5 9-5V8 M12 13v9 M7 6l10 5',
    shop:'M3 10l2-6h14l2 6q-2 4-5 0-4 4-8 0-3 4-5 0z M5 13v7h14v-7',
    event:'M5 22V3m1 1q4-4 8 0 3 2 7 0l-2 8q-4 1-7-1-2-2-6 0',
    clean:'M2 9V3h6m8 0h6v6M2 15v6h6m8 0h6v-6 M8 12h8',
    switch:'M3 7h15l-3-3m6 13H6l3 3M3 7l2-3m16 13-2 3',
    arrow:'M4 12h16m-7-7 7 7-7 7', back:'M20 12H4m7-7-7 7 7 7', close:'M5 5l14 14M19 5L5 19',
    shield:'M12 2l8 3v7q-1 6-8 10-7-4-8-10V5z', sword:'M4 20l3-3m-2-4 6 6m-4-4 9-11 5-2-2 5-10 9'
  };
  function icon(key) {return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="'+(marks[key]||marks.star)+'"/></svg>';}
  const btn = (label,action,color='gold') => '<button class="gem-btn '+color+'" data-action="'+action+'">'+label+'</button>';
  const frame = id => {
    const h=D.hero(id), q=h.rarity.toLowerCase(), path='assets/ui/frame_'+q+'.png';
    return '<span class="quality '+q+'"><img class="portrait" alt="" src="'+S.art(id,'avatar')+'"><img class="rim" alt="" src="'+path+'"></span>';
  };
  const bar = (pct,color='gold') => '<span class="meter '+color+'"><span class="channel"><i style="width:'+Math.max(0,Math.min(100,Number(pct)||0))+'%"></i></span></span>';
  function toast(msg) {notice.textContent=msg;notice.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>notice.hidden=true,2400);}
  function close() {
    overlay.hidden=true;overlay.replaceChildren();root.inert=false;
    if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
  }
  function modal(title,html) {
    if(overlay.hidden)lastFocus=document.activeElement;
    root.inert=true;overlay.hidden=false;
    overlay.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="sky-dialog"><header><h2 id="dialog-title"></h2><button aria-label="关闭" data-action="close">'+icon('close')+'</button></header><div class="dialog-content">'+html+'</div></section>';
    overlay.querySelector('h2').textContent=title;overlay.querySelector('header button').focus({preventScroll:true});
    return overlay.querySelector('.dialog-content');
  }
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(!overlay.hidden)close();
      else if(root.classList.contains('clean'))clean(false);
    }
    if(e.key==='Tab'&&!overlay.hidden){
      const focusable=[...overlay.querySelectorAll('button:not(:disabled),input:not([hidden]),textarea,a[href]')].filter(el=>el.getClientRects().length);
      const [first]=focusable,last=focusable.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  function save(){
    stage.classList.toggle('power-save',state.settings.powerSave);
    if(invalidSave){toast('当前为临时进度，请导入有效存档后保存');return;}
    try{V.write(state);}catch(e){toast(e.message);}
  }
  const format = n=>n.toLocaleString('zh-CN');
  const navButton=(action,key,label)=>'<button data-action="'+action+'">'+icon(key)+'<span>'+label+'</span></button>';
  const iconButton=(action,key,label)=>'<button data-action="'+action+'" aria-label="'+label+'" title="'+label+'">'+icon(key)+'</button>';
  function compass(){
    return '<svg class="astrolabe" viewBox="0 0 160 160" fill="none" aria-hidden="true"><g stroke="currentColor"><circle cx="80" cy="80" r="58" stroke-dasharray="2 4"/><circle cx="80" cy="80" r="51"/><circle cx="80" cy="80" r="35" stroke-dasharray="76 4 15 8"/><path d="M80 4L95 66l61 14-61 14-15 62-15-62L4 80l61-14z M80 21v59l-15-14z M140 80H80l15-14z M80 139V80l15 14z M21 80h59L65 94z" fill="currentColor" fill-opacity=".16"/><path d="m42 42 38 22 38-22-22 38 22 38-38-22-38 22 22-38z"/><circle cx="80" cy="80" r="6"/></g></svg>';
  }
  function lobby(){
    const h=D.hero(state.settings.poster), st=D.stages[Math.min(state.cleared,9)];
    root.innerHTML='<div class="lobby-art">'+Object.keys(lines).map(id=>'<img alt="" class="backdrop '+(id===h.id?'current':'')+'" data-poster="'+id+'" src="'+S.art(id,'poster')+'">').join('')+'</div><div class="lobby-shade"></div>'+
      '<button class="lobby-interact" aria-label="与看板星灵交谈" data-action="line"></button>'+
      '<header class="lobby-top"><div class="commander"><span class="commander-badge"><img src="'+S.art('h02','avatar')+'" alt=""><i></i></span><div><b>星航指挥官</b><div><span>Lv. '+state.level+'</span>　战力 '+format(V.power(state))+'</div></div></div>'+
      '<div class="top-resources">'+[['diamond',state.diamonds,'星钻'],['coin',state.coins,'星币'],['ticket',state.tickets,'唤星券']].map(([i,n,label])=>'<button title="'+label+'" aria-label="'+label+' '+n+'" data-action="bag">'+icon(i)+'<b>'+format(n)+'</b></button>').join('')+'</div>'+
      '<div class="quick-settings">'+iconButton('sound',state.settings.sound?'sound':'mute','音效')+iconButton('power','power',state.settings.powerSave?'省电静态已开启':'极致画质已开启')+iconButton('settings','settings','存档与设置')+'</div></header>'+
      '<nav class="side-tools" aria-label="主城服务">'+[['quests','quests','任务'],['welfare','gift','福利'],['atlas','album','图鉴'],['bag','bag','背包']].map(x=>navButton(...x)).join('')+'</nav>'+
      '<div class="city-title"><i></i><span>浮空星途</span><em>SKY ODYSSEY</em></div>'+
      '<section class="lobby-tiles" aria-label="航行中心"><button class="route-tile" data-action="campaign"><span class="route-art"></span><span class="tile-inside"><small>第'+(st.chapter===1?'一':'二')+'章　'+D.chapters[st.chapter-1]+'</small><strong>主线航线</strong><span>'+st.code+'　'+st.name+'</span></span><i class="tile-arrow">'+icon('arrow')+'</i></button>'+
      '<div class="tile-middle"><button class="trial-tile" data-action="trials">'+compass()+'<strong>星穹试炼</strong></button><button class="idle-tile" data-action="idle"><span class="idle-emblem">'+icon('idle')+'</span><strong>星匣挂机</strong><small id="idle-count"></small></button></div>'+
      '<div class="small-tiles">'+navButton('event','event','限时活动')+navButton('shop','shop','星港商店')+'</div></section>'+
      '<section class="poster-info"><div class="hero-sigil">'+icon('star')+'<span class="hero-faction"></span></div><h1></h1><p class="hero-line" data-action="line"></p><div class="poster-controls">'+navButton('poster','switch','切换看板')+navButton('clean','clean','净屏赏图')+'<span class="poster-dots" aria-hidden="true"></span></div></section>'+
      '<nav class="main-dock" aria-label="主功能">'+navButton('formation','layers','编队')+navButton('roster','roster','星灵')+navButton('gacha','summon','星穹召唤')+navButton('trials','trial','试炼')+'</nav>';
    posterText();tickIdle();
    lobbyTimer=setInterval(tickIdle,1000);
  }
  function tickIdle(){
    const text=root.querySelector('#idle-count');if(!text)return;
    const loot=V.idle(state);text.textContent=loot.coins ? '可领取　'+format(loot.coins)+' 星币':'积累中';
    const ring=root.querySelector('.idle-emblem');if(ring)ring.style.setProperty('--arc',loot.ratio*360+'deg');
    const live=overlay.querySelector('[data-idle-live]');if(live)live.textContent='星币 × '+format(loot.coins)+'　共鸣晶核 × '+loot.cores;
  }
  function posterText(){
    const id=state.settings.poster,h=D.hero(id),i=Object.keys(lines).indexOf(id);
    root.querySelectorAll('.backdrop').forEach(el=>el.classList.toggle('current',el.dataset.poster===id));
    root.querySelector('.hero-faction').textContent=h.rarity+'　/　'+h.faction+'　·　'+h.role.split(' · ')[0];
    root.querySelector('h1').textContent=h.name;root.querySelector('.hero-line').textContent='“'+lines[id][lineIndex]+'”';
    root.querySelector('.poster-dots').innerHTML=Object.keys(lines).map((_,ix)=>'<i class="'+(ix===i?'selected':'')+'"></i>').join('');
  }
  function clean(on){root.classList.toggle('clean',on);const layer=root.querySelector('.lobby-interact');layer.setAttribute('aria-label',on?'退出净屏赏图':'与看板星灵交谈');if(on)layer.focus({preventScroll:true});}
  function speak(e){
    if(root.classList.contains('clean')){clean(false);return;}
    lineIndex=(lineIndex+1+Math.floor(Math.random()*2))%3;posterText();
    if(state.settings.powerSave)return;
    const box=root.getBoundingClientRect(), dust=document.createElement('i');
    dust.className='speech-spark';dust.textContent='✧';
    dust.style.left=((e.clientX||box.left+box.width*.38)-box.left)+'px';
    dust.style.top=((e.clientY||box.top+box.height*.55)-box.top)+'px';
    root.appendChild(dust);setTimeout(()=>dust.remove(),650);
  }
  function go(page='lobby',options={}){
    close();clearInterval(lobbyTimer);clearTimeout(toastTimer);notice.hidden=true;
    if(root.dataset.page==='battle')S.battlePage?.destroy();
    else if(root.dataset.page && root.dataset.page!=='lobby')S.panels?.destroy();
    root.className='';root.replaceChildren();root.dataset.page=page;
    if(page==='lobby')lobby();
    else if(page==='battle')S.battlePage.start(options);
    else S.panels.render(page,options);
  }
  function settings(){
    const s=state.settings;
    modal('航行设置','<div class="dialog-row"><div><b>画质模式</b><small>原生像素密度 · 粒子与动态流光</small></div>'+btn(s.powerSave?'省电静态':'极致画质','power','cyan')+'</div>'+
    '<div class="dialog-row"><div><b>界面与战斗音效</b></div>'+btn(s.sound?'已开启':'已关闭','sound','dark')+'</div>'+
    '<div class="dialog-row"><div><b>指挥官存档</b><small>HTTP 与双击入口之间可用 JSON 转移进度。</small></div></div>'+
    '<div class="dialog-actions">'+btn('导出 JSON','export','gold')+btn('导入 JSON','import','dark')+'</div>');
  }
  function service(action){
    if(action==='settings'){settings();return;}
    if(action==='idle'){const l=V.idle(state);modal('星匣挂机','<p class="dialog-copy">浮空城每 5 秒产出 2 枚星币，每分钟凝结 1 枚共鸣晶核，最多累积 8 小时。</p><div class="dialog-row"><span>当前收获</span><strong data-idle-live></strong></div>'+bar(l.ratio*100,'cyan')+'<div class="dialog-actions">'+btn('领取星匣','claim-idle')+'</div>');tickIdle();return;}
    if(action==='quests'){const d=V.refreshDaily(state);modal('每日任务','<div class="dialog-row"><div><b>例行出航</b><small>今日参加 1 场战斗　'+Math.min(d.battles,1)+' / 1</small></div><strong>星钻 × 80</strong></div><div class="dialog-actions">'+(d.claimed?'今日已领取':btn(d.battles?'领取奖励':'前往航线',d.battles?'claim-daily':'campaign'))+'</div>');return;}
    if(action==='event'){
      const e=V.launchEvent(state);
      modal('七日启航祭','<p class="dialog-copy">建档后的前七天，每日停靠浮空星港可领 1 张唤星券与 5 枚晶核；第七天的唤星券增至 3 张。</p><div class="dialog-row"><b>'+(e.active?'启航第 '+e.day+' 天':'活动已结束')+'</b><strong>已领取 '+state.event.days.length+' / 7 天</strong></div><div class="dialog-actions">'+(!e.active?'':e.claimed?'今日补给已领取':btn('领取今日补给','claim-event'))+'</div>');return;
    }
    if(action==='welfare'){modal('开服福利','<div class="dialog-row"><div><b>启航补给</b><small>每位指挥官可领取一次。</small></div><strong>唤星券 × 6</strong></div><div class="dialog-actions">'+(state.welfare?'补给已领取':btn('领取补给','claim-welfare'))+'</div>');return;}
    if(action==='shop'){modal('星港商店','<div class="dialog-row"><div><b>唤星券 × 1</b><small>持有 '+format(state.diamonds)+' 星钻</small></div><strong>160 星钻</strong></div><div class="dialog-actions">'+btn('兑换 1 张','exchange')+'</div>');return;}
    if(action==='atlas'){modal('星灵图鉴','<div class="catalog">'+D.heroes.map(h=>'<button data-entry="'+h.id+'">'+frame(h.id)+'<b>'+h.name+'</b><small>'+h.rarity+' · '+h.faction+' · '+(state.owned.includes(h.id)?'已结识':'未结识')+'</small></button>').join('')+'</div>');return;}
    if(action==='bag'){modal('储物背包','<div class="dialog-row"><span>星钻 '+format(state.diamonds)+'　星币 '+format(state.coins)+'</span><span>唤星券 '+state.tickets+'　晶核 '+state.cores+'</span></div><div class="catalog">'+state.bag.map(it=>'<div class="catalog-item"><b>'+it.name+'</b><small>'+it.rarity+' · '+D.slots[it.slot]+' +'+it.level+'</small></div>').join('')+'</div><p class="dialog-copy">星灵碎片　'+(D.heroes.filter(h=>state.shards[h.id]).map(h=>h.name+' × '+state.shards[h.id]).join('　')||'暂无')+'</p>');return;}
  }
  function importDialog(){
    modal('导入存档','<p class="dialog-copy">选择 JSON 文件或粘贴存档。确认后将替换此入口的当前进度。</p><textarea id="save-json" aria-label="JSON 存档" spellcheck="false"></textarea><input hidden type="file" accept=".json,application/json" id="save-file"><div class="dialog-actions">'+btn('选择文件','choose-file','dark')+btn('确认导入','confirm-import','crimson')+'</div>');
    document.querySelector('#save-file').onchange=async e=>{const file=e.target.files[0];if(file){try{document.querySelector('#save-json').value=await file.text();}catch{toast('无法读取文件');}}};
  }
  function exportSave(){
    const text=V.exportJSON(state),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='sky_odyssey_save_v1.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);toast('已导出当前存档');
  }
  document.addEventListener('click',e=>{
    const entry=e.target.closest('[data-entry]');if(entry){const h=D.hero(entry.dataset.entry);modal(h.name,'<div class="dialog-row">'+frame(h.id)+'<div><b>'+h.role+'</b><small>'+h.rarity+' · '+h.faction+'</small></div></div><p class="dialog-copy">'+h.ult+'　'+h.skills[1].desc+'</p><div class="dialog-actions">'+btn('返回图鉴','atlas','dark')+'</div>');return;}
    const el=e.target.closest('[data-action]');if(!el)return;
    const a=el.dataset.action;
    try{
      if(a!=='sound')S.sound('tap');
      switch(a){
        case 'close':close();break;
        case 'home':go();break;
        case 'campaign':case 'roster':case 'gacha':go(a);break;
        case 'formation':go('roster',{formation:true});break;
        case 'trials':go('campaign',{trials:true});break;
        case 'line':speak(e);break;
        case 'clean':clean(true);break;
        case 'poster':{
          const ids=Object.keys(lines);state.settings.poster=ids[(ids.indexOf(state.settings.poster)+1)%ids.length];lineIndex=0;save();posterText();break;}
        case 'sound':case 'power':{
          const key=a==='sound'?'sound':'powerSave',wasDialog=!overlay.hidden;state.settings[key]=!state.settings[key];save();
          if(a==='sound')S.sound('tap');
          if(root.dataset.page==='lobby'){clearInterval(lobbyTimer);lobby();}
          if(wasDialog)settings();else toast(a==='power'?(state.settings.powerSave?'省电静态已开启':'极致画质已开启'):(state.settings.sound?'音效已开启':'音效已关闭'));break;}
        case 'claim-idle':case 'claim-daily':case 'claim-welfare':case 'claim-event':{
          const loot=({ 'claim-idle':V.claimIdle,'claim-daily':V.claimDaily,'claim-welfare':V.claimWelfare,'claim-event':V.claimEvent })[a](state);
          const items=[['coins','星币'],['cores','晶核'],['tickets','唤星券'],['diamonds','星钻']].filter(([k])=>loot[k]).map(([k,n])=>n+' +'+loot[k]);
          save();go();S.sound('collect');toast(items.join('　'));break;}
        case 'exchange':V.exchange(state,1);save();go();service('shop');toast('唤星券 +1');break;
        case 'export':exportSave();break;
        case 'import':importDialog();break;
        case 'choose-file':document.querySelector('#save-file').click();break;
        case 'confirm-import':{const imported=V.importJSON(document.querySelector('#save-json').value);V.write(imported);state=imported;invalidSave=false;save();go();toast('存档已导入');break;}
        default:service(a);
      }
    }catch(err){toast(err.message);}
  });
  S.ui={root,go,close,modal,toast,save,frame,bar,btn,icon,get state(){return state;},
    boot(){
      try{state=V.load();}catch{state=V.fresh();invalidSave=true;}
      stage.classList.toggle('power-save',state.settings.powerSave);go();
      if(invalidSave)toast('原存档未通过校验，正在临时游玩。可在设置中导入备份。');else save();
    }
  };
})();
