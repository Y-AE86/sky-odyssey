(() => {
  'use strict';
  const {D} = globalThis.Sky;
  const KEY = 'sky_odyssey_save_v1';
  const poolRates = {ur: 0.02, ssr: 0.98, up: 0.75};
  const heroIds = new Set(D.heroes.map(hero=>hero.id));
  const launchIds = new Set(['h01','h02','h03']);
  const featured = D.hero('h01');
  const urHeroes = D.heroes.filter(hero=>hero.rarity==='UR');
  const otherUrHeroes = urHeroes.filter(hero=>hero!==featured);
  const ssrHeroes = D.heroes.filter(hero=>hero.rarity==='SSR');
  const expansionIds = ['h09','h10','h11'];
  const heroFields = {stars:()=>1,shards:()=>0,equipment:()=>Array(4).fill(null)};
  const gearNames = [
    ['星铁短刃','星纹军刀','凛光长锋','群星之刃'], ['巡航轻甲','星纹软甲','天光重甲','星冠圣铠'],
    ['星图挂坠','流银指环','曙光星环','天穹之泪'], ['见习星盘','黄铜罗盘','航星仪','群星天球']
  ];
  const resources = ['coins','cores','diamonds','tickets'];
  const audioDefaults = Object.freeze({music:true,muted:false,musicVolume:.46,soundVolume:.82});
  const check = (condition, msg) => { if (!condition) throw new Error(msg); };
  const dateOf = now => {
    const d = new Date(now);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  };
  const dailyRecord = now => ({day: dateOf(now), battles: 0, claimed: false});
  const calendarDay = now => {
    const d = new Date(now);
    return Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()) / 86400000);
  };
  const owned = (s, id) => check(s.owned.includes(id), '请先获得这位星灵');
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const gain = (s, rewards) => resources.forEach(key => { s[key] += rewards[key] || 0; });
  function gear(index, slot, rank) {
    return {uid:'g'+String(index).padStart(3,'0'), name:gearNames[slot][rank], slot, rarity:D.rarities[rank],level:0};
  }
  function fresh(now = Date.now()) {
    const fields = fn => Object.fromEntries([...heroIds].map(id => [id, fn()]));
    const bag = D.starter.map((id, i) => gear(i+1,i%4,0));
    for (let i=0; i<8; i++) bag.push(gear(7+i,i%4,i < 4 ? 1 : 2));
    const equipment = fields(heroFields.equipment);
    D.starter.forEach((id,i) => { equipment[id][bag[i].slot] = bag[i].uid; });
    return {version:1, diamonds:4800, coins:6000, tickets:30, cores:120, level:1,
      owned:[...D.starter].sort(), formation:[...D.starter], stars:fields(heroFields.stars),
      shards:fields(heroFields.shards), bag, equipment, cleared:0,tower:0,bossBest:0,arenaWins:0,
      pity:{standard:{ur:0,ssr:0},up:{ur:0,ssr:0}}, firstTenDone:false,
      settings:{powerSave:false,sound:true,poster:'h01',...audioDefaults},
      welfare:false, daily:dailyRecord(now), event:{start:calendarDay(now),days:[]},
      idleAt:Math.max(0,now-120000), idleCoreSeconds:0};
  }
  function validate(s) {
    const valid = x => check(x, '存档格式或数值无效');
    const counter = (val,max=1e12) => valid(integer(val,0,max));
    valid(s && s.version === 1);
    resources.forEach(k => counter(s[k]));
    valid(integer(s.level,1,100));
    valid(Array.isArray(s.owned) && s.owned.length>=6 && s.owned.length<=heroIds.size && s.owned.every(id=>heroIds.has(id)));
    valid(new Set(s.owned).size === s.owned.length);
    valid(Array.isArray(s.formation) && s.formation.length===6 && new Set(s.formation).size===6 && s.formation.every(id=>s.owned.includes(id)));
    valid(Array.isArray(s.bag) && s.bag.length<=1000);
    const items = new Map();
    for (const i of s.bag) {
      valid(i && /^g[0-9]+$/.test(i.uid) && !items.has(i.uid) && integer(i.slot,0,3));
      const rank = D.rarities.indexOf(i.rarity);
      valid(rank>=0 && i.name===gearNames[i.slot][rank] && integer(i.level,0,50));
      items.set(i.uid,i);
    }
    const worn = new Set();
    for (const {id} of D.heroes) {
      valid(integer(s.stars?.[id],1,6));
      counter(s.shards?.[id]);
      valid(Array.isArray(s.equipment?.[id]) && s.equipment[id].length===4);
      s.equipment[id].forEach((uid,slot) => {
        if (uid===null) return;
        valid(s.owned.includes(id) && items.get(uid)?.slot===slot && !worn.has(uid));
        worn.add(uid);
      });
    }
    counter(s.cleared,10); counter(s.tower,30); counter(s.bossBest); counter(s.arenaWins);
    for (const p of ['standard','up']) {counter(s.pity?.[p]?.ur,59); counter(s.pity?.[p]?.ssr,9);}
    valid(s.firstTenDone===undefined || typeof s.firstTenDone==='boolean');
    valid(s.settings && typeof s.settings.sound==='boolean' && typeof s.settings.powerSave==='boolean');
    for(const key of ['music','muted'])valid(s.settings[key]===undefined || typeof s.settings[key]==='boolean');
    for(const key of ['musicVolume','soundVolume']){
      const value=s.settings[key];
      valid(value===undefined || (Number.isFinite(value) && value>=0 && value<=1));
    }
    valid(D.illustrated.includes(s.settings.poster) && typeof s.welfare==='boolean');
    valid(s.daily && /^\d{4}-\d{2}-\d{2}$/.test(s.daily.day) && typeof s.daily.claimed==='boolean');
    counter(s.daily.battles); counter(s.idleAt,8640000000000000);
    if(s.event!==undefined){
      valid(s.event && integer(s.event.start,0,10000000) && Array.isArray(s.event.days) &&
        s.event.days.length<=7 && s.event.days.every(n=>integer(n,1,7)) && new Set(s.event.days).size===s.event.days.length);
    }
    if (s.idleCoreSeconds!==undefined) counter(s.idleCoreSeconds,59);
    return s;
  }
  function refreshDaily(s,now=Date.now()) {
    if (s.daily.day !== dateOf(now)) s.daily=dailyRecord(now);
    return s.daily;
  }
  function migrateLegacyRoster(s) {
    const maps=Object.keys(heroFields);
    if(s?.version!==1 || !Array.isArray(s.owned) ||
       expansionIds.some(id=>s.owned.includes(id)) ||
       !maps.every(key=>s[key] && typeof s[key]==='object' && !Array.isArray(s[key]) &&
         expansionIds.every(id=>!Object.hasOwn(s[key],id)))) return;
    // Keep the original hero IDs so stored gear, stars, shards and formation
    // follow the replacements. Only the three newly added records need defaults.
    for(const key of maps) {
      for(const id of expansionIds) s[key][id]=heroFields[key]();
    }
  }
  function importJSON(json) {
    let s;
    try { s=JSON.parse(json); } catch { throw new Error('无法读取 JSON 存档'); }
    migrateLegacyRoster(s);
    validate(s); refreshDaily(s); s.event ||= {start:calendarDay(Date.now()),days:[]};
    s.firstTenDone ??= false;
    s.settings={...audioDefaults,...s.settings};
    return s;
  }
  function load() {
    let json;
    try { json=globalThis.localStorage.getItem(KEY); } catch { return fresh(); }
    return json ? importJSON(json) : fresh();
  }
  function write(s) {
    validate(s);
    try { globalThis.localStorage.setItem(KEY, JSON.stringify(s)); }
    catch { throw new Error('浏览器未能保存进度，请在设置中导出存档。'); }
    return s;
  }
  function idle(s,now=Date.now()) {
    const seconds = Math.min(28800,Math.max(0,Math.floor((now-s.idleAt)/1000)));
    return {seconds, ratio:seconds/28800, coins:Math.floor(seconds/5)*2,
      cores:Math.floor((Math.floor(seconds/5)*5+(s.idleCoreSeconds||0))/60)};
  }
  function claimIdle(s,now=Date.now()) {
    const loot = idle(s,now);
    check(loot.coins>0,'星匣正在积累星币');
    gain(s,loot);
    const ticks=Math.floor(loot.seconds/5)*5;
    s.idleCoreSeconds=(ticks+(s.idleCoreSeconds||0))%60;
    s.idleAt=loot.seconds===28800 ? now : s.idleAt+ticks*1000;
    return loot;
  }
  function claimDaily(s,now=Date.now()) {
    const daily = refreshDaily(s,now);
    check(!daily.claimed,'今日任务奖励已领取');
    check(daily.battles>0,'完成一场战斗后可领取');
    daily.claimed=true; s.diamonds+=80; return {diamonds:80};
  }
  function claimWelfare(s) {
    check(!s.welfare,'开服补给已领取');
    s.welfare=true; s.tickets+=6; return {tickets:6};
  }
  function launchEvent(s,now=Date.now()) {
    const day=calendarDay(now)-s.event.start+1;
    return {day,active:day>=1 && day<=7,claimed:s.event.days.includes(day)};
  }
  function claimEvent(s,now=Date.now()){
    const event=launchEvent(s,now);
    check(event.active && !event.claimed,'本日航程补给不可领取');
    s.event.days.push(event.day);
    const reward={tickets:event.day===7?3:1,cores:5};
    gain(s,reward);return reward;
  }
  function bonds(formation) {
    return D.factions.map(faction => {
      const count = formation.filter(id => D.hero(id)?.faction===faction).length;
      const tier = count - count%2;
      return {faction,count,tier,bonus:[0,.06,.12,.20][tier/2]};
    });
  }
  const gearValue = item => (D.rarities.indexOf(item.rarity)+1)*14+item.level*5;
  const gearFactors = [
    {hp:0, atk:.65, def:0}, {hp:5, atk:0, def:.25},
    {hp:0, atk:.4, def:0}, {hp:2, atk:0, def:.15}
  ];
  function gearStats(item) {
    const value=gearValue(item), factor=gearFactors[item.slot];
    return {hp:value*factor.hp, atk:value*factor.atk, def:value*factor.def};
  }
  function stats(s,id) {
    const h = D.hero(id);
    const grow = 1+(s.level-1)*.075+(s.stars[id]-1)*.105;
    // The five Wave 6 profiles use final calibrated HP and attack. Normalize
    // the included resonance before applying the active weapon multiplier.
    const native = (1+h.weaponBonus)/(1+h.baseWeaponBonus);
    const passive = s.stars[id]>=3 ? 1.08 : 1;
    let hp=h.hp*grow, atk=h.atk*grow, def=h.def*grow;
    for (const uid of s.equipment[id]) {
      const item=s.bag.find(it=>it.uid===uid);
      if (!item) continue;
      const bonus=gearStats(item);
      hp+=bonus.hp; atk+=bonus.atk; def+=bonus.def;
    }
    return {hp:Math.round(hp*native), atk:Math.round(atk*native*passive),
      def:Math.round(def), speed:h.speed};
  }
  function power(s,id) {
    if (!id) return s.formation.reduce((v,h) => v+power(s,h),0);
    const u=stats(s,id);
    return Math.round(u.hp*.5+u.atk*3+u.def*2);
  }
  const upgradeCost = s => ({coins:280+s.level*90,cores:5+s.level*2});
  function upgrade(s) {
    check(s.level<100,'已达共鸣等级上限');
    const cost=upgradeCost(s);
    check(s.coins>=cost.coins && s.cores>=cost.cores,'星币或共鸣晶核不足');
    s.coins-=cost.coins; s.cores-=cost.cores; return ++s.level;
  }
  const starCost = (s,id) => s.stars[id]*12;
  function starUp(s,id) {
    owned(s,id);
    check(s.stars[id]<6,'已达到最高星级');
    const cost=starCost(s,id);
    check(s.shards[id]>=cost,'该星灵的碎片不足');
    s.shards[id]-=cost; return ++s.stars[id];
  }
  function assign(s,slot,id) {
    owned(s,id); check(integer(slot,0,5),'阵位无效');
    const current=s.formation.indexOf(id);
    if (current>=0) s.formation[current]=s.formation[slot];
    s.formation[slot]=id;
  }
  const wearer = (s,uid) => s.owned.find(id=>s.equipment[id].includes(uid));
  function equip(s,id,slot,uid) {
    owned(s,id);
    const item=s.bag.find(i=>i.uid===uid);
    check(item && item.slot===slot,'星装类型不匹配');
    const owner=wearer(s,uid);
    check(!owner || owner===id,'这件星装已由其他星灵穿戴');
    s.equipment[id][slot]=uid;
    return item;
  }
  function autoEquip(s,id) {
    owned(s,id);
    D.slots.forEach((_,slot) => {
      const available=s.bag.filter(i => i.slot===slot && (!wearer(s,i.uid)||wearer(s,i.uid)===id));
      available.sort((a,b)=>gearValue(b)-gearValue(a));
      if (available.length) equip(s,id,slot,available[0].uid);
    });
    return s.equipment[id];
  }
  const enhanceCost = item => (item.level+1)*95;
  function enhance(s,uid) {
    const item=s.bag.find(i=>i.uid===uid);
    check(item && item.level<50,'无法再强化这件星装');
    const cost=enhanceCost(item);
    check(s.coins>=cost,'星币不足'); s.coins-=cost; return ++item.level;
  }
  function equippedUpgrade(s,id) {
    owned(s,id);
    const items=s.bag.filter(item=>s.equipment[id].includes(item.uid) && item.level<50);
    return {items,cost:items.reduce((sum,item)=>sum+enhanceCost(item),0)};
  }
  function enhanceAll(s,id) {
    const {items,cost}=equippedUpgrade(s,id);
    check(items.length,'暂无可强化的已穿戴星装');
    check(s.coins>=cost,'整套强化所需星币不足');
    s.coins-=cost;
    for(const item of items)item.level++;
    return items.length;
  }
  function exchange(s,count=1) {
    check(integer(count,1,1000) && s.diamonds>=160*count,'每张唤星券需 160 星钻');
    s.diamonds-=160*count; s.tickets+=count;
    return count;
  }
  function draw(s,pool,n,rng=Math.random) {
    check(['standard','up'].includes(pool) && [1,10].includes(n),'请选择有效的星池和召唤次数');
    check(s.tickets>=n,'唤星券不足，可用星钻兑换');
    const pity=s.pity[pool], results=[];
    s.tickets-=n;
    for (let i=0; i<n; i++) {
      const roll=rng(), selection=rng();
      const rarity=pity.ur>=59 || roll<poolRates.ur ? 'UR' : 'SSR';
      const candidates=rarity==='UR' ? urHeroes : ssrHeroes;
      let hero=candidates[Math.floor(selection*candidates.length)];
      if(pool==='up' && rarity==='UR') {
        hero=selection<poolRates.up ? featured
          : otherUrHeroes[Math.floor((selection-poolRates.up)/(1-poolRates.up)*otherUrHeroes.length)];
      }
      // Apply the newcomer slot before inventory and pity so the displayed card,
      // credited shards and counter resets all describe the same pull.
      if(n===10 && i===9 && !s.firstTenDone && !launchIds.has(hero.id) &&
          !results.some(result=>launchIds.has(result.id))) {
        hero=D.hero(rarity==='UR'?'h02':'h03');
      }
      const id=hero.id, isNew=!s.owned.includes(id), shards=isNew ? 0 : rarity==='UR' ? 24 : 12;
      if (isNew) s.owned.push(id);
      s.shards[id]+=shards;
      pity.ur = rarity==='UR' ? 0 : pity.ur+1;
      pity.ssr=0;
      results.push({id,rarity,isNew,shards});
    }
    if(n===10)s.firstTenDone=true;
    return results;
  }
  function settle(s,battle) {
    check(battle.done,'战斗尚未结束');
    check(!battle.settled,'本场战斗已结算');
    const {kind,id}=battle.spec;
    const win=battle.win;
    const loot={coins:win ? 140 : 24,cores:win ? 4 : 1,diamonds:0,tickets:0,first:false};
    switch (kind) {
      case 'campaign':
        if (win && id===s.cleared+1) {
          Object.assign(loot,D.stages[id-1].reward); loot.first=true; s.cleared=id;
        } break;
      case 'tower':
        if (win && id===s.tower+1) {
          loot.diamonds=100+id*6; loot.cores+=18+id; loot.first=true; s.tower=id;
        } break;
      case 'boss': {
        const score=battle.units.filter(u=>u.side==='ally').reduce((v,u)=>v+u.damage,0);
        const reached=D.bossThresholds.filter(t=>t>s.bossBest && t<=score).length;
        loot.diamonds=100*reached; loot.cores+=12*reached; loot.first=reached>0;
        s.bossBest=Math.max(s.bossBest,score); break;
      }
      case 'arena':
        if (win) {s.arenaWins++; loot.tickets=s.arenaWins%3===0 ? 3 : 1;}
        break;
      default: throw new Error('未知战场');
    }
    if (loot.first && (kind==='campaign' || (kind==='tower' && id%5===0))) {
      const nextId=s.bag.reduce((highest,item)=>Math.max(highest,Number(item.uid.slice(1))),0)+1;
      const rank=kind==='tower' ? (id>=20 ? 3 : 2) : (id>=5 ? 2 : 1);
      loot.gear=gear(nextId,(id-1)%4,rank);
      s.bag.push(loot.gear);
    }
    refreshDaily(s).battles++;
    gain(s,loot); battle.settled=true;
    return loot;
  }
  globalThis.Sky.Save={KEY,poolRates,audioDefaults,fresh,validate,load,write,exportJSON:s=>JSON.stringify(validate(s),null,2),
    importJSON,refreshDaily,idle,claimIdle,claimDaily,claimWelfare,launchEvent,claimEvent,bonds,stats,power,upgradeCost,upgrade,starCost,
    starUp,assign,equip,wearer,autoEquip,gearStats,enhanceCost,enhance,equippedUpgrade,enhanceAll,exchange,draw,settle};
})();
