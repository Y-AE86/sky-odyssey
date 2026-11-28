'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
require('../js/data.js');
require('../js/save.js');
require('../js/battle-engine.js');
const {D,Save:S,Battle:B}=globalThis.Sky;
const now=new Date(2026,10,27,14,0,0).getTime();
test('十一张看板按序循环，旧看板与未招募角色的选择均可存取及导入导出',()=>{
  const expected=Array.from({length:11},(_,i)=>'h'+String(i+1).padStart(2,'0'));
  assert.deepEqual(D.illustrated,expected);
  const memory=new Map();
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key=>memory.get(key) ?? null,setItem:(key,value)=>memory.set(key,value)
  }});
  try{
    const s=S.fresh();
    assert.equal(s.settings.poster,'h01');
    assert(!s.owned.includes('h11'));
    for(const id of expected){
      assert.equal(s.settings.poster,id);
      S.write(s);
      assert.deepEqual(S.load(),s);
      assert.deepEqual(S.importJSON(S.exportJSON(s)),s);
      s.settings.poster=D.nextPoster(id);
    }
    assert.equal(s.settings.poster,'h01');
    for(const id of expected.slice(0,3)){
      const legacy=structuredClone(s);
      legacy.settings.poster=id;
      delete legacy.firstTenDone;
      const loaded=S.importJSON(JSON.stringify(legacy));
      assert.equal(loaded.settings.poster,id);
      assert.deepEqual(loaded.formation,s.formation);
    }
    for(const invalid of ['h12','h99','enemy_caster','',null]){
      s.settings.poster=invalid;
      assert.throws(()=>S.write(s));
      assert.throws(()=>S.importJSON(JSON.stringify(s)));
    }
    assert.equal(memory.size,1);
    assert.equal(S.load().settings.poster,'h11');
  }finally{
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);
    else delete globalThis.localStorage;
  }
});
test('八人旧档保留望舒和希露的原角色编号、星级、星装、碎片与队伍',()=>{
  const legacy=S.fresh();
  legacy.owned.push('h06','h07');
  S.assign(legacy,0,'h07');
  S.autoEquip(legacy,'h07');
  const {h07:wang,h08:xi}=structuredClone(legacy.equipment);
  legacy.shards.h07=15; legacy.stars.h07=3;
  legacy.shards.h08=21; legacy.stars.h08=2;
  legacy.pity.standard={ur:53,ssr:7};
  for(const id of ['h09','h10','h11']) {
    delete legacy.stars[id]; delete legacy.shards[id]; delete legacy.equipment[id];
  }
  const loaded=S.importJSON(JSON.stringify(legacy));
  assert.match(D.hero('h07').name,/望舒/u); assert.match(D.hero('h08').name,/希露/u);
  assert.deepEqual(loaded.formation,legacy.formation);
  assert.equal(loaded.formation[0],'h07'); assert.equal(loaded.formation[1],'h08');
  assert.deepEqual([loaded.equipment.h07,loaded.equipment.h08],[wang,xi]);
  assert.deepEqual([loaded.stars.h07,loaded.shards.h07,loaded.stars.h08,loaded.shards.h08],[3,15,2,21]);
  assert.deepEqual([S.stats(loaded,'h07'),S.stats(loaded,'h08')],[
    {hp:1698,atk:242,def:86,speed:101},{hp:1672,atk:146,def:95,speed:87}
  ]);
  assert.deepEqual(loaded.pity.standard,{ur:53,ssr:7});
  for(const id of ['h09','h10','h11']) {
    assert.equal(loaded.stars[id],1); assert.equal(loaded.shards[id],0);
    assert.deepEqual(loaded.equipment[id],[null,null,null,null]);
    assert(!loaded.owned.includes(id));
  }
  const partial=structuredClone(loaded);
  delete partial.equipment.h11;
  assert.throws(()=>S.importJSON(JSON.stringify(partial)),/存档/);
  legacy.owned.push('h11');
  assert.throws(()=>S.importJSON(JSON.stringify(legacy)),/存档/);
  loaded.owned.push('h09','h10','h11');
  assert.equal(S.importJSON(S.exportJSON(loaded)).owned.length,11);
});
test('整套星装强化一次扣款，余额不足时四件均保持原等级',()=>{
  const s=S.fresh(now);
  S.autoEquip(s,'h01');
  const kit=S.equippedUpgrade(s,'h01'), before=s.coins;
  assert.equal(kit.items.length,4);
  assert.equal(S.enhanceAll(s,'h01'),4);
  assert.equal(s.coins,before-kit.cost);
  assert(kit.items.every(item=>item.level===1));
  s.coins=1;
  assert.throws(()=>S.enhanceAll(s,'h01'));
  assert.equal(s.coins,1);
  assert(kit.items.every(item=>item.level===1));
});
test('启航七日按本地日历发奖，重开、重复领取和活动结束均保留限制',()=>{
  const s=S.fresh(now);
  assert.deepEqual(S.claimEvent(s,now),{tickets:1,cores:5});
  assert.throws(()=>S.claimEvent(s,now));
  const seventh=new Date(2026,11,3,0,1).getTime();
  assert.equal(S.launchEvent(s,seventh).day,7);
  assert.equal(S.claimEvent(s,seventh).tickets,3);
  const restored=S.importJSON(S.exportJSON(s));
  assert.deepEqual(restored.event.days,[1,7]);
  assert.throws(()=>S.claimEvent(restored,new Date(2026,11,4).getTime()));
});
function seeded(seed) {
  let v=seed>>>0;
  return () => {
    v=(Math.imul(v,1664525)+1013904223)>>>0;
    return v/4294967296;
  };
}
function freshBattle(id='h01',rng=()=>.54) {
  const s=S.fresh(now);
  if (!s.owned.includes(id)) s.owned.push(id);
  S.assign(s,0,id);
  const b=B.create(s,{kind:'campaign',id:1},rng);
  return {s,b,hero:b.units[0],allies:b.units.slice(0,6),enemies:b.units.slice(6)};
}
function ult(fixture) {
  fixture.hero.rage=100;
  const e=B.cast(fixture.b,fixture.hero.slot);
  assert.equal(e.kind,'ultimate');
  return e;
}

