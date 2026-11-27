(() => {
  'use strict';
  const {D,Save}=globalThis.Sky;
  const alive = unit => unit.hp>0;
  const members = (battle,side) => battle.units.filter(u=>u.side===side && alive(u));
  const opposite = side => side==='ally' ? 'enemy' : 'ally';
  const counter = (from,to) => D.advantage[from]===to ? 1.18 : 1;
  const pick = (list,rng) => list[Math.floor(rng()*list.length)];
  const frontOnly = units => {
    const front=units.filter(u=>u.slot<3);
    return front.length ? front : units;
  };
  function standardTarget(actor,opponents) {
    const front=frontOnly(opponents);
    return front.find(u=>u.slot%3===actor.slot%3) || front[0];
  }
  function scenario(s,input,rng) {
    const {kind}=input;
    const id=input.id??1;
    if (!Number.isInteger(id) || id<=0) throw new Error('无效战场编号');
    if (kind==='campaign') {
      const stage=D.stages[id-1];
      if (!stage || id>s.cleared+1) throw new Error('请先通关上一段航线');
      return {id,kind,title:stage.code+' · '+stage.name,team:stage.enemies,scale:stage.scale};
    }
    if (kind==='tower') {
      if (id>30 || id>s.tower+1) throw new Error('该层星门尚未解锁');
      return {id,kind,title:'星穹高塔 · 第 '+id+' 层',team:D.enemyTeams[(id-1)%5],scale:.75+(id-1)*.09};
    }
    if (kind==='boss') return {id,kind,title:'天城首领 · 浮空机神',team:['h08','h04','h07','h05','h02','h06'],scale:1.02};
    if (kind==='arena') return {id,kind,title:'星环演武 · 镜像小队',team:pick(D.enemyTeams,rng),scale:.82+Math.floor(s.arenaWins/3)*.09};
    throw new Error('未知战场');
  }
  function create(s,input,rng=Math.random) {
    const spec=scenario(s,input,rng);
    const units=[];
    for (const side of ['ally','enemy']) {
      const allied=side==='ally';
      const team=allied ? s.formation : spec.team;
      const auras=Save.bonds(team);
      team.forEach((heroId,slot) => {
        const h=D.hero(heroId);
        const base=allied ? Save.stats(s,heroId) : h;
        const bonus=auras.find(a=>a.faction===h.faction).bonus;
        const growth=(allied ? 1 : spec.scale)*(1+bonus);
        const boss=!allied && spec.kind==='boss' && slot===0;
        const hp=Math.round(base.hp*growth*(boss ? 17 : 1));
        units.push({key:(allied ? 'a' : 'e')+slot,heroId,side,slot,hp,maxHp:hp,
          atk:Math.round(base.atk*growth*(boss ? 1.6 : 1)),def:Math.round(base.def*growth),speed:base.speed,
          rage:allied ? (heroId==='h01' ? 75 : 36) : 18,shield:0,damage:0,healing:0,
          boss,awakened:allied && s.stars[heroId]>=5,
          status:{freeze:0,curse:0,breakArmor:0,encourage:0}});
      });
    }
    const order=[...units].sort((a,b)=> b.speed-a.speed || a.slot-b.slot).map(u=>u.key);
    return {spec:{kind:spec.kind,id:spec.id},title:spec.title,units,round:1,done:false,win:false,
      settled:false,order,cursor:0,rng};
  }
  const attackOf = u => u.atk*(u.status.curse ? .80 : 1)*(u.status.encourage ? 1.15 : 1);
  function addHit(event,target,kind,amount) {
    event.hits.push({target:target.key,kind,amount,hp:target.hp,shield:target.shield});
  }
  function damage(b,actor,target,factor,event) {
    // Armor softens each individual hit. Only damage that really crossed a shield counts.
    const faction=counter(D.hero(actor.heroId).faction,D.hero(target.heroId).faction);
    const def=target.def*(target.status.breakArmor ? .8 : 1);
    const raw=Math.max(1,Math.round(attackOf(actor)*factor*faction*(.94+b.rng()*.12)*(280/(280+def))));
    const absorbed=Math.min(target.shield,raw);
    target.shield-=absorbed;
    const dealt=Math.min(target.hp,raw-absorbed);
    target.hp-=dealt; actor.damage+=dealt;
    if (dealt>0 && alive(target)) target.rage=Math.min(100,target.rage+9);
    addHit(event,target,'damage',dealt);
    if (absorbed>0) {
      const reflected=Math.min(actor.hp,Math.round(absorbed*.30));
      actor.hp-=reflected; target.damage+=reflected;
      addHit(event,actor,'damage',reflected);
    }
    return dealt;
  }
  function heal(actor,target,amount,event) {
    const restore=Math.min(target.maxHp-target.hp,Math.max(0,Math.round(amount)));
    target.hp+=restore; actor.healing+=restore; addHit(event,target,'heal',restore);
  }
  function ultimate(b,actor,event) {
    const friends=members(b,actor.side);
    const opponents=members(b,opposite(actor.side));
    const primary=standardTarget(actor,opponents);
    const strength=actor.awakened ? 1.15 : 1;
    const strike=(target,factor)=>damage(b,actor,target,factor*strength,event);
    const magic=attackOf(actor)*strength;
    actor.rage=0;
    switch(actor.heroId) {
      case 'h01':
        for (let i=0;i<3 && alive(actor) && alive(primary);i++) strike(primary,1.05);
        primary.status.curse=2;
        break;
      case 'h02':
        for (const u of opponents) {
          if (!alive(actor)) break;
          strike(u,1.18);
          if (alive(u) && b.rng()<.25) u.status.freeze=1;
        }
        break;
      case 'h03':
        for (const u of friends) {
          heal(actor,u,magic*1.45,event);
          u.status.freeze=0; u.status.curse=0; u.status.breakArmor=0;
        }
        break;
      case 'h04':
        for (const u of frontOnly(friends)) {
          const old=u.shield;
          u.shield=Math.max(old,Math.round(magic*1.55));
          addHit(event,u,'shield',u.shield-old);
        }
        break;
      case 'h05':
        for (let i=0;i<4 && alive(actor);i++) {
          const targets=members(b,opposite(actor.side));
          if (!targets.length) break;
          const target=pick(targets,b.rng); strike(target,.85);
          if (!alive(target)) actor.rage=Math.min(100,actor.rage+35);
        }
        break;
      case 'h06': {
        const backs=opponents.filter(u=>u.slot>=3);
        const target=(backs.length ? backs : opponents).reduce((a,u)=>u.hp<a.hp ? u : a);
        const dealt=strike(target,2.65);
        if (alive(actor)) heal(actor,actor,dealt*.4,event);
        break;
      }
      case 'h07':
        for (const u of opponents.filter(t=>t.slot%3===primary.slot%3)) {
          if (alive(actor)) strike(u,1.5);
        }
        friends.forEach(u=>{u.status.encourage=2;});
        break;
      case 'h08':
        for (const u of frontOnly(opponents)) {
          if (!alive(actor)) break;
          strike(u,1.38); u.status.breakArmor=2;
        }
        break;
    }
  }
  function endIfNeeded(b,limit=false) {
    const allies=members(b,'ally'),enemies=members(b,'enemy');
    if (!allies.length || !enemies.length || limit) {
      // At the turn limit the defender holds the battlefield. Boss damage still earns rewards.
      b.done=true; b.win=!!allies.length && !enemies.length;
    }
  }
  function act(b,actor,kind) {
    const event={actor:actor.key,kind,hits:[],round:b.round};
    if (kind==='ultimate') ultimate(b,actor,event);
    else if (kind==='basic') {
      damage(b,actor,standardTarget(actor,members(b,opposite(actor.side))),1,event);
      actor.rage=Math.min(100,actor.rage+34);
    }
    endIfNeeded(b);
    return event;
  }
  function step(b,auto=true) {
    if (b.done) return null;
    for (;;) {
      if (b.cursor===b.order.length) {
        b.cursor=0;
        if (b.round===20) { endIfNeeded(b,true); return null; }
        b.round++;
      }
      const key=b.order[b.cursor++];
      const actor=b.units.find(u=>u.key===key);
      if (!alive(actor)) continue;
      const status=actor.status;
      const old={...status};
      let kind='basic';
      if (status.freeze) kind='stun';
      else if (actor.rage>=100 && (auto || actor.side==='enemy')) kind='ultimate';
      const event=act(b,actor,kind);
      for (const key of Object.keys(old)) {
        // Do not immediately consume this actor's own freshly cast team buff.
        if (old[key]>0 && !(kind==='ultimate' && actor.heroId==='h07' && key==='encourage')) {
          status[key]=Math.max(0,status[key]-1);
        }
      }
      return event;
    }
  }
  function cast(b,slot) {
    if (b.done) return null;
    const actor=b.units.find(u=>u.side==='ally' && u.slot===slot);
    if (!actor || !alive(actor) || actor.rage<100 || actor.status.freeze) return null;
    return act(b,actor,'ultimate');
  }
  function finish(b) {
    while (!b.done) step(b,true);
    return b;
  }
  globalThis.Sky.Battle={create,step,cast,finish,counter,standardTarget};
})();
