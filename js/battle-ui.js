(() => {
  'use strict';
  const Sky=window.Sky;
  const labels={campaign:'主线航线',tower:'星穹高塔',boss:'天城首领',arena:'星环演武'};
  const shortName=name=>name.split(' · ')[0];
  const pretty=n=>Number(n).toLocaleString('zh-CN');
  const amountPrefix={damage:'−',heal:'+',shield:'盾 +' };
  const shortCutMs=850, cinematicRates=[1,3/1.9,3/1.25], ultimateHitDelay=80;
  let current;

  function control(action,label) {
    return '<button type="button" data-battle="'+action+'">'+label+'</button>';
  }
  function card(u) {
    const h=Sky.D.hero(u.heroId);
    return '<button class="battle-card" type="button" data-cast="'+u.slot+'"><span class="battle-badge">'+
      Sky.ui.frame(h.id)+'<span class="battle-star" aria-hidden="true">✦</span>'+
      '<span class="badge-hp meter cyan" aria-hidden="true"><i></i></span>'+
      '<span class="badge-rage meter gold" aria-hidden="true"><i></i><i></i><i></i><i></i></span></span></button>';
  }
  function refreshUI(s) {
    const allies=s.battle.units.filter(u=>u.side==='ally');
    allies.forEach((u,i)=>{
      const button=s.cards[i], display=s.scene.byKey[u.key];
      const hp=display.hp, rage=s.rage[u.key], queued=s.queued.has(u.slot);
      const acting=s.action?.actor===u.key && ['motion','cutin'].includes(s.phase);
      const frozen=!!display.status?.freeze;
      const stamp=[hp,rage,s.auto,queued,acting,frozen].join('/');
      if(button.dataset.state===stamp) return;
      button.dataset.state=stamp;
      const charged=hp>0 && rage===100, canCast=charged && !frozen;
      button.disabled=s.auto || !canCast;
      button.classList.toggle('is-charged',charged);
      button.classList.toggle('is-frozen',frozen);
      button.classList.toggle('ready',canCast && !s.auto);
      button.classList.toggle('lost',hp<=0);
      button.classList.toggle('acting',acting && hp>0);
      button.querySelector('.badge-hp i').style.width=(100*hp/u.maxHp)+'%';
      button.querySelectorAll('.badge-rage i').forEach((pip,p)=>{
        const charge=Math.max(0,Math.min(1,rage/25-p));
        pip.style.setProperty('--charge',charge*100+'%');
        pip.classList.toggle('lit',charge===1);
      });
      const availability=hp<=0?'阵亡':frozen?'冰冻中':queued?'必杀已排队':canCast?'可释放必杀':'必杀蓄能中';
      button.setAttribute('aria-label',Sky.D.hero(u.heroId).name+'，生命 '+hp+' / '+u.maxHp+'，怒气 '+rage+'，'+availability);
      button.title=Sky.D.hero(u.heroId).name+' · '+availability;
    });
    s.round.textContent=String(s.battle.round).padStart(2,'0');
    s.autoButton.textContent=s.auto?'自动':'手动';
    s.autoButton.setAttribute('aria-pressed',String(s.auto));
    s.speedButton.textContent=s.speed+'×';
    s.speedButton.setAttribute('aria-label','切换倍速，当前 '+s.speed+' 倍');
  }
  function announceSkill(s,action) {
    if(action.kind==='stun')return;
    const side=s.scene.byKey[action.actor].side;
    const ribbon=s.ribbons[side];
    ribbon.textContent=action.kind==='ultimate'?s.hero.ult:s.hero.basic;
    ribbon.dataset.kind=action.kind;
    ribbon.getAnimations().forEach(animation=>animation.cancel());
    const from=side==='ally'?-22:22;
    ribbon.animate([
      {offset:0,opacity:0,transform:'translateX('+from+'%)'},
      {offset:.12,opacity:1,transform:'translateX(0)'},
      {offset:.84,opacity:1,transform:'translateX(0)'},
      {offset:1,opacity:0,transform:'translateX('+(-from*.32)+'%)'}
    ],{duration:1250,easing:'linear'});
  }
  function sync(s) {
    s.scene.state(s.battle.units);
    for(const u of s.battle.units) s.rage[u.key]=u.rage;
    refreshUI(s);
  }
  function popup(s,n,hit) {
    const number=document.createElement('span');
    const resisted=hit.kind==='damage' && !hit.amount, critical=hit.crit && !resisted;
    number.className='battle-float '+hit.kind+(resisted?' resist':'')+(critical?' critical':'')+
      (hit.periodic?' periodic':'');
    number.dataset.target=n.key;
    if(critical || hit.periodic) {
      const prefix=document.createElement('small');
      prefix.textContent=hit.periodic?'灼烧':'暴击'; number.append(prefix);
    }
    const value=document.createElement('b');
    value.textContent=resisted?'抵挡':amountPrefix[hit.kind]+pretty(hit.amount);
    value.dataset.value=value.textContent;
    number.append(value);
    const group=s.action.hits.filter(other=>other.target===hit.target);
    const index=group.indexOf(hit);
    if(group.length>1)number.classList.add('combo-hit');
    s.numbers.append(number);
    s.labels.push({node:number,key:n.key,start:s.hudClock,fan:index-(group.length-1)/2,
      group:group.length,wide:group.some(other=>other.crit),width:number.offsetWidth,height:number.offsetHeight});
  }
  function placeNumbers(s) {
    if(!s.labels.length)return;
    const {w,h}=s.scene;
    const flags=new Map(), obstacles=[];
    for(const n of s.scene.nodes){
      const point=s.scene.flagPoint(n.key);
      flags.set(n.key,point);
      if(n.hp>0)obstacles.push({left:point.x-w*.022,right:point.x+w*.022,top:point.y,bottom:point.y+h*.018});
    }
    obstacles.sort((a,b)=>b.top-a.top);
    for(const label of s.labels) {
      const age=s.hudClock-label.start;
      if(age>=770){label.node.remove();continue;}
      const anchor=flags.get(label.key);
      const t=age/770;
      const zoom=age<85?.4+1.15*(1-(1-age/85)**2):1+.55*(Math.max(0,1-(age-85)/155))**2;
      const half=label.width*zoom/2, height=label.height*zoom;
      const pitch=w*(label.wide?.126:.079);
      const margin=Math.min(w*.46,w*.025+pitch*label.group/2);
      const center=Math.max(margin,Math.min(w-margin,anchor.x));
      const x=Math.max(half+2,Math.min(w-half-2,center+label.fan*pitch*(1+.10*t)));
      let y=anchor.y-h*(.025+.014*Math.abs(label.fan)+t*.063);
      // Lift over the current camera-projected gauges and preceding labels.
      // Earlier labels stay readable when a second target shares the same lane.
      for(const box of obstacles) {
        if(x+half>=box.left && x-half<=box.right && y>box.top-h*.007 && y-height<box.bottom)
          y=box.top-h*.007;
      }
      const box={left:x-half,right:x+half,top:y-height,bottom:y};
      const at=obstacles.findIndex(other=>other.top<box.top);
      obstacles.splice(at<0?obstacles.length:at,0,box);
      label.node.style.left=x+'px'; label.node.style.top=y+'px';
      label.node.style.transform='translate(-50%,-100%) scale('+zoom+')';
      label.node.style.opacity=String(Math.min(1,(1-t)/.27));
    }
    s.labels=s.labels.filter(label=>label.node.isConnected);
  }
  function posterImage(s,id) {
    if(!s.posters.has(id)){
      const image=new Image();
      image.decoding='async';
      image.src=Sky.art(id,'poster');
      image.decode().catch(()=>{});
      s.posters.set(id,image);
    }
    return s.posters.get(id);
  }
  const mirrorTime=220, domainIn=180, domainHold=1450, domainOut=320;
  const mirrors=[
    ['0 0,40% 0,63.5% 50%,0 29%','-11%','-15%','-5deg'],
    ['40% 0,75% 0,63.5% 50%','1%','-19%','4deg'],
    ['75% 0,100% 0,100% 34%,63.5% 50%','12%','-13%','6deg'],
    ['100% 34%,100% 100%,63.5% 50%','19%','3%','-6deg'],
    ['100% 100%,66% 100%,63.5% 50%','9%','17%','6deg'],
    ['66% 100%,27% 100%,63.5% 50%','-3%','17%','-4deg'],
    ['27% 100%,0 100%,0 64%,63.5% 50%','-15%','9%','7deg'],
    ['0 64%,0 29%,63.5% 50%','-17%','3%','-4deg']
  ];
  function clearShatter(s) {
    clearTimeout(s.mirrorTimer);
    s.shatter?.remove();
    s.shatter=null;
  }
  function shatter(s,direction,src) {
    clearShatter(s);
    const ms=direction==='enter'?mirrorTime:Math.max(92,mirrorTime/s.speed);
    const imageUrl=path=>'url("'+new URL(path,document.baseURI).href+'")';
    const layer=s.shatter=document.createElement('div');
    layer.className='battle-shatter';
    layer.dataset.direction=direction;
    layer.setAttribute('aria-hidden','true');
    layer.style.setProperty('--mirror-time',ms+'ms');
    layer.style.setProperty('--mirror-art',imageUrl(src));
    layer.style.setProperty('--impact-crack',imageUrl(Sky.art.impactCrack));
    for(const [shape,x,y,angle] of mirrors) {
      const pane=document.createElement('i');
      pane.style.cssText='--pane:polygon('+shape+');--pane-x:'+x+';--pane-y:'+y+';--pane-angle:'+angle;
      layer.append(pane);
    }
    const cracks=document.createElement('span');
    cracks.className='battle-shatter-crack';
    layer.append(cracks);
    s.root.append(layer);
    s.mirrorTimer=setTimeout(()=>clearShatter(s),ms+30);
  }
  function prepareDomains(s) {
    if(!s.scene.hasCinema)return;
    for(const {heroId} of s.battle.units.filter(unit=>unit.side==='ally')){
      const src=Sky.art.domain(heroId);
      if(!src)continue;
      const image=new Image();
      image.alt=''; image.decoding='async'; image.src=src;
      const decoded=image.decode().then(()=>image,()=>null);
      s.domains.set(heroId,{image,decoded});
    }
  }
  function clearDomain(s) {
    const domain=s.domain;
    if(!domain)return;
    clearTimeout(domain.timer);
    domain.layer?.remove();
    s.domain=null;
  }
  function openDomain(s,id) {
    const entry=s.domains.get(id);
    if(!entry)return;
    clearDomain(s);
    const domain=s.domain={id,start:performance.now()};
    entry.decoded.then(image=>{
      if(!image || current!==s || domain!==s.domain || domain.exiting)return;
      const layer=domain.layer=document.createElement('div');
      layer.className='battle-domain'; layer.dataset.hero=id; layer.dataset.phase='active';
      layer.style.setProperty('--domain-in',domainIn+'ms');
      layer.style.setProperty('--domain-out',domainOut+'ms');
      layer.append(image);
      s.backdrop.append(layer);
    });
  }
  function endDomain(s) {
    const domain=s.domain;
    if(!domain || domain.timer)return;
    const hold=Math.max(400,domainHold-(performance.now()-domain.start));
    domain.timer=setTimeout(()=>{
      domain.exiting=true;
      if(domain.layer)domain.layer.dataset.phase='fading';
      domain.timer=setTimeout(()=>clearDomain(s),domainOut);
    },hold);
  }
  function beginCutin(s) {
    showCutin(s);
  }
  function showCutin(s) {
    const image=posterImage(s,s.hero.id);
    const hero=s.hero, element=document.createElement('div');
    const media=s.videos.get(hero.id);
    const dedicated=media?.ultimate && !media.ultimate.failed;
    element.className='battle-cutin';
    element.dataset.hero=hero.id;
    const poster=image.src, hasPoster=image.complete && image.naturalWidth>0;
    if(hasPoster)element.classList.add('has-poster');
    if(dedicated)Sky.ui.cinematic(poster,true);
    element.style.setProperty('--cut-image','url("'+poster+'")');
    element.innerHTML='<div class="battle-cut-content"><div class="battle-cut-image"></div><div class="battle-cut-streak"></div>'+
      '<div class="battle-cut-title"><span>'+hero.faction+'　/　'+hero.name+'</span><strong>'+hero.ult+'</strong></div></div>'+
      '<button class="battle-cut-skip" type="button" aria-label="跳过必杀演出"><span>跳过演出 <i aria-hidden="true">››</i></span></button>';
    const events=new AbortController();
    const cut=s.cutin={element,events,started:performance.now()}, target=element.querySelector('.battle-cut-image');
    s.phase='cutin'; s.cutins++;
    s.root.append(element);
    const active=()=>current===s && s.cutin===cut;
    const complete=()=>{
      if(!active())return;
      clearCutin(s);
      if(s.scene.hasCinema)openDomain(s,hero.id);
      startImpact(s);
    };
    element.querySelector('.battle-cut-skip').addEventListener('click',complete,{once:true});
    document.addEventListener('click',event=>{
      if(event.target===document.body || event.target===document.documentElement)complete();
    },{signal:events.signal});
    function useShortCut(){
      if(!active())return;
      Sky.audio.duck(false);
      clearTimeout(cut.timer);
      clearTimeout(cut.startup);
      cut.video?.rewind();
      cut.video=null;
      const remaining=shortCutMs-(performance.now()-cut.started);
      if(remaining<=0){complete();return;}
      element.dataset.media='poster';
      Sky.ui.cinematic(hasPoster?poster:null);
      if(media && !media.lobby)media.lobby=Sky.posterVideo.preload(hero.id);
      if(media?.lobby?.ready){
        cut.video=media.lobby;
        element.dataset.media='lobby';
        cut.video.play(target,{onError:()=>{if(active())element.dataset.media='poster';}});
      }
      cut.timer=setTimeout(complete,remaining);
    }
    if(!dedicated){useShortCut();return;}

    // The original poster is visible while playback starts. Bound both the
    // wait for the first decoded frame and the total cinematic time.
    const rate=cinematicRates[s.speed-1];
    element.dataset.media='ultimate';
    cut.video=media.ultimate;
    cut.startup=setTimeout(useShortCut,550);
    const voice=Sky.audio.voiceVolume();
    cut.video.play(target,{
      audible:voice>0 && navigator.userActivation?.hasBeenActive!==false,
      volume:voice,
      rate:()=>rate,
      onFrame:video=>{
        if(!active())return;
        clearTimeout(cut.startup);
        Sky.audio.duck(!video.muted && video.volume>0);
        if(cut.timer===undefined) {
          const remaining=Number.isFinite(video.duration) ? video.duration-video.currentTime : 3;
          cut.timer=setTimeout(complete,Math.max(0,remaining)*1000/rate+300);
        }
      },
      onEnd:complete,
      onError:useShortCut
    });
  }
  function clearCutin(s){
    const cut=s.cutin;
    if(!cut)return;
    s.cutin=null;
    Sky.audio.duck(false);
    cut.events.abort();
    clearTimeout(cut.timer);
    clearTimeout(cut.startup);
    cut.video?.rewind();
    cut.element.remove();
    Sky.ui.cinematic(null);
  }
  function releaseVideos(s){
    clearTimeout(s.cutinEntryTimer);
    clearCutin(s);
    clearShatter(s);
    clearDomain(s);
    for(const {ultimate,lobby} of s.videos.values()){
      ultimate?.release();
      lobby?.release();
    }
    s.videos.clear();
  }
  function hideTotal(s,linger=false) {
    s.totalFade?.cancel();
    if(!linger || s.total.hidden){s.total.hidden=true;return;}
    s.totalFade=s.total.animate([
      {opacity:1,translate:'-50% 0'},
      {opacity:0,translate:'-50% -14px'}
    ],{delay:600,duration:220,fill:'forwards',easing:'ease-out'});
    s.totalFade.onfinish=()=>{s.total.hidden=true;};
  }
  function countImpact(s,hit,finisher) {
    if(!s.hitsShown) {
      hideTotal(s);
      s.total.dataset.kind=s.countKind;
      s.total.querySelector('small').textContent={heal:'总治疗',shield:'总护盾',damage:'总伤害'}[s.countKind];
      s.total.hidden=false;
    }
    s.sum+=hit.amount;
    const value=s.total.querySelector('strong');
    value.dataset.value=value.textContent=pretty(s.sum);
    s.hitsShown++;
    s.total.querySelector('.battle-hits').textContent=s.countKind==='damage'?
      s.hitsShown+(s.hitsShown===1?' HIT':' HITS'):s.hitsShown+' 次施加';
    if(!s.powerSave){
      value.getAnimations().forEach(animation=>animation.cancel());
      const first=s.hitsShown===1;
      const pulse=first?[{scale:'1.35'},{scale:'1'}]:
        [{scale:'1'},{scale:finisher?'1.32':'1.18',offset:.32},{scale:'1'}];
      value.animate(pulse,{duration:220,easing:'cubic-bezier(.2,.8,.25,1)'});
    }
    s.totalUpdates++;
  }
  function startImpact(s) {
    s.phase='motion'; s.elapsed=0; s.hitIndex=0; s.sum=0; s.hitsShown=0;
    s.attackCue=false;
    const action=s.action, ultimate=action.kind==='ultimate',hits=action.hits;
    s.duration=action.kind==='stun'?230:ultimate?610+Math.max(0,hits.length-1)*108:430;
    s.impactPlan=ultimate ? s.scene.planUltimate(action,s.effectClock) : null;
    s.scene.beginAction(action,s.effectClock);
    announceSkill(s,action);
    if(ultimate) {
      if(s.impactPlan)s.duration=s.impactPlan.duration;
      s.burstCount++;
      s.scene.focus=new Set([action.actor,...hits.map(h=>h.target)]);
      s.root.classList.add('spotlight');
      const actor=s.scene.byKey[action.actor];
      s.countKind=hits.every(h=>h.kind==='heal')?'heal':hits.every(h=>h.kind==='shield')?'shield':'damage';
      s.primaryHits=hits.map((hit,index)=>hit.kind===s.countKind &&
        (hit.kind!=='damage'||actor.side!==s.scene.byKey[hit.target].side)?index:-1).filter(i=>i>=0);
      const targets=[...new Set(s.primaryHits.map(i=>s.scene.byKey[hits[i].target]))];
      if(targets.length){
        const x=targets.reduce((sum,target)=>sum+target.x,0)/targets.length;
        const y=targets.reduce((sum,target)=>sum+target.y,0)/targets.length;
        const stage=s.root.getBoundingClientRect(), backdrop=s.backdrop.getBoundingClientRect();
        const px=stage.left-backdrop.left+stage.width*(actor.x+x)/2;
        const py=stage.top-backdrop.top+stage.height*(actor.y+y-.22)/2;
        s.backdrop.style.setProperty('--spot-x',100*px/backdrop.width+'%');
        s.backdrop.style.setProperty('--spot-y',100*py/backdrop.height+'%');
      }
    }
    refreshUI(s);
  }
  function nextAction(s) {
    if(s.battle.done) {finish(s);return;}
    let action=null;
    if(!s.auto && s.queued.size) {
      const slot=s.queued.values().next().value;
      s.queued.delete(slot); action=Sky.Battle.cast(s.battle,slot);
    }
    if(!action) action=Sky.Battle.step(s.battle,s.auto);
    if(!action) {finish(s);return;}
    s.action=action;
    const unit=s.battle.units.find(u=>u.key===action.actor);
    s.hero=Sky.D.hero(unit.heroId);
    s.rage[unit.key]=unit.rage;
    s.scene.byKey[unit.key].rage=unit.rage;
    s.round.textContent=String(action.round).padStart(2,'0');
    if(action.kind==='ultimate')Sky.sound('ult_start');
    if(action.kind==='ultimate' && unit.side==='ally') beginCutin(s);
    else startImpact(s);
    refreshUI(s);
  }
  function advance(s,dt,now) {
    const scaled=dt*s.speed;
    s.hudClock+=scaled;
    const available=s.scene.advanceClock(scaled);
    let elapsed=available;
    if(available>0){
      elapsed+=s.carry; s.carry=0;
    }
    const a=s.action, ultimate=a?.kind==='ultimate';
    const firstHit=a?.kind==='stun'?100:ultimate?ultimateHitDelay:s.scene.basicHitMs;
    const due=s.phase==='motion' && s.hitIndex<a.hits.length ?
      (s.impactPlan?.due[s.hitIndex] ?? firstHit+s.hitIndex*(ultimate?108:36)):Infinity;
    // Present each real contact before spending the rest of a slow frame.
    // Carried motion resumes only after the live feedback ticker releases hitstop.
    const reached=Number.isFinite(due) && elapsed+s.elapsed>=due-.000001;
    if(reached) {
      const toHit=Math.max(0,due-s.elapsed);
      s.carry+=Math.max(0,elapsed-toHit); elapsed=toHit;
    }
    s.effectClock+=elapsed;
    if(s.phase==='cutin')return;
    s.elapsed=reached?due:s.elapsed+elapsed;
    if(s.phase==='ready') {
      if(s.elapsed>=s.duration) nextAction(s);
      return;
    }
    if(s.phase!=='motion') return;
    const progress=Math.min(1,s.elapsed/s.duration);
    const target=a.hits[0]?.target;
    if(target) s.scene.elapsedAction(a.actor,target,progress,a.kind==='basic',s.elapsed,s.speed);
    if(a.kind==='basic' && !s.attackCue && s.elapsed>=s.scene.basicWindupMs){
      s.attackCue=true;
      Sky.sound(s.scene.attackSound(a.actor));
    }
    if(reached) {
      const hit=a.hits[s.hitIndex];
      const primary=ultimate?s.primaryHits.indexOf(s.hitIndex):-1;
      const beats=ultimate?Math.min(4,s.primaryHits.length):1;
      const beat=primary<0?0:Math.round(primary*(beats-1)/Math.max(1,s.primaryHits.length-1))+1;
      const finisher=ultimate && primary>=0 && primary===s.primaryHits.length-1;
      s.scene.hit(a.actor,hit,hit.periodic?'fire':s.hero.element,ultimate,now,s.effectClock,s.hitIndex,due,{finisher,beat,beats});
      popup(s,s.scene.byKey[hit.target],hit);
      if(hit.rage!==undefined)s.rage[hit.target]=hit.rage;
      if(hit.kind==='damage' && s.scene.byKey[hit.target].side==='ally' && !s.powerSave) {
        const button=s.cards[s.scene.byKey[hit.target].slot];
        button.classList.add('taking-hit');
        const badge=button.querySelector('.battle-badge');
        button.hitFlash?.cancel();
        button.hitFlash=badge.animate([
          {translate:'0',filter:'drop-shadow(0 0 4px #ff3e52)'},
          {translate:'3% 0',offset:.22},{translate:'-3% 0',offset:.5},{translate:'0',filter:'none'}
        ],{duration:180});
        button.hitFlash.onfinish=()=>button.classList.remove('taking-hit');
      }
      if(primary>=0)countImpact(s,hit,finisher);
      if(hit.kind==='damage')Sky.sound(hit.amount===0?'shield':hit.crit?'crit':'hit');
      else if(hit.amount>0)Sky.sound(hit.kind);
      s.hitIndex++; refreshUI(s);
    }
    if(progress===1) {
      s.scene.resetMotion(); s.root.classList.remove('spotlight');
      s.phase='ready'; s.duration=ultimate?185:75; s.elapsed=0;
      if(ultimate){
        if(s.hitsShown)hideTotal(s,true);
        if(s.scene.byKey[a.actor].side==='ally')endDomain(s);
      }
      sync(s);
    }
  }
  function loop(s,now) {
    if(current!==s || s.phase==='result') return;
    const period=1000/(s.powerSave?30:60);
    if(now+.25>=s.due) {
      const gap=now-s.last;
      s.last=now;
      // Keep the fractional remainder on panels running at e.g. 75 or 144 Hz.
      // After a suspended tab wakes up, discard deadlines already in the past.
      s.due+=Math.max(1,Math.floor((now+.25-s.due)/period)+1)*period;
      advance(s,Math.min(300,gap),now);
      if(s.phase!=='result') {
        s.scene.render(now,s.effectClock);
        placeNumbers(s);
        if(s.scene.ready) {s.presentedFrames++; s.renderedMs+=gap;}
      }
    }
    if(s.phase!=='result') s.frame=requestAnimationFrame(t=>loop(s,t));
  }
  function lootItem(src,label,value,rarity) {
    return '<li><span class="battle-loot-icon"><img class="loot-art" src="'+src+'" alt=""><img class="loot-frame" src="assets/ui/frame_'+rarity.toLowerCase()+'.png" alt=""></span><span>'+
      label+'</span><strong>'+value+'</strong></li>';
  }
  function finish(s) {
    if(s.phase==='result') return;
    s.phase='result';
    cancelAnimationFrame(s.frame);
    Sky.Battle.finish(s.battle);
    s.scene.resetMotion(true); s.scene.state(s.battle.units); s.scene.render(performance.now(),s.effectClock);
    releaseVideos(s); hideTotal(s); s.numbers.replaceChildren(); s.labels.length=0;
    s.root.classList.remove('spotlight');
    const loot=Sky.Save.settle(Sky.ui.state,s.battle);
    Sky.ui.save();
    const team=s.battle.units.filter(u=>u.side==='ally').sort((a,b)=>b.damage-a.damage || a.slot-b.slot);
    const damage=team.reduce((n,u)=>n+u.damage,0),max=Math.max(1,...team.flatMap(u=>[u.damage,u.healing]));
    const win=s.battle.win;
    const alive=team.filter(u=>u.hp>0).length;
    const stars=win ? 1+Number(alive>=4)+Number(alive===6) : 0;
    Sky.sound(win?'win':'lose');
    const report=team.map((u,i)=>{
      const h=Sky.D.hero(u.heroId);
      return '<div class="battle-contrib" data-hero="'+h.id+'" data-damage="'+u.damage+'">'+Sky.ui.frame(h.id)+'<b>'+shortName(h.name)+
        (i===0?'<img class="battle-mvp" src="'+Sky.art.emblem('mvp')+'" alt="最高伤害 MVP" title="最高伤害 MVP">':'')+'</b><div>'+
        Sky.ui.bar(u.damage/max*100,'gold')+Sky.ui.bar(u.healing/max*100,'cyan')+'</div><span>'+
        pretty(u.damage)+'<small>'+pretty(u.healing)+'</small></span></div>';
    }).join('');
    const drops=[];
    for(const [key,art,name,q] of [['diamonds','gem','星钻','UR'],['tickets','ticket','唤星券','SSR'],['coins','coin','星币','R'],['cores','core','共鸣晶核','SR']]) {
      if(loot[key]>0) drops.push(lootItem(Sky.art.item(art),name,'×'+pretty(loot[key]),q));
    }
    if(loot.gear) drops.push(lootItem(Sky.art.gear(loot.gear.slot,loot.gear.rarity),loot.gear.name,'×1',loot.gear.rarity));
    const recovery=!win && drops.length<=2 ? '<nav class="battle-recovery" aria-label="推荐提升"><b>推荐提升</b><div>'+
      control('resonate','共鸣升级')+control('gear','强化星装')+control('formation','调整编队')+'</div></nav>' : '';
    const spec=s.battle.spec, campaign=spec.kind==='campaign';
    const next=win && (campaign&&spec.id<10 || spec.kind==='tower'&&spec.id<30);
    const extra=spec.kind==='boss'?'最高纪录 '+pretty(Sky.ui.state.bossBest):spec.kind==='arena'?'累计胜场 '+Sky.ui.state.arenaWins:
      loot.first?'首次通关':'战斗结束';
    const panel=document.createElement('section');
    panel.className='battle-result'; panel.setAttribute('aria-label','战后结算');
    panel.dataset.outcome=win?'victory':'defeat';
    const assessment='<div class="battle-report-stars" data-stars="'+stars+'" aria-label="作战评星 '+stars+' / 3" title="胜利一星，至少四人存活两星，全员存活三星">'+
      [1,2,3].map(i=>'<img alt="" class="'+(i<=stars?'earned':'unearned')+'" src="'+Sky.art.emblem('star')+'">').join('')+'</div>';
    panel.innerHTML='<div class="battle-report"><div class="battle-report-heading"><img class="battle-medal" alt="" src="'+Sky.art.emblem(win?'victory':'defeat')+'"><div><span>'+labels[spec.kind]+'　/　'+s.battle.title+'</span>'+
      '<h2>'+(win?'作战胜利':'作战失利')+'</h2><p>'+extra+'　·　'+alive+' / 6 存活</p></div>'+assessment+'</div>'+
      '<div class="battle-report-columns"><div class="battle-stats"><h3>星灵贡献 <small>伤害 <em>／ 治疗</em></small></h3>'+report+
      '<p class="battle-cumulative">累计伤害 <b>'+pretty(damage)+'</b></p></div><div class="battle-drops"><h3>战利品 <small>已收入背包</small></h3><ul>'+drops.join('')+'</ul>'+recovery+
      '</div></div><div class="battle-report-actions">'+
      control('return',campaign?'返回航线':'返回试炼')+control('again','再战')+(next?control('next',campaign?'下一关':'下一层'):'')+'</div></div>';
    s.root.append(panel);
    s.root.classList.add('resolved');
  }
  function click(s,event) {
    const cast=event.target.closest('[data-cast]');
    if(cast && !s.auto && !cast.disabled && s.phase!=='result') {
      Sky.sound('tap');
      s.queued.add(Number(cast.dataset.cast)); refreshUI(s);
      if(s.phase==='ready') s.elapsed=s.duration;
      return;
    }
    const key=event.target.closest('[data-battle]')?.dataset.battle;
    if(!key) return;
    Sky.sound(key==='return'?'back':'tap');
    if(key==='auto'||key==='speed') {
      if(s.phase==='result') return;
      if(key==='auto'){s.auto=!s.auto;s.queued.clear();}
      else s.speed=s.speed%3+1;
      refreshUI(s); return;
    }
    if(key==='skip'){finish(s);return;}
    if(key==='resonate' || key==='gear' || key==='formation'){
      Sky.ui.go('roster',{rosterTab:key==='gear'?1:0,formation:key==='formation'});return;
    }
    const spec=s.battle.spec;
    if(key==='return') Sky.ui.go('campaign',{trials:spec.kind!=='campaign'});
    if(key==='again') Sky.ui.go('battle',{...spec});
    if(key==='next') Sky.ui.go('battle',{...spec,id:spec.id+1});
  }
  let preparing;
  function start(spec) {
    destroy();
    const ui=Sky.ui, battle=Sky.Battle.create(ui.state,spec);
    if(Sky.BattleScene){enter(battle);return;}
    const preparation=preparing={};
    ui.root.innerHTML='<section class="battle-preparing" aria-label="战台准备">'+
      '<p role="status">正在准备星盘战台</p><button type="button" data-battle-prepare-cancel>返回航线</button></section>';
    const pane=ui.root.firstElementChild;
    const back=pane.querySelector('button');
    if(battle.spec.kind!=='campaign')back.textContent='返回试炼';
    back.onclick=()=>ui.go('campaign',{trials:battle.spec.kind!=='campaign'});
    Sky.battleRenderer.load().then(()=>{
      if(preparing!==preparation)return;
      enter(battle);
      preparing=null;
    }).catch(error=>{
      if(preparing!==preparation)return;
      pane.querySelector('[role=status]').textContent=error.message;
      ui.root.replaceChildren(pane);
    });
  }
  function enter(battle) {
    const ui=Sky.ui;
    ui.root.innerHTML='<section class="battle-page" aria-label="六对六星盘战斗">'+
      '<div class="battle-stage"></div><div class="battle-numbers"></div>'+
      '<header class="battle-head"><div class="battle-round">回合 <strong>01</strong> / 20</div>'+
      '<h1 class="battle-title">'+battle.title+'</h1>'+
      '<nav aria-label="战斗控制">'+control('speed','1×')+control('auto','自动')+control('skip','跳过')+ui.audioButton()+'</nav></header>'+
      '<div class="battle-skill" data-side="ally"></div><div class="battle-skill" data-side="enemy"></div>'+
      '<div class="battle-total" hidden><small>总伤害</small><strong>0</strong><span class="battle-hits"></span></div>'+
      '<div class="battle-bottom">'+battle.units.filter(u=>u.side==='ally').map(card).join('')+'</div></section>';
    const root=ui.root.querySelector('.battle-page');
    const powerSave=ui.state.settings.powerSave;
    const backdrop=document.getElementById('bleed');
    const scene=new Sky.BattleScene(root.querySelector('.battle-stage'),battle.units,powerSave,backdrop.dataset.scene);
    const s={root,battle,scene,backdrop,powerSave,auto:true,speed:1,queued:new Set(),posters:new Map(),videos:new Map(),domains:new Map(),phase:'loading',elapsed:0,effectClock:0,hudClock:0,carry:0,labels:[],duration:450,
      cards:[...root.querySelectorAll('.battle-card')],autoButton:root.querySelector('[data-battle="auto"]'),speedButton:root.querySelector('[data-battle="speed"]'),
      round:root.querySelector('.battle-round strong'),total:root.querySelector('.battle-total'),
      ribbons:Object.fromEntries([...root.querySelectorAll('.battle-skill')].map(el=>[el.dataset.side,el])),
      numbers:root.querySelector('.battle-numbers'),rage:{},cutins:0,burstCount:0,totalUpdates:0,presentedFrames:0,renderedMs:0};
    current=s;
    root.addEventListener('click',e=>click(s,e));
    sync(s);
    prepareDomains(s);
    for(const id of ui.state.formation){
      posterImage(s,id);
      if(powerSave)continue;
      const ultimate=Sky.posterVideo.preload(id,'ultimate');
      const lobby=ultimate ? null : Sky.posterVideo.preload(id);
      if(ultimate || lobby)s.videos.set(id,{ultimate,lobby});
    }
    scene.load().then(()=>{
      if(current!==s || s.phase==='result') return;
      s.phase='ready'; s.last=performance.now(); s.due=s.last+1000/(powerSave?30:60); scene.render(s.last);
      s.frame=requestAnimationFrame(t=>loop(s,t));
    }).catch(error=>{
      if(current!==s || s.phase==='result') return;
      // Surface a missing/replaced artwork to the player while preserving the
      // deterministic engine and settlement buttons on the battlefield.
      ui.toast(error.message);
      s.phase='ready'; s.last=performance.now(); s.due=s.last+1000/(powerSave?30:60); s.frame=requestAnimationFrame(t=>loop(s,t));
    });
  }
  function destroy() {
    preparing=null;
    if(!current)return;
    releaseVideos(current);
    hideTotal(current);
    cancelAnimationFrame(current.frame);
    current.scene.destroy();
    current=null;
  }
  function inspect() {
    if(!current)return preparing ? {ready:false,phase:'loading'} : null;
    const s=current;
    return {...s.scene.inspect(),phase:s.phase,round:s.battle.round,cutins:s.cutins,burstCount:s.burstCount,
      totalUpdates:s.totalUpdates,presentedFrames:s.presentedFrames,renderedMs:s.renderedMs,
      auto:s.auto,speed:s.speed,done:s.battle.done,win:s.battle.win,settled:s.battle.settled};
  }
  Sky.battlePage={start,destroy,inspect};
})();
