(() => {
  'use strict';
  const S = window.Sky, D = S.D, V = S.Save;
  const root = document.getElementById('view'), stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay'), notice = document.getElementById('toast');
  let state, invalidSave = false, lastFocus, toastTimer, lineIndex = 0, lobbyTimer;
  let pendingPoster;
  const lobbyVideos=new Map();
  const lines = {
    h01:['今夜的梅，开得正好。陪我再看一会儿？','这盏灯照过忘川，也认得你的归途。','星港的风里，有一缕梅香。'],
    h02:['把手给我。星海再冷，也有霜华为你引路。','听，落在杖尖的星光也有声音。','云层散开了。我们该起航了。'],
    h03:['你听，锦鲤跃过水面，恰好落在这一拍。','清泉载月，这一曲只为故人。','这片星海的潮声，我替你记着。'],
    h04:['往我翼下站些。云上的风，比城里凉。','盾上的凹痕？这一处，换回了一整船的人。','晨钟还没响。再坐一会儿吧，今天我守第一班。'],
    h05:['听见那一声咔哒了吗？两把铳的节拍，终于对上了。','别动，你肩上落了颗星砂。正好借我校个准。','航图借我一角。我算出一条近路，能赶上今晚的流星雨。'],
    h06:['灯借我熄一盏。你看，绯月原来这么亮。','脚步放轻些。听，那只夜莺又肯开口了。','你留的窗我看见了。下回不走屋顶，走正门。']
  };
  const bleed = document.getElementById('bleed');
  const image = (url,cls='ico') => '<img class="'+cls+'" alt="" draggable="false" src="'+url+'">';
  const codexMeta = (h,status='') => '<small class="codex-meta"><span>'+h.rarity+'</span><span class="codex-faction-label">'+
    image(S.art.faction(h.faction),'codex-faction')+h.faction+'</span>'+(status?'<span>'+status+'</span>':'')+'</small>';
  const icon = key => image(S.art.icon(key));
  const item = key => image(S.art.item(key),'item-icon');
  const tilePaint = key => image(S.art.banner(key),'tile-paint');
  const amount = (key,quantity,label='') => '<span class="item-amount">'+item(key)+label+' '+quantity+'</span>';
  const closeMark = '<span aria-hidden="true">×</span>';
  const btn = (label,action,color='gold') => '<button class="gem-btn '+color+'" data-action="'+action+'">'+label+'</button>';
  const frame = id => {
    const h=D.hero(id), q=h.rarity.toLowerCase(), path='assets/ui/frame_'+q+'.png';
    return '<span class="quality '+q+'"><img class="portrait" alt="" src="'+S.art(id,'avatar')+'"><img class="rim" alt="" src="'+path+'"></span>';
  };
  const bar = (pct,color='gold') => '<span class="meter '+color+(Number(pct)>0?'':' empty')+'"><span class="channel"><i style="width:'+Math.max(0,Math.min(100,Number(pct)||0))+'%"></i></span></span>';
  function toast(msg) {notice.textContent=msg;notice.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>notice.hidden=true,2400);}
  function close() {
    overlay.hidden=true;overlay.replaceChildren();root.inert=false;
    if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
  }
  function modal(title,html) {
    if(overlay.hidden)lastFocus=document.activeElement;
    root.inert=true;overlay.hidden=false;
    overlay.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="sky-dialog"><header><h2 id="dialog-title"></h2><button aria-label="关闭" data-action="close">'+closeMark+'</button></header><div class="dialog-content">'+html+'</div></section>';
    overlay.querySelector('h2').textContent=title;overlay.querySelector('header button').focus({preventScroll:true});
    return overlay.querySelector('.dialog-content');
  }
  overlay.addEventListener('click',e=>{if(e.target===overlay){S.sound('back');close();}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(!overlay.hidden){S.sound('back');close();}
      else if(root.classList.contains('clean')){S.sound('back');clean(false);}
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
  const masterAudioOn=s=>!s.muted && ((s.music && s.musicVolume>0) || (s.sound && s.soundVolume>0));
  const audioLabel=on=>on?'音频已开启，点击静音':'音频已静音，点击开启';
  function audioButton(){
    const on=masterAudioOn(state.settings), label=audioLabel(on);
    return '<button type="button" class="audio-toggle" data-action="audio-mute" aria-pressed="'+on+'" aria-label="'+label+
      '" title="'+label+'"><span class="audio-note" aria-hidden="true">♫</span></button>';
  }
  function syncAudio(){
    S.audio.configure(state.settings);
    const on=masterAudioOn(state.settings), label=audioLabel(on);
    for(const button of root.querySelectorAll('[data-action="audio-mute"]')){
      button.setAttribute('aria-pressed',String(on));
      button.setAttribute('aria-label',label);
      button.title=label;
    }
  }
  function toggleAudio(){
    const s=state.settings;
    s.muted=masterAudioOn(s);
    if(!s.muted && !masterAudioOn(s)){
      s.music=true;
      if(!s.musicVolume)s.musicVolume=V.audioDefaults.musicVolume;
    }
    syncAudio();
    save();
    if(!s.muted)S.sound('tap');
    toast(s.muted?'已静音':'音频已开启');
  }
  const format = n=>n.toLocaleString('zh-CN');
  const navButton=(action,key,label)=>'<button data-action="'+action+'">'+icon(key)+'<span>'+label+'</span></button>';
  function releaseLobbyVideo(layer){
    lobbyVideos.get(layer)?.release();
    lobbyVideos.delete(layer);
  }
  function syncLobbyVideo(){
    if(state.settings.powerSave){
      for(const layer of lobbyVideos.keys())releaseLobbyVideo(layer);
      return;
    }
    const poster=bleed.querySelector('.backdrop.current');
    if(!poster || lobbyVideos.has(poster.parentElement))return;
    const layer=poster.parentElement;
    const video=S.lobbyVideo.mount(layer,poster.dataset.poster);
    if(video)lobbyVideos.set(layer,video);
  }
  function sceneForPage(page,{kind,id=1}){
    if(page==='campaign')return 'worldmap';
    if(page!=='battle')return page;
    if(kind==='boss')return 'battle_boss';
    return kind==='campaign' && D.stages[id-1]?.chapter===2 ? 'battle_ch2' : 'battle';
  }
  function background(page,options){
    pendingPoster=null;
    for(const layer of lobbyVideos.keys())releaseLobbyVideo(layer);
    bleed.dataset.page=page;
    bleed.classList.remove('clean');
    bleed.replaceChildren();
    bleed.style.backgroundImage='';
    if(page==='lobby'){
      const id=state.settings.poster;
      bleed.innerHTML='<div class="lobby-art"><div class="lobby-media"><img class="backdrop current" alt="" data-poster="'+id+'" fetchpriority="high" src="'+S.art(id,'poster')+'"></div></div><div class="lobby-shade"></div>';
      syncLobbyVideo();
    } else {
      bleed.style.backgroundImage='url("'+S.scene(sceneForPage(page,options))+'")';
    }
  }
  function cinematic(url,matte=false){
    const prior=bleed.querySelector('.cinema-wing');
    if(!url){prior?.remove();return;}
    const wings=prior || document.createElement('div');
    wings.className='cinema-wing'+(matte?' cinema-matte':'');
    wings.style.backgroundImage=matte?'':'url("'+url+'")';
    if(!prior)bleed.append(wings);
  }
  function lobby(){
    const st=D.stages[Math.min(state.cleared,9)];
    root.innerHTML='<button class="lobby-interact" aria-label="与看板星灵交谈" data-action="line"></button>'+
      '<header class="lobby-top"><div class="commander"><span class="commander-badge"><img src="'+S.art('h02','avatar')+'" alt=""><i></i></span><div><b>星航指挥官</b><div><span>Lv. '+state.level+'</span>　战力 '+format(V.power(state))+'</div></div></div>'+
      '<div class="top-resources">'+[['gem',state.diamonds,'星钻'],['coin',state.coins,'星币'],['ticket',state.tickets,'唤星券']].map(([i,n,label])=>'<button title="'+label+'" aria-label="'+label+' '+n+'" data-action="bag">'+item(i)+'<b>'+format(n)+'</b></button>').join('')+'</div>'+
      '<div class="quick-settings">'+audioButton()+'<button data-action="settings" title="画质、音效与存档设置" aria-label="画质、音效与存档设置">'+icon('settings')+'<span>'+(state.settings.powerSave?'省电静态':'极致画质')+'</span></button></div></header>'+
      '<nav class="side-tools" aria-label="主城服务">'+[['quests','quest','任务'],['welfare','reward','福利'],['atlas','codex','图鉴'],['bag','bag','背包']].map(x=>navButton(...x)).join('')+'</nav>'+
      '<div class="city-title"><i></i><span>浮空星途</span><em>SKY ODYSSEY</em></div>'+
      '<section class="lobby-tiles" aria-label="航行中心"><button class="route-tile" data-action="campaign">'+tilePaint('campaign')+'<span class="tile-inside"><small>第'+(st.chapter===1?'一':'二')+'章　'+D.chapters[st.chapter-1]+'</small><strong>主线航线</strong><span>'+st.code+'　'+st.name+'</span></span><i class="tile-arrow" aria-hidden="true">›</i></button>'+
      '<div class="tile-middle"><button class="trial-tile" data-action="trials">'+tilePaint('tower')+image(S.art.icon('formation'),'trial-emblem')+'<strong>星穹试炼</strong></button><button class="idle-tile" data-action="idle">'+tilePaint('idle')+'<span class="idle-emblem">'+item('chest')+'</span><strong>星匣挂机</strong><small id="idle-count"></small></button></div>'+
      '<div class="small-tiles"><button data-action="event">'+tilePaint('event')+icon('reward')+'<span>限时活动</span></button>'+
      '<button data-action="shop">'+tilePaint('shop')+icon('shop')+'<span>星港商店</span></button></div></section>'+
      '<section class="poster-info"><div class="hero-sigil">'+image(S.art.emblem('star'),'hero-star')+'<span class="hero-faction"></span></div><h1></h1><p class="hero-line" data-action="line"></p><div class="poster-controls"><button data-action="poster">切换看板</button><button data-action="clean">净屏赏图</button><span class="poster-dots" aria-hidden="true"></span></div></section>'+
      '<nav class="main-dock" aria-label="主功能">'+navButton('formation','formation','编队')+navButton('roster','roster','星灵')+navButton('gacha','gacha','星穹召唤')+'</nav>';
    posterText();tickIdle();
    lobbyTimer=setInterval(tickIdle,1000);
  }
  function tickIdle(){
    const text=root.querySelector('#idle-count');if(!text)return;
    const loot=V.idle(state);text.textContent=loot.coins ? '可领取　'+format(loot.coins)+' 星币':'积累中';
    root.querySelector('.idle-tile').classList.toggle('collectible',loot.coins>0);
    const ring=root.querySelector('.idle-emblem');if(ring)ring.style.setProperty('--arc',loot.ratio*360+'deg');
    const live=overlay.querySelector('[data-idle-live]');if(live && live.dataset.coins!==String(loot.coins)){live.dataset.coins=loot.coins;live.innerHTML=amount('coin','× '+format(loot.coins),'星币')+amount('core','× '+loot.cores,'晶核');}
  }
  function posterText(){
    const id=state.settings.poster,h=D.hero(id);
    root.querySelector('.hero-faction').textContent=h.rarity+'　/　'+h.faction+'　·　'+h.role.split(' · ')[0];
    root.querySelector('h1').textContent=h.name;root.querySelector('.hero-line').textContent='“'+lines[id][lineIndex]+'”';
    root.querySelector('.poster-dots').innerHTML=D.illustrated.map(hero=>'<i class="'+(hero===id?'selected':'')+'"></i>').join('');
  }
  async function switchPoster(){
    const id=D.nextPoster(pendingPoster?.dataset.poster || state.settings.poster);
    pendingPoster=null;
    if(id===state.settings.poster)return;
    const art=bleed.querySelector('.lobby-art'), next=new Image();
    next.className='backdrop current';next.alt='';next.dataset.poster=id;
    next.decoding='async';next.src=S.art(id,'poster');
    pendingPoster=next;
    try{await next.decode();}catch{
      if(pendingPoster===next){pendingPoster=null;toast('看板暂未载入，请再试一次');}
      return;
    }
    if(pendingPoster!==next)return;
    pendingPoster=null;
    const previous=[...art.children];
    for(const layer of previous)layer.firstElementChild.classList.remove('current');
    const layer=document.createElement('div');
    layer.className='lobby-media';
    layer.append(next);
    art.append(layer);
    state.settings.poster=id;lineIndex=0;posterText();save();
    syncLobbyVideo();
    const retire=()=>previous.forEach(layer=>{releaseLobbyVideo(layer);layer.remove();});
    if(state.settings.powerSave || matchMedia('(prefers-reduced-motion:reduce)').matches)retire();
    else layer.animate([{opacity:0},{opacity:1}],{duration:620,easing:'ease-in-out'}).finished.then(retire,retire);
  }
  function clean(on){root.classList.toggle('clean',on);bleed.classList.toggle('clean',on);const layer=root.querySelector('.lobby-interact');layer.setAttribute('aria-label',on?'退出净屏赏图':'与看板星灵交谈');if(on)layer.focus({preventScroll:true});}
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
    root.className='';root.replaceChildren();root.dataset.page=page;background(page,options);
    S.audio.scene(page);
    if(page==='lobby')lobby();
    else if(page==='battle')S.battlePage.start(options);
    else S.panels.render(page,options);
  }
  function audioSetting(label,key){
    const s=state.settings, volumeKey=key+'Volume', percent=Math.round(s[volumeKey]*100);
    return '<div class="dialog-row audio-setting"><div><b>'+label+'</b><label class="audio-volume">音量 '+
      '<input aria-label="'+label+'音量" type="range" min="0" max="100" step="1" value="'+percent+'" data-audio-volume="'+volumeKey+'">'+
      '<output>'+percent+'%</output></label></div><button type="button" class="gem-btn dark" data-action="'+key+
      '" aria-label="'+label+'" aria-pressed="'+s[key]+'">'+(s[key]?'已开启':'已关闭')+'</button></div>';
  }
  function settings(){
    const s=state.settings;
    modal('航行设置','<div class="dialog-row"><div><b>画质模式</b><small>原生像素密度 · 粒子与动态流光</small></div>'+btn(s.powerSave?'省电静态':'极致画质','power','cyan')+'</div>'+
    audioSetting('背景音乐','music')+audioSetting('界面与战斗音效','sound')+
    '<div class="dialog-row"><div><b>指挥官存档</b><small>HTTP 与双击入口之间可用 JSON 转移进度。</small></div></div>'+
    '<div class="dialog-actions">'+btn('导出 JSON','export','gold')+btn('导入 JSON','import','dark')+'</div>'+
    '<p class="audio-credit">部分战斗配乐来源：PeriTune (<a href="https://peritune.com/" target="_blank" rel="noopener noreferrer">peritune.com</a>)</p>');
  }
  function service(action){
    if(action==='settings'){settings();return;}
    if(action==='idle'){const l=V.idle(state);modal('星匣挂机','<p class="dialog-copy">浮空城每 5 秒产出 2 枚星币，每分钟凝结 1 枚共鸣晶核，最多累积 8 小时。</p><div class="dialog-row"><span>当前收获</span><strong data-idle-live></strong></div>'+bar(l.ratio*100,'cyan')+'<div class="dialog-actions">'+btn('领取星匣','claim-idle')+'</div>');tickIdle();return;}
    if(action==='quests'){const d=V.refreshDaily(state);modal('每日任务','<div class="dialog-row"><div><b>例行出航</b><small>今日参加 1 场战斗　'+Math.min(d.battles,1)+' / 1</small></div><strong>'+amount('gem','× 80','星钻')+'</strong></div><div class="dialog-actions">'+(d.claimed?'今日已领取':btn(d.battles?'领取奖励':'前往航线',d.battles?'claim-daily':'campaign'))+'</div>');return;}
    if(action==='event'){
      const e=V.launchEvent(state);
      modal('七日启航祭','<p class="dialog-copy">建档后的前七天，每日停靠浮空星港可领 1 张唤星券与 5 枚晶核；第七天的唤星券增至 3 张。</p><div class="dialog-row"><b>'+(e.active?'启航第 '+e.day+' 天':'活动已结束')+'</b><strong>已领取 '+state.event.days.length+' / 7 天</strong></div><div class="dialog-actions">'+(!e.active?'':e.claimed?'今日补给已领取':btn('领取今日补给','claim-event'))+'</div>');return;
    }
    if(action==='welfare'){modal('开服福利','<div class="dialog-row"><div><b>启航补给</b><small>每位指挥官可领取一次。</small></div><strong>'+amount('ticket','× 6','唤星券')+'</strong></div><div class="dialog-actions">'+(state.welfare?'补给已领取':btn('领取补给','claim-welfare'))+'</div>');return;}
    if(action==='shop'){modal('星港商店','<div class="dialog-row"><div><b>'+amount('ticket','× 1','唤星券')+'</b><small>持有 '+format(state.diamonds)+' 星钻</small></div><strong>'+amount('gem','160','星钻')+'</strong></div><div class="dialog-actions">'+btn('兑换 1 张','exchange')+'</div>');return;}
    if(action==='atlas'){modal('星灵图鉴','<div class="catalog">'+D.heroes.map(h=>'<button data-entry="'+h.id+'">'+frame(h.id)+'<b>'+h.name+'</b>'+codexMeta(h,state.owned.includes(h.id)?'已结识':'未结识')+'</button>').join('')+'</div>');return;}
    if(action==='bag'){bag();return;}
  }
  function bag(tab='items'){
    const tabs='<nav class="bag-tabs" aria-label="背包分类">'+[['items','物资'],['gear','星装']].map(([id,name])=>
      '<button data-bag-tab="'+id+'" aria-pressed="'+(tab===id)+'">'+name+'</button>').join('')+'</nav>';
    const slot=(src,name,detail,grade='')=>'<div class="bag-slot">'+(grade
      ? '<span class="quality gear-slot">'+image(src,'gear-art')+image('assets/ui/frame_'+grade.toLowerCase()+'.png','rim')+'</span>'
      : image(src,'bag-icon'))+'<div><b>'+name+'</b><small>'+detail+'</small></div></div>';
    let body;
    if(tab==='gear'){
      body='<div class="bag-grid">'+state.bag.map(it=>slot(S.art.gear(it.slot,it.rarity),it.name,it.rarity+' · '+D.slots[it.slot]+' +'+it.level,it.rarity)).join('')+'</div>';
    }else{
      const resources=[['gem','星钻',state.diamonds],['coin','星币',state.coins],['ticket','唤星券',state.tickets],['core','共鸣晶核',state.cores]];
      const shards=D.heroes.filter(h=>state.shards[h.id]>0);
      body='<div class="bag-grid">'+resources.map(([key,name,n])=>slot(S.art.item(key),name,format(n))).join('')+
        (shards.length?shards.map(h=>slot(S.art.item('shard'),h.name+'碎片',format(state.shards[h.id]))).join(''):slot(S.art.item('shard'),'星魂碎片','0'))+'</div>'+
        '<h3 class="bag-subhead">材料图鉴</h3><div class="bag-guide">'+[['dew','经验星露'],['dust','强化星尘'],['stamina','体力瓶']].map(([key,name])=>
        '<figure>'+image(S.art.item(key),'bag-icon')+'<figcaption>'+name+'</figcaption></figure>').join('')+'</div>';
    }
    modal('储物背包',tabs+body);
  }
  function importDialog(){
    modal('导入存档','<p class="dialog-copy">选择 JSON 文件或粘贴存档。确认后将替换此入口的当前进度。</p><textarea id="save-json" aria-label="JSON 存档" spellcheck="false"></textarea><input hidden type="file" accept=".json,application/json" id="save-file"><div class="dialog-actions">'+btn('选择文件','choose-file','dark')+btn('确认导入','confirm-import','crimson')+'</div>');
    document.querySelector('#save-file').onchange=async e=>{const file=e.target.files[0];if(file){try{document.querySelector('#save-json').value=await file.text();}catch{toast('无法读取文件');}}};
  }
  function exportSave(){
    const text=V.exportJSON(state),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='sky_odyssey_save_v1.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);toast('已导出当前存档');
  }
  overlay.addEventListener('input',event=>{
    const slider=event.target, key=slider.dataset.audioVolume;
    if(key!=='musicVolume' && key!=='soundVolume')return;
    const percent=Number(slider.value);
    state.settings[key]=percent/100;
    slider.nextElementSibling.value=percent+'%';
    syncAudio();
    save();
  });
  const actionSound={home:'back',close:'back',campaign:'tab',roster:'tab',gacha:'tab',formation:'tab',trials:'tab',poster:'tab'};
  const claims={
    'claim-idle':V.claimIdle,'claim-daily':V.claimDaily,'claim-welfare':V.claimWelfare,'claim-event':V.claimEvent
  };
  document.addEventListener('click',e=>{
    if(e.target===document.body && root.dataset.page==='lobby' && overlay.hidden){S.sound('tap');speak(e);return;}
    const bagTab=e.target.closest('[data-bag-tab]');if(bagTab){S.sound('tab');bag(bagTab.dataset.bagTab);return;}
    const entry=e.target.closest('[data-entry]');if(entry){const h=D.hero(entry.dataset.entry);S.sound('tap');modal(h.name,'<div class="dialog-row">'+frame(h.id)+'<div><b>'+h.role+'</b>'+codexMeta(h)+'</div></div><p class="dialog-copy">'+h.ult+'　'+h.skills[1].desc+'</p><div class="dialog-actions">'+btn('返回图鉴','atlas','dark')+'</div>');return;}
    const el=e.target.closest('[data-action]');if(!el)return;
    const a=el.dataset.action;
    try{
      if(a!=='audio-mute' && a!=='sound' && a!=='music' && !Object.hasOwn(claims,a))S.sound(actionSound[a] || 'tap');
      switch(a){
        case 'close':close();break;
        case 'home':go();break;
        case 'campaign':case 'roster':case 'gacha':go(a);break;
        case 'formation':go('roster',{formation:true});break;
        case 'trials':go('campaign',{trials:true});break;
        case 'line':speak(e);break;
        case 'clean':clean(true);break;
        case 'poster':switchPoster();break;
        case 'audio-mute':toggleAudio();break;
        case 'sound':case 'music':{
          const s=state.settings;
          s[a]=!s[a];
          syncAudio();save();
          el.setAttribute('aria-pressed',String(s[a]));
          el.textContent=s[a]?'已开启':'已关闭';
          S.sound('tap');break;}
        case 'power':{
          const wasDialog=!overlay.hidden;
          state.settings.powerSave=!state.settings.powerSave;save();
          syncLobbyVideo();
          if(root.dataset.page==='lobby'){clearInterval(lobbyTimer);lobby();}
          if(wasDialog)settings();else toast(state.settings.powerSave?'省电静态已开启':'极致画质已开启');break;}
        case 'claim-idle':case 'claim-daily':case 'claim-welfare':case 'claim-event':{
          const loot=claims[a](state);
          const items=[['coins','星币'],['cores','晶核'],['tickets','唤星券'],['diamonds','星钻']].filter(([k])=>loot[k]).map(([k,n])=>n+' +'+loot[k]);
          save();go();S.sound('collect');toast(items.join('　'));break;}
        case 'exchange':V.exchange(state,1);save();go();service('shop');toast('唤星券 +1');break;
        case 'export':exportSave();break;
        case 'import':importDialog();break;
        case 'choose-file':document.querySelector('#save-file').click();break;
        case 'confirm-import':{const imported=V.importJSON(document.querySelector('#save-json').value);V.write(imported);state=imported;invalidSave=false;syncAudio();save();go();toast('存档已导入');break;}
        default:service(a);
      }
    }catch(err){toast(err.message);}
  });
  S.ui={root,go,cinematic,close,modal,toast,save,frame,bar,btn,icon,audioButton,get state(){return state;},
    boot(){
      try{state=V.load();}catch{state=V.fresh();invalidSave=true;}
      syncAudio();
      stage.classList.toggle('power-save',state.settings.powerSave);go();
      if(invalidSave)toast('原存档未通过校验，正在临时游玩。可在设置中导入备份。');else save();
    }
  };
})();