test('independent starters, native weapon resonance, shared team level and equipment',()=>{
  const s=S.fresh(now),other=S.fresh(now);
  assert.deepEqual(s.formation,D.starter);
  assert.equal(new Set(s.formation).size,6);
  assert.deepEqual([s.tickets,s.diamonds,s.settings.powerSave],[30,4800,false]);
  const weapons=['忘川墨镰','霜华星杖','潮生玉笛','白昼圣盾','双子铳星','赤月棘刃',
    '星渊浑天星杖','苍雷弧光太刀','离火焚天凤枪','月潮琉璃剑','暗冕鸦羽棘镰'];
  assert.deepEqual(D.heroes.map(h=>h.weapon),weapons);
  assert(D.heroes.every(h=>h.weaponBonus===.06));
  // Compare pre-Wave 8 final profiles, including starter gear on h08.
  assert.deepEqual(D.illustrated.map(id=>{const {hp,atk}=S.stats(s,id);return [hp,atk];}),[
    [1121,195],[1124,187],[1283,159],[1611,147],[1039,179],[1177,179],
    [1160,149],[1520,132],[1040,180],[1110,141],[1050,179]
  ]);
  const before=s.owned.map(id=>S.stats(s,id));
  const cost=S.upgradeCost(s);
  S.upgrade(s);
  assert.equal(s.coins,other.coins-cost.coins);
  assert.equal(s.cores,other.cores-cost.cores);
  s.owned.forEach((id,i)=>assert(S.stats(s,id).hp>before[i].hp));
  assert.equal(other.level,1);
  S.autoEquip(s,'h01');
  assert(s.equipment.h01.every(Boolean));
  assert.equal(new Set(s.equipment.h01).size,4);
  const item=s.bag.find(i=>i.uid===s.equipment.h01[0]);
  assert.equal(item.rarity,'SSR');
  const atk=S.stats(s,'h01').atk;
  S.enhance(s,item.uid);
  assert(S.stats(s,'h01').atk>atk);
  assert.throws(()=>S.equip(s,'h02',0,item.uid),/已由/);
  assert.throws(()=>S.equip(s,'h01',2,item.uid),/不匹配/);
  assert.throws(()=>S.starUp(s,'h01'),/碎片不足/);
  s.shards.h01=36; S.starUp(s,'h01'); S.starUp(s,'h01');
  assert.equal(s.stars.h01,3); assert.equal(s.shards.h01,0);
  S.validate(s);
});
test('formation swaps, recruits, deploys, replaces and cannot duplicate a unit',()=>{
  const s=S.fresh(now),old=[...s.formation];
  S.assign(s,0,old[5]);
  assert.deepEqual([s.formation[0],s.formation[5]],[old[5],old[0]]);
  assert.throws(()=>S.assign(s,1,'h07'),/先获得/);
  s.owned.push('h07'); S.assign(s,0,'h07');
  assert.equal(s.formation[0],'h07');
  assert.equal(new Set(s.formation).size,6); S.validate(s);
  for (const tier of [2,4,6]) {
    const bond=S.bonds(Array(tier).fill('h01')).find(b=>b.faction==='东煌');
    assert.equal(bond.tier,tier); assert(bond.bonus>0);
  }
});
test('offline production cap, fractional production, daily reset and one-time claims',()=>{
  const s=S.fresh(now);
  const first=S.claimIdle(s,now);
  assert.deepEqual([first.coins,first.cores],[48,2]);
  assert.throws(()=>S.claimIdle(s,now));
  for(let i=1;i<=12;i++) S.claimIdle(s,now+i*5000);
  assert.equal(s.cores,123);
  const cap=S.claimIdle(s,now+24*3600000);
  assert.equal(cap.seconds,28800); assert.equal(cap.cores,480);
  S.claimWelfare(s); assert.equal(s.tickets,36); assert.throws(()=>S.claimWelfare(s));
  assert.throws(()=>S.claimDaily(s,now));
  s.daily.battles=1; S.claimDaily(s,now); assert.throws(()=>S.claimDaily(s,now));
  S.refreshDaily(s,now+86400000); assert.equal(s.daily.battles,0); assert.equal(s.daily.claimed,false);
});
test('JSON round-trip validates origin, imported field ranges, equipment ownership and resource atomicity',()=>{
  const s=S.fresh(); assert.deepEqual(S.importJSON(S.exportJSON(s)),s);
  const storage=new Map();
  globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  S.write(s); assert.deepEqual(S.load(),s); assert.deepEqual([...storage.keys()],['sky_odyssey_save_v1']);
  delete globalThis.localStorage;
  for(const change of [v=>{v.version=2;},v=>{v.tickets=-10;},v=>{v.formation[1]=v.formation[0];},
    v=>{v.pity.up.ur=60;},v=>{v.bag[0].name='<b>unsafe</b>';},v=>{v.equipment.h02[0]=v.bag[0].uid;}]) {
    const invalid=structuredClone(s); change(invalid);
    assert.throws(()=>S.importJSON(JSON.stringify(invalid)));
  }
  s.tickets=0;s.coins=0;const before=JSON.stringify(s);
  assert.throws(()=>S.draw(s,'up',10)); assert.throws(()=>S.upgrade(s)); assert.throws(()=>S.exchange(s,31));
  assert.equal(JSON.stringify(s),before); S.exchange(s,30); assert.equal(s.tickets,30); assert.equal(s.diamonds,0);
});
test('every pull grants SSR or UR, with a sixty-pull UR guarantee per pool',()=>{
  const s=S.fresh(); s.tickets=120;
  const ssr=S.draw(s,'standard',10,()=>.99);
  assert(ssr.every(x=>x.rarity==='SSR'));
  assert.deepEqual(s.pity.up,{ur:0,ssr:0});assert.equal(s.pity.standard.ur,10);
  for(let i=11;i<=59;i++) assert.notEqual(S.draw(s,'standard',1,()=>.99)[0].rarity,'UR');
  const pulled=S.draw(s,'standard',1,()=>.99)[0];
  assert.equal(pulled.id,'h11'); assert.equal(pulled.shards,0);
  assert.deepEqual(s.pity.standard,{ur:0,ssr:0});
  const recruits=S.draw(s,'up',10,()=>.64);
  assert.equal(recruits[0].id,'h07');assert.equal(recruits[0].isNew,true);
  assert.equal(recruits[1].shards,12); assert(s.owned.includes('h07'));
});
test('both pools include all eleven heroes and match published 2/98 rates and UP distribution',()=>{
  for(const pool of ['standard','up']) {
    const s=S.fresh(),rng=seeded(9020),n=60000;
    s.tickets=n;
    const counts=Object.fromEntries(D.heroes.map(h=>[h.id,0]));
    let ur=0;
    for(let i=0;i<n;i++) {
      s.pity[pool].ur=0;
      const [r]=S.draw(s,pool,1,rng); counts[r.id]++;
      assert.equal(r.rarity,D.hero(r.id).rarity);
      if(r.rarity==='UR')ur++;
    }
    assert(Math.abs(ur/n-S.poolRates.ur)<.002);
    assert(Math.abs((n-ur)/n-S.poolRates.ssr)<.002);
    assert.equal(s.owned.length,11);
    for(const hero of D.heroes) {
      if(hero.rarity==='SSR') assert(Math.abs(counts[hero.id]/(n-ur)-1/7)<.012);
      else {
        const probability=pool==='standard' ? .25 : hero.id==='h01' ? .75 : 1/12;
        assert(Math.abs(counts[hero.id]/ur-probability)<.05);
      }
    }
  }
});
test('首个十连跨池仅触发一次，旧档兼容，保底卡、碎片与正常保底同时记账',()=>{
  const initial=S.fresh();
  delete initial.firstTenDone;
  const s=S.importJSON(JSON.stringify(initial));
  assert.equal(s.firstTenDone,false);
  const single=S.draw(s,'up',1,()=>.99);
  assert.equal(single[0].rarity,'SSR');
  assert.equal(s.firstTenDone,false);
  const before=s.shards.h03;
  const first=S.draw(s,'standard',10,()=>.99);
  assert.equal(first.at(-1).id,'h03');
  assert.equal(first.at(-1).shards,12);
  assert.equal(s.shards.h03,before+12);
  assert.deepEqual(s.pity.standard,{ur:10,ssr:0});
  const reloaded=S.importJSON(S.exportJSON(s));
  const second=S.draw(reloaded,'up',10,()=>.99);
  assert(second.every(x=>!['h01','h02','h03'].includes(x.id)));
  const ur=S.fresh();
  ur.pity.standard.ur=50;
  assert.equal(S.draw(ur,'standard',10,()=>.99).at(-1).id,'h02');
  assert.deepEqual(ur.pity.standard,{ur:0,ssr:0});
  const empty=S.fresh();
  empty.tickets=9;
  assert.throws(()=>S.draw(empty,'standard',10));
  assert.equal(empty.firstTenDone,false);
});
test('6v6 teams, counter cycle, actual +18% damage and front-row targeting',()=>{
  const {b,hero,enemies}=freshBattle();
  assert.equal(b.units.length,12);assert.equal(new Set(b.units.map(u=>u.key)).size,12);
  for(const [from,to] of Object.entries(D.advantage)) {
    assert.equal(B.counter(from,to),1.18);assert.equal(B.counter(to,from),1);
  }
  assert.equal(B.standardTarget(hero,enemies).slot,0);
  assert.equal(B.standardTarget(hero,enemies.slice(3)).slot,3);
  const same=freshBattle(),adv=freshBattle();
  same.enemies[0].heroId='h01';adv.enemies[0].heroId='h06';
  const x=ult(same).hits[0].amount,y=ult(adv).hits[0].amount;
  assert(Math.abs(y/x-1.18)<.009);
});
test('all eleven ultimates resolve their target patterns, statuses, HP, shields and rage',()=>{
  const ink=freshBattle();
  const hit=ult(ink);assert.equal(hit.hits.length,3);assert.equal(ink.enemies[0].status.curse,2);
  assert(hit.hits.every((h,i,list)=>!i || h.hp<list[i-1].hp));
  assert.equal(B.cast(ink.b,0),null);
  const ice=freshBattle('h02',()=>0);assert.equal(ult(ice).hits.length,6);
  assert(ice.enemies.every(u=>u.status.freeze===1));
  let frozen;
  do { frozen=B.step(ice.b,true); } while(!frozen.actor.startsWith('e'));
  assert.equal(frozen.kind,'stun');
  const water=freshBattle('h03');
  water.allies.forEach(u=>{u.hp-=120;u.status.freeze=1;u.status.curse=1;});
  water.hero.status.freeze=0;
  assert.equal(ult(water).hits.length,6);assert.equal(water.hero.healing,720);
  assert(water.allies.every(u=>u.hp===u.maxHp && !u.status.freeze && !u.status.curse));
  const shield=freshBattle('h04'); const guard=ult(shield);
  assert.deepEqual(guard.hits.map(h=>h.target),['a0','a1','a2']);
  assert(shield.allies.slice(0,3).every(u=>u.shield>0));
  let reflected;
  do { reflected=B.step(shield.b); } while(!reflected.actor.startsWith('e'));
  assert(reflected.hits.some(h=>h.target===reflected.actor));
  const shot=freshBattle('h05',()=>0);shot.enemies[0].hp=1;
  assert.equal(ult(shot).hits.length,4);assert.equal(shot.hero.rage,35);
  const blood=freshBattle('h06');blood.enemies[4].hp=20;blood.hero.hp-=100;
  const drain=ult(blood);assert.equal(drain.hits[0].target,'e4');assert.equal(blood.hero.healing,8);
  const star=freshBattle('h07'); assert.equal(ult(star).hits.length,6);
  assert(star.allies.every(u=>u.status.encourage===2));
  assert.deepEqual(star.enemies.filter(u=>u.status.freeze===1).map(u=>u.slot),[0,3]);
  const thunder=freshBattle('h08');assert.equal(ult(thunder).hits.length,3);
  assert(thunder.enemies.slice(0,3).every(u=>u.status.breakArmor===2));
  assert.deepEqual(thunder.enemies.filter(u=>u.status.freeze===1).map(u=>u.slot),[0]);
  const fire=freshBattle('h09');
  assert.equal(ult(fire).hits.length,6); assert(fire.enemies.every(u=>u.status.burn===2));
  const victim=fire.enemies[0];
  fire.b.order.unshift(victim.key);
  victim.shield=500; victim.status.freeze=1;
  const before=victim.hp,damage=fire.hero.damage;
  const tick=B.step(fire.b);
  assert.equal(tick.kind,'stun');
  assert.equal(tick.hits[0].periodic,true);
  assert.equal(tick.hits[0].source,fire.hero.key);
  assert.equal(victim.hp,before-tick.hits[0].amount);
  assert.equal(victim.shield,500);
  assert.equal(fire.hero.damage,damage+tick.hits[0].amount);
  assert.equal(victim.status.burn,1);
  fire.b.cursor=0; B.step(fire.b); assert.equal(victim.status.burn,0);
  const tide=freshBattle('h10');
  tide.allies.forEach(u=>{u.hp-=60; u.rage=90; u.status.burn=2; u.status.breakArmor=2;});
  const healed=ult(tide);
  assert.equal(healed.hits.length,6); assert.equal(tide.hero.healing,360);
  assert(tide.allies.every(u=>u.hp===u.maxHp && !u.status.burn && !u.status.breakArmor));
  assert.equal(tide.hero.rage,0); assert(tide.allies.slice(1).every(u=>u.rage===100));
  const night=freshBattle('h11');
  night.enemies[4].hp=Math.round(night.enemies[4].maxHp*.55);
  const execution=ult(night);
  assert.deepEqual(execution.hits.map(h=>h.target),['e4','e4']);
});
test('chapter finales, tower milestones and the boss trial field Astra and five dedicated guards',()=>{
  const s=S.fresh(); s.cleared=10; s.tower=30;
  const enemyIds=D.enemies.map(e=>e.id);
  const foes=spec=>B.create(s,spec).units.slice(6);
  for(const [kind,stages] of [['campaign',[5,10]],['tower',[5,10,15,20,25,30]],['boss',[1]]]) {
    for(const id of stages) {
      const army=foes({kind,id});
      assert(army.every(u=>enemyIds.includes(u.heroId)));
      assert.equal(army[1].heroId,'enemy_boss_mech');
      assert.equal(army[1].boss,true);
      assert.equal(army.filter(u=>u.boss).length,1);
      assert(army[1].maxHp>army[0].maxHp*1.5);
    }
  }
  for(const kind of ['campaign','tower']) {
    assert(foes({kind,id:1}).every(u=>!u.boss && enemyIds.includes(u.heroId)));
  }
  assert(foes({kind:'arena',id:1}).every(u=>!enemyIds.includes(u.heroId)));
  const invalid=S.fresh();
  invalid.owned.push('enemy_caster');
  assert.throws(()=>S.validate(invalid),/存档/);
});
test('manual rage is held for player casts, skip and full playback agree, first clear rewards are credited once',()=>{
  const s=S.fresh(),spec={kind:'campaign',id:1};
  const manual=B.create(s,spec,seeded(22));
  manual.units[3].rage=100;
  while(B.step(manual,false).actor!==manual.units[3].key) {}
  assert.equal(manual.units[3].rage,100);
  assert.equal(B.cast(manual,3).kind,'ultimate');
  const a=B.create(s,spec,seeded(123)), b=B.create(s,spec,seeded(123));
  const events=[];
  while(!a.done) {const e=B.step(a); if(e)events.push(e);}
  B.finish(b);assert(a.win);assert.deepEqual(a.units,b.units);assert.equal(a.round,b.round);
  assert(events.some(e=>e.kind==='ultimate' && e.actor==='a3' && e.hits.length>=2));
  const bagCount=s.bag.length,loot=S.settle(s,a);
  assert.equal(loot.first,true);assert.equal(s.tickets,31);assert.equal(s.cleared,1);
  assert.equal(s.bag.length,bagCount+1);assert.equal(s.bag.at(-1).uid,loot.gear.uid);
  assert.throws(()=>S.settle(s,a));assert.equal(S.settle(s,b).first,false);
  assert.equal(s.tickets,31);assert.throws(()=>B.create(s,{kind:'campaign',id:3}));
  const stalled=B.create(s,spec,()=>.5);
  stalled.units.forEach(u=>{u.maxHp=u.hp=10000000;u.atk=1;});
  B.finish(stalled);assert.equal(stalled.round,20);assert.equal(stalled.win,false);
  assert.equal(S.settle(s,stalled).first,false); S.validate(s);
});
test('ten-stage campaign is beatable through ordinary upgrades, three trials award actual outcomes',()=>{
  const s=S.fresh(),rng=seeded(47);
  for(const stage of D.stages) {
    for(const id of s.formation) S.autoEquip(s,id);
    const cost=S.upgradeCost(s);
    if(s.coins>=cost.coins && s.cores>=cost.cores) S.upgrade(s);
    const b=B.finish(B.create(s,{kind:'campaign',id:stage.id},rng));
    assert(b.win,'failed '+stage.code);assert(S.settle(s,b).first);
  }
  assert.equal(s.cleared,10);
  const tower=B.finish(B.create(s,{kind:'tower',id:1},rng));assert(tower.win);
  assert(S.settle(s,tower).first);assert.equal(s.tower,1);
  assert.throws(()=>B.create(s,{kind:'tower',id:3}));
  assert.throws(()=>B.create(s,{kind:'tower',id:31}));
  const boss=B.finish(B.create(s,{kind:'boss',id:1},seeded(47)));
  assert(boss.units[7].boss);const total=boss.units.slice(0,6).reduce((sum,u)=>sum+u.damage,0);
  const loot=S.settle(s,boss);assert.equal(s.bossBest,total);
  assert.equal(loot.diamonds,D.bossThresholds.filter(n=>n<=total).length*100);
  const repeat=B.finish(B.create(s,{kind:'boss',id:1},seeded(47)));assert.equal(S.settle(s,repeat).diamonds,0);
  const duels=new Set();
  for (let n=0;n<3;n++) {
    const arena=B.finish(B.create(s,{kind:'arena',id:1},rng));
    duels.add(arena.units.slice(6).map(u=>u.heroId).join('.'));
    assert(arena.win);assert.equal(S.settle(s,arena).tickets,n===2 ? 3 : 1);
  }
  assert.equal(s.arenaWins,3);assert(duels.size>1);S.validate(s);
});
