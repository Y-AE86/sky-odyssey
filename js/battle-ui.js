(() => {
  'use strict';
  const Sky=window.Sky;
  const labels={campaign:'主线航线',tower:'星穹高塔',boss:'天城首领',arena:'星环演武'};
  const shortName=name=>name.split(' · ')[0];
  const pretty=n=>Number(n).toLocaleString('zh-CN');
  const amountPrefix={damage:'−',heal:'+',shield:'盾 +' };
  let current;

  function control(action,label) {
    return '<button type="button" data-battle="'+action+'">'+label+'</button>';
  }
  function bars(u) {
    return Sky.ui.bar(u.hp/u.maxHp*100,'cyan')+Sky.ui.bar(u.rage,'gold');
  }
  function card(u) {
    const h=Sky.D.hero(u.heroId);
    return '<button class="battle-card" type="button" data-cast="'+u.slot+'" aria-label="'+h.name+'释放必杀">'+
      Sky.ui.frame(h.id)+'<span class="battle-card-info"><strong>'+shortName(h.name)+'</strong><span class="battle-card-bars">'+bars(u)+
      '</span><small class="battle-rage">'+u.rage+' / 100</small></span></button>';
  }
  function refreshUI(s) {
    const allies=s.battle.units.filter(u=>u.side==='ally');
    allies.forEach((u,i)=>{
      const button=s.cards[i], display=s.scene.byKey[u.key];
      const hp=display.hp, rage=s.rage[u.key];
      const stamp=[hp,rage,s.auto,s.queued.has(i)].join('/');
      if(button.dataset.state===stamp) return;
      button.dataset.state=stamp;
      const ready=hp>0 && rage===100;
      button.disabled=s.auto || !ready;
      button.classList.toggle('is-charged',ready);
      button.classList.toggle('ready',ready && !s.auto);
      button.classList.toggle('lost',hp<=0);
      button.querySelector('.battle-card-bars').innerHTML=bars({...u,hp,rage});
      button.querySelector('.battle-rage').textContent=s.queued.has(i)?'待释放':ready?'必杀就绪':rage+' / 100';
    });
    const nodes=s.scene.nodes;
    s.groupCount.textContent='我方 '+nodes.filter(n=>n.side==='ally'&&n.hp>0).length+' / 6　·　敌方 '+nodes.filter(n=>n.side==='enemy'&&n.hp>0).length+' / 6';
    s.round.textContent=String(s.battle.round).padStart(2,'0');
    s.root.querySelector('[data-battle="auto"]').textContent=s.auto?'自动':'手动';
    s.root.querySelector('[data-battle="speed"]').textContent=s.speed+'×';
  }
  function speak(s,text) {s.log.textContent=text;}
  function sync(s) {
    s.scene.state(s.battle.units);
    for(const u of s.battle.units) s.rage[u.key]=u.rage;
    refreshUI(s);
  }
  function popup(s,n,hit) {
    const number=document.createElement('span');
    number.className='battle-float '+hit.kind;
    number.textContent=hit.kind==='damage' && !hit.amount?'抵挡':amountPrefix[hit.kind]+pretty(hit.amount);
    // Each hit on the same target gets its own column during the short combo.
    const group=s.action.hits.filter(other=>other.target===hit.target);
    const index=group.indexOf(hit);
    if(group.length>1)number.classList.add('combo-hit');
    const longest=Math.max(...group.map(other=>pretty(other.amount).length));
    const pitch=Math.max(6.3,(longest+1)*1.43+1);
    const half=(group.length-1)*pitch/2;
    const center=Math.max(half+pitch/2,Math.min(100-half-pitch/2,n.x*100));
    number.style.left=(center-half+index*pitch)+'%';
    number.style.top=(n.y*100-18-(index%2)*2)+'%';
    s.numbers.append(number);
    number.addEventListener('animationend',()=>number.remove(),{once:true});
  }
  function posterImage(s,id) {
    if(!s.posters.has(id)){
      const image=new Image();
      image.decoding='async';
      image.src=Sky.art(id,'poster');
      s.posters.set(id,image);
    }
    return s.posters.get(id);
  }
  async function showCutin(s) {
    s.phase='loading-cutin';
    const image=posterImage(s,s.hero.id);
    try {
      await image.decode();
    } catch {
      if(current===s && s.phase==='loading-cutin') startImpact(s);
      return;
    }
    if(current!==s || s.phase!=='loading-cutin') return;
    const hero=s.hero, cut=document.createElement('div');
    cut.className='battle-cutin';
    cut.dataset.hero=hero.id;
    const poster=image.src;
    Sky.ui.cinematic(poster);
    cut.style.setProperty('--cut-image','url("'+poster+'")');
    cut.innerHTML='<div class="battle-cut-image"></div><div class="battle-cut-streak"></div><div class="battle-cut-title"><span>'+
      hero.faction+'　/　'+hero.name+'</span><strong>'+hero.ult+'</strong></div>';
    s.root.append(cut);
    s.phase='cutin'; s.cutStart=performance.now(); s.cutins++; s.cutin=cut;
    Sky.sound('ultimate');
  }
  function startImpact(s) {
    s.phase='motion'; s.elapsed=0; s.hitIndex=0; s.sum=0; s.hitsShown=0;
    const action=s.action, ultimate=action.kind==='ultimate',hits=action.hits;
    s.duration=action.kind==='stun'?230:ultimate?610+Math.max(0,hits.length-1)*108:430;
    if(ultimate) {
      s.burstCount++;
      s.scene.focus=new Set([action.actor,...hits.map(h=>h.target)]);
      s.root.classList.add('spotlight');
      const node=s.scene.byKey[action.actor];
      s.root.style.setProperty('--spot-x',node.x*100+'%');
      s.root.style.setProperty('--spot-y',(node.y-.11)*100+'%');
      s.total.hidden=false;
      s.total.querySelector('small').textContent=hits.every(h=>h.kind==='heal')?'总治疗':hits.every(h=>h.kind==='shield')?'总护盾':'总伤害';
      s.total.querySelector('strong').textContent='0';
      s.total.querySelector('.battle-hits').textContent='';
    }
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
    s.round.textContent=String(action.round).padStart(2,'0');
    speak(s,(unit.side==='ally'?'我方 · ':'敌方 · ')+shortName(s.hero.name)+'　'+
      (action.kind==='ultimate'?s.hero.ult:action.kind==='stun'?'冰冻':'普攻'));
    refreshUI(s);
    if(action.kind==='ultimate' && unit.side==='ally') showCutin(s);
    else startImpact(s);
  }
  function advance(s,dt,now) {
    if(s.phase==='cutin') {
      if(now-s.cutStart<850) return;
      s.cutin.remove(); s.cutin=null; Sky.ui.cinematic(null); startImpact(s);
      return;
    }
    s.elapsed+=dt*s.speed;
    if(s.phase==='ready') {
      if(s.elapsed>=s.duration) nextAction(s);
      return;
    }
    if(s.phase!=='motion') return;
    const a=s.action, ultimate=a.kind==='ultimate';
    const progress=Math.min(1,s.elapsed/s.duration);
    const target=a.hits[0]?.target;
    if(target) s.scene.elapsedAction(a.actor,target,progress,a.kind==='basic');
    while(s.hitIndex<a.hits.length) {
      const due=ultimate?80+s.hitIndex*108:174+s.hitIndex*36;
      if(s.elapsed<due) break;
      const hit=a.hits[s.hitIndex];
      s.scene.hit(a.actor,hit,s.hero.element,ultimate,now);
      popup(s,s.scene.byKey[hit.target],hit);
      if(ultimate) {
        const kind=s.total.querySelector('small').textContent==='总治疗'?'heal':
          s.total.querySelector('small').textContent==='总护盾'?'shield':'damage';
        if(hit.kind===kind && (kind!=='damage' || s.scene.byKey[a.actor].side!==s.scene.byKey[hit.target].side)) {
          s.sum+=hit.amount;
          s.total.querySelector('strong').textContent=pretty(s.sum);
          s.hitsShown++;
          s.total.querySelector('.battle-hits').textContent=kind==='damage'
            ? s.hitsShown+(s.hitsShown===1?' HIT':' HITS') : s.hitsShown+' 次施加';
          s.totalUpdates++;
        }
      }
      if(!s.hitIndex && !ultimate) Sky.sound('hit');
      s.hitIndex++; refreshUI(s);
    }
    if(progress===1) {
      s.scene.resetMotion(); s.root.classList.remove('spotlight');
      s.total.hidden=true; sync(s);
      s.phase='ready'; s.duration=ultimate?185:75; s.elapsed=0;
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
        s.scene.render(now);
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
    s.scene.resetMotion(); s.scene.state(s.battle.units); s.scene.render(performance.now());
    s.cutin?.remove(); Sky.ui.cinematic(null); s.total.hidden=true; s.numbers.replaceChildren();
    s.root.classList.remove('spotlight');
    const loot=Sky.Save.settle(Sky.ui.state,s.battle);
    Sky.ui.save();
    const team=s.battle.units.filter(u=>u.side==='ally').sort((a,b)=>b.damage-a.damage || a.slot-b.slot);
    const damage=team.reduce((n,u)=>n+u.damage,0),max=Math.max(1,...team.flatMap(u=>[u.damage,u.healing]));
    const win=s.battle.win;
    const alive=team.filter(u=>u.hp>0).length;
    const stars=win ? 1+Number(alive>=4)+Number(alive===6) : 0;
    if(win) Sky.sound('win');
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
      s.queued.add(Number(cast.dataset.cast)); refreshUI(s);
      if(s.phase==='ready') s.elapsed=s.duration;
      return;
    }
    const key=event.target.closest('[data-battle]')?.dataset.battle;
    if(!key) return;
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
  function start(spec) {
    destroy();
    const ui=Sky.ui, battle=Sky.Battle.create(ui.state,spec);
    ui.root.innerHTML='<section class="battle-page" aria-label="六对六星盘战斗">'+
      '<div class="battle-shade"></div><div class="battle-stage"></div><div class="battle-numbers"></div>'+
      '<header class="battle-head"><div class="battle-allegiance"><b>'+labels[spec.kind]+'</b><small></small></div>'+
      '<div class="battle-round"><b>'+battle.title+'</b><span>回合 <strong>01</strong> / 20</span></div>'+
      '<nav aria-label="战斗控制">'+control('speed','1×')+control('auto','自动')+control('skip','跳过战斗')+'</nav></header>'+
      '<div class="battle-log">舰队入阵</div><div class="battle-total" hidden><small>总伤害</small><strong>0</strong><span class="battle-hits"></span></div>'+
      '<div class="battle-bottom">'+battle.units.filter(u=>u.side==='ally').map(card).join('')+'</div></section>';
    const root=ui.root.querySelector('.battle-page');
    const powerSave=ui.state.settings.powerSave;
    const scene=new Sky.BattleScene(root.querySelector('.battle-stage'),battle.units,powerSave);
    const s={root,battle,scene,powerSave,auto:true,speed:1,queued:new Set(),posters:new Map(),phase:'loading',elapsed:0,duration:450,
      cards:[...root.querySelectorAll('.battle-card')],groupCount:root.querySelector('.battle-allegiance small'),
      round:root.querySelector('.battle-round strong'),log:root.querySelector('.battle-log'),total:root.querySelector('.battle-total'),
      numbers:root.querySelector('.battle-numbers'),rage:{},cutins:0,burstCount:0,totalUpdates:0,presentedFrames:0,renderedMs:0};
    current=s;
    root.addEventListener('click',e=>click(s,e));
    sync(s);
    scene.load().then(()=>{
      if(current!==s || s.phase==='result') return;
      s.phase='ready'; s.last=performance.now(); s.due=s.last+1000/(powerSave?30:60); scene.render(s.last);
      s.frame=requestAnimationFrame(t=>loop(s,t));
      for(const id of ui.state.formation) if(Sky.D.illustrated.includes(id)) posterImage(s,id);
    }).catch(error=>{
      if(current!==s || s.phase==='result') return;
      // Surface a missing/replaced artwork to the player while preserving the
      // deterministic engine and settlement buttons on the battlefield.
      speak(s,error.message); ui.toast(error.message);
      s.phase='ready'; s.last=performance.now(); s.due=s.last+1000/(powerSave?30:60); s.frame=requestAnimationFrame(t=>loop(s,t));
    });
  }
  function destroy() {
    if(!current)return;
    Sky.ui.cinematic(null);
    cancelAnimationFrame(current.frame);
    current.scene.destroy();
    current=null;
  }
  function inspect() {
    if(!current)return null;
    const s=current;
    return {...s.scene.inspect(),phase:s.phase,round:s.battle.round,cutins:s.cutins,burstCount:s.burstCount,
      totalUpdates:s.totalUpdates,presentedFrames:s.presentedFrames,renderedMs:s.renderedMs,
      auto:s.auto,speed:s.speed,done:s.battle.done,win:s.battle.win,settled:s.battle.settled};
  }
  Sky.battlePage={start,destroy,inspect};
})();
