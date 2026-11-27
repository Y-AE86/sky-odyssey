'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
require('../js/data.js');
require('../js/save.js');
require('../js/battle-engine.js');
const {D,Save:S,Battle:B}=globalThis.Sky;
const now=new Date(2026,10,27,14,0,0).getTime();
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

test('independent starters, shared team level, equipment, gems and tickets',()=>{
  const s=S.fresh(now),other=S.fresh(now);
  assert.deepEqual(s.formation,D.starter);
  assert.equal(new Set(s.formation).size,6);
  assert.deepEqual([s.tickets,s.diamonds,s.settings.powerSave],[30,4800,false]);
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
test('ten-pull and sixty-pull guarantees persist across batches and are independent per pool',()=>{
  const s=S.fresh(); s.tickets=120;
  const sr=S.draw(s,'standard',10,()=>.99);
  assert.equal(sr.filter(x=>x.rarity==='SR').length,9);
  assert.equal(sr[9].rarity,'SSR');
  assert.deepEqual(s.pity.up,{ur:0,ssr:0});assert.equal(s.pity.standard.ur,10);
  for(let i=11;i<=59;i++) assert.notEqual(S.draw(s,'standard',1,()=>.99)[0].rarity,'UR');
  const pulled=S.draw(s,'standard',1,()=>.99)[0];
  assert.equal(pulled.rarity,'UR');assert.equal(pulled.shards,24);
  assert.deepEqual(s.pity.standard,{ur:0,ssr:0});
  const recruits=S.draw(s,'up',10,()=>.24);
  assert.equal(recruits[0].id,'h07');assert.equal(recruits[0].isNew,true);
  assert.equal(recruits[1].shards,6); assert(s.owned.includes('h07'));
});
test('60,000 independent rolls match published 2/13/85 rates and conditional 75% featured UR',()=>{
  const s=S.fresh(),rng=seeded(9020),n=60000;
  s.tickets=n; const ranks={UR:0,SSR:0,SR:0};let featured=0;
  for(let i=0;i<n;i++) {
    s.pity.up.ur=0;s.pity.up.ssr=0;
    const [r]=S.draw(s,'up',1,rng); ranks[r.rarity]++;
    if(r.id==='h01')featured++;
  }
  assert(Math.abs(ranks.UR/n-.02)<.002);
  assert(Math.abs(ranks.SSR/n-.13)<.005);
  assert(Math.abs(ranks.SR/n-.85)<.005);
  assert(Math.abs(featured/ranks.UR-.75)<.05);
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
test('all eight ultimates resolve their target patterns, statuses, HP, shields and rage',()=>{
  const ink=freshBattle();
  const hit=ult(ink);assert.equal(hit.hits.length,3);assert.equal(ink.enemies[0].status.curse,2);
  assert(hit.hits.every((h,i,list)=>!i || h.hp<list[i-1].hp));
  assert.equal(B.cast(ink.b,0),null);
  const ice=freshBattle('h02',()=>0);assert.equal(ult(ice).hits.length,6);
  assert(ice.enemies.every(u=>u.status.freeze===1));
  const frozen=B.step(ice.b,true); assert.equal(frozen.kind,'stun');
  const water=freshBattle('h03');
  water.allies.forEach(u=>{u.hp-=120;u.status.freeze=1;u.status.curse=1;});
  water.hero.status.freeze=0;
  assert.equal(ult(water).hits.length,6);assert.equal(water.hero.healing,720);
  assert(water.allies.every(u=>u.hp===u.maxHp && !u.status.freeze && !u.status.curse));
  const shield=freshBattle('h04'); const guard=ult(shield);
  assert.deepEqual(guard.hits.map(h=>h.target),['a0','a1','a2']);
  assert(shield.allies.slice(0,3).every(u=>u.shield>0));
  const reflected=B.step(shield.b); assert(reflected.hits.some(h=>h.target===reflected.actor));
  const shot=freshBattle('h05',()=>0);shot.enemies[0].hp=1;
  assert.equal(ult(shot).hits.length,4);assert.equal(shot.hero.rage,35);
  const blood=freshBattle('h06');blood.enemies[4].hp=20;blood.hero.hp-=100;
  const drain=ult(blood);assert.equal(drain.hits[0].target,'e4');assert.equal(blood.hero.healing,8);
  const light=freshBattle('h07');assert.deepEqual(ult(light).hits.map(h=>h.target),['e0','e3']);
  assert(light.allies.every(u=>u.status.encourage===2));
  const gear=freshBattle('h08');assert.equal(ult(gear).hits.length,3);assert(gear.enemies.slice(0,3).every(u=>u.status.breakArmor===2));
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
  assert(boss.units[6].boss);const total=boss.units.slice(0,6).reduce((sum,u)=>sum+u.damage,0);
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
