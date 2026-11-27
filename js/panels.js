(function (S) {
  "use strict";

  const P = {};
  const money = value => Number(value).toLocaleString("zh-CN");
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[char]);
  const state = () => S.ui.state;
  const hero = id => S.D.hero(id);
  const photo = (id, kind, className = "") => '<img draggable="false" alt="" class="' + className + '" src="' + escape(S.art(id, kind)) + '">';
  const act = (action, value = "") => 'data-panel="' + action + '" data-value="' + escape(value) + '"';
  const tab = (text, action, value, active) => '<button type="button" class="pn-tab' + (active ? ' on' : '') + '" aria-pressed="' + active + '" ' + act(action, value) + '>' + text + '</button>';
  const button = (text, action, value = "", color = "gold", disabled = false) =>
    '<button type="button" class="pn-button ' + color + '" ' + act(action, value) + (disabled ? " disabled" : "") + '>' + text + '</button>';
  const titleNames = {roster:"星灵养成", gacha:"星穹召唤", campaign:"航线推图"};
  const glyphs = {arrow:'→',back:'‹',close:'×',check:'✓'};
  const navArt = {orbit:'gacha',ranks:'formation',flag:'codex',duel:'formation',star:'gacha'};
  const itemArt = {coin:'coin',diamond:'gem',ticket:'ticket',shards:'shard',core:'core'};
  const gearArt = {blade:0,castle:3,crown:1};
  function image(url, cls="pn-mark") {
    return '<img class="'+cls+'" alt="" draggable="false" src="'+escape(url)+'">';
  }
  function mark(key) {
    if(key==='lock') return '<span class="pn-mark pn-lock" aria-hidden="true"></span>';
    if(glyphs[key]) return '<span class="pn-mark pn-symbol" aria-hidden="true">'+glyphs[key]+'</span>';
    if(itemArt[key]) return image(S.art.item(itemArt[key]));
    if(navArt[key]) return image(S.art.icon(navArt[key]));
    if(gearArt[key]!==undefined) return image(S.art.gear(gearArt[key],"UR"));
    return '';
  }
  function resource(key, label, amount) {
    return '<span class="pn-resource" title="' + label + '">' + mark(key) + '<span>' + label + '</span><b>' + money(amount) + '</b></span>';
  }
  function header(title, resources = "") {
    return '<header class="pn-head"><button type="button" data-action="home" aria-label="返回主城" class="pn-home">' + mark("back") + '</button><h1>' + title + '</h1><span class="pn-head-rule"></span><div class="pn-currencies">' + resources + '</div></header>';
  }
  function framedGear(slot, rarity) {
    const grade=(rarity || "R").toLowerCase();
    return '<span class="pn-itemframe grade-'+grade+'"><span>'+image(S.art.gear(slot,rarity || "R"))+'</span>'+
      '<img alt="" src="assets/ui/frame_'+grade+'.png"></span>';
  }
  function costText(amount, unit) {
    const key={"星币":"coin","晶核":"core","星钻":"diamond","张唤星券":"ticket"}[unit];
    return '<span class="pn-cost">'+mark(key)+'<strong>'+money(amount)+'</strong> '+unit+'</span>';
  }
  function resGroup() {
    const s = state();
    return resource("coin","星币",s.coins) + resource("core","晶核",s.cores);
  }
  const subviews = ["共鸣与升星","星装","本命武装","技能详情"];
  const skillNames = ["普攻","必杀","被动","觉醒"];
  function rosterPanel(h) {
    const s = state(), count = s.stars[h.id], fragments = s.shards[h.id] || 0, cost = S.Save.upgradeCost(s);
    const st = S.Save.stats(s, h.id);
    if (P.rosterTab === 0) {
      const threshold = S.Save.starCost(s, h.id), maxed = count >= 6;
      return '<div class="pn-resonance"><div class="pn-level"><div><p>战队共鸣等级</p><div class="pn-big-number"><small>Lv.</small>' + String(s.level).padStart(2,"0") + '</div></div>' +
        '<div class="pn-orbitseal">' + mark("orbit") + '</div><div class="pn-level-action"><p>全队共享等级</p>' + button("共鸣升级","upgrade","","cyan") +
        '<small>' + costText(cost.coins,"星币") + ' · ' + costText(cost.cores,"晶核") + '</small></div></div>' +
        '<div class="pn-tristat">' + [["生命",st.hp],["攻击",st.atk],["防御",st.def]].map(([label,v]) => '<span><small>' + label + '</small><b>' + money(v) + '</b></span>').join("") + '</div>' +
        '<div class="pn-star-up"><div><p>星灵升星</p><div class="pn-starlight" aria-label="' + count + '星">' + Array.from({length:6},(_,i) => '<i class="' + (i<count?'lit':'') + '">✦</i>').join("") + '</div><small>' + (maxed ? "觉醒已解锁" : mark('shards')+' 角色碎片 ' + fragments + ' / ' + threshold) + '</small></div>' +
        button(maxed ? "星级已满" : "升星","star",h.id,"gold",maxed || fragments<threshold) + '</div></div>';
    }
    if (P.rosterTab === 1) {
      const kit=S.Save.equippedUpgrade(s,h.id);
      return '<div class="pn-equipment"><div class="pn-inline-title"><h2>星装配置</h2><div class="pn-kit-actions">' + button("一键配装","auto-equip",h.id,"cyan") + button('<span>一键强化</span><small>'+mark("coin")+money(kit.cost)+'</small>',"enhance-all",h.id,"gold",!kit.items.length || s.coins<kit.cost) + '</div></div><div class="pn-equip-grid">' +
        S.D.slots.map((label,i) => {
          const item = s.bag.find(it => it.uid === s.equipment[h.id]?.[i]);
          const bonus = item && S.Save.gearStats(item);
          const primary = bonus ? '<span class="pn-gear-stat" title="装备基础加成"><small>'+ (bonus.atk ? '攻击':'生命')+'</small><strong>+'+money(Math.round(bonus.atk || bonus.hp))+'</strong></span>' : '';
          return '<button class="pn-equip-slot" ' + act("gear-slot", i) + '>' + framedGear(i,item?.rarity) +
            '<span><small>' + label + '</small><b>' + escape(item?.name || "未装备") + '</b><em>' + (item ? escape(item.rarity) + '　+' + item.level : "选择星装") + '</em></span>'+primary+'</button>';
        }).join("") + '</div></div>';
    }
    if (P.rosterTab === 2) {
      const special = Boolean(h.weapon);
      return '<div class="pn-weapon"><div class="pn-weapon-emblem">' + (special ? photo(h.id,"weapon") : mark("blade")) + '</div><div class="pn-weapon-copy"><p>' + (special ? '已共鸣 · '+h.rarity : "通用武装") + '</p><h2>' + escape(special ? h.weapon : "基础武装") + '</h2><p>' + escape(special ? h.weaponDesc : "通过四格星装提升战斗属性。") + '</p>' + (special ? '<div class="pn-weapon-bonus"><span>生命 <b>+6%</b></span><span>攻击 <b>+6%</b></span></div>' : "") + '</div></div>';
    }
    const selected = h.skills[P.skill];
    return '<div class="pn-skills"><div class="pn-skill-row">' + h.skills.map((skill,i) =>
      '<button class="pn-skill' + (i===P.skill ? ' on' : '') + '" ' + act("skill",i) + '>' + mark(["blade","star","orbit","ranks"][i]) + '<small>' + skillNames[i] + '</small></button>').join("") + '</div><div class="pn-skill-detail"><p>' + skillNames[P.skill] + '</p><h2>' + escape(selected.name) + '</h2><p>' + escape(selected.desc) + '</p></div></div>';
  }
  function roster() {
    const s = state();
    if (!s.owned.includes(P.hero)) P.hero = s.owned[0];
    const h = hero(P.hero);
    const filtered = S.D.heroes.filter(x => s.owned.includes(x.id) && (!P.faction || x.faction===P.faction));
    return '<section class="pn-page pn-roster" aria-label="星灵养成">' + header(titleNames.roster,resGroup()) +
      '<div class="pn-portrait ' + (P.view==="poster" ? "art" : "chibi") + '">' + photo(h.id,P.view) + '</div>' +
      '<div class="pn-art-pick">' + tab("立绘","art","poster",P.view==="poster") + tab("Q版","art","chibi",P.view==="chibi") + '</div>' +
      '<div class="pn-hero-caption"><span class="pn-rarity">' + h.rarity + '</span><span class="pn-faction">' + h.faction +
      '</span><h2>' + escape(h.name) + '</h2><div>' + escape(h.role) + ' <i></i> 战力 ' + money(S.Save.power(s,h.id)) + '</div></div>' +
      '<div class="pn-roster-panel pn-glass"><nav class="pn-tabs">' + subviews.map((x,i)=>tab(x,"roster-tab",i,i===P.rosterTab)).join("") +
      '</nav><div class="pn-roster-content">' + rosterPanel(h) + '</div></div>' +
      '<div class="pn-hero-strip"><div class="pn-filters"><span>已拥有 ' + s.owned.length + ' / 8</span>' +
      ["",...S.D.factions].map(x=>'<button ' + act("filter",x) + ' aria-pressed="' + (P.faction===x) + '" class="' + (P.faction===x?"on":"") + '">' + (x||"全部") + '</button>').join("") +
      '</div><div class="pn-hero-list">' + (filtered.length ? filtered.map(x => '<button class="pn-hero-pick' + (x.id===h.id?' on':'') + '" aria-label="查看' + escape(x.name) + '" '+act("hero",x.id)+'>' + S.ui.frame(x.id) + (s.formation.includes(x.id)?'<i>上阵</i>':'') + '</button>').join("") : '<small>尚未获得此阵营星灵</small>') +
      '</div><div class="pn-formation-go">' + button("调整 6 人站位","formation") + '</div></div></section>';
  }
  function formation() {
    const s = state(), bench=s.owned.filter(id=>!s.formation.includes(id));
    const order=s.formation.map((id,slot)=>({id,slot,speed:S.Save.stats(s,id).speed})).sort((a,b)=>b.speed-a.speed || a.slot-b.slot);
    return dialog("六人编队", '<div class="pn-formation-layout"><div class="pn-formation-board">' + [0,1].map(row =>
      '<div class="pn-form-row"><em>'+ (row===0?"前排":"后排") +'</em>' + s.formation.slice(row*3,row*3+3).map((id,i) => {
        const idx=row*3+i, h=hero(id);
        return '<button class="pn-position' + (idx===P.formSlot?' on':'') + '" aria-label="' + (row===0?"前":"后") + '排' + (i+1) + '号位 ' + escape(h.name) + '" ' + act("position",idx) + '>' +
          '<span class="pn-order" title="我方出手顺序">'+(order.findIndex(unit=>unit.id===id)+1)+'</span>'+S.ui.frame(id) +
          '<b>'+escape(h.name.split(" · ")[0])+'</b><small class="pn-profession">'+escape(h.role.split(" · ")[1].replace(/^[前后]排/,""))+'</small></button>';
      }).join("") + '</div>').join("") + '<small>' + (P.formSlot==null ? "数字为我方出手顺序。依次选择两个阵位可互换。" : "已选阵位，可点另一阵位或候补星灵换位。") + '</small></div>' +
      '<aside class="pn-form-side"><h3>阵营羁绊</h3>' + S.Save.bonds(s.formation).map(b =>
        '<div class="pn-bond' + (b.tier ? ' on' : '') + '">'+'<b>'+b.faction+'</b><small>'+b.count+' 人</small><em>' + (b.tier ? '+' + Math.round(b.bonus*100) + '%' : '未激活') + '</em></div>').join("") +
      '<p class="pn-bond-rule">同阵营上阵 2 / 4 / 6 人，生命、攻击与防御分别提升 6% / 12% / 20%。</p><h3>候补星灵</h3><div class="pn-bench">' + (bench.length ? bench.map(id=>'<button '+act("bench",id)+'>'+S.ui.frame(id)+'<small>'+escape(hero(id).name.split(" · ")[0])+'</small></button>').join("") : '<p>已拥有的星灵均已上阵</p>') +
      '</div></aside></div>');
  }
  function gearPicker() {
    const s = state(), slot = P.gearSlot, equipped=s.equipment[P.hero]?.[slot];
    const items=s.bag.filter(it=>it.slot===slot).sort((a,b)=>((b.uid===equipped)-(a.uid===equipped)) || b.level-a.level);
    return dialog(S.D.slots[slot]+" · 星装库", '<div class="pn-bag-list">' + items.map(it=>{
      const wearer=s.owned.find(id=>s.equipment[id]?.includes(it.uid));
      return '<div class="pn-bag-item">' + framedGear(slot,it.rarity) + '<div><b>' + escape(it.name) + ' +' + it.level + '</b><small>' + (wearer ? escape(hero(wearer).name) + ' 装备中' : '待装备') + '</small></div>' +
        (it.uid===equipped ? button('<span>强化</span><small>'+mark("coin")+money(S.Save.enhanceCost(it))+'</small>',"enhance",it.uid,"cyan",it.level>=50 || s.coins<S.Save.enhanceCost(it)) : button(wearer ? "占用中" : "装备","equip",it.uid,"gold",!!wearer)) + '</div>';
    }).join("") + '</div>');
  }
  function dialog(title, body, className = "") {
    return '<div class="pn-scrim"><section class="pn-dialog pn-glass ' + className + '" role="dialog" aria-modal="true" aria-label="' + escape(title) + '"><div class="pn-dialog-title"><h2>'+title+'</h2><button aria-label="关闭" '+act("dismiss")+'>'+mark("close")+'</button></div>'+body+'</section></div>';
  }
  function gacha() {
    const s=state(), featured=P.pool==="up", id=featured?"h01":"h02", h=hero(id), pity=s.pity[P.pool];
    return '<section class="pn-page pn-gacha" aria-label="星穹召唤">' + header(titleNames.gacha,resource("diamond","星钻",s.diamonds)+resource("ticket","唤星券",s.tickets)) +
      '<div class="pn-gacha-action-art">' + photo(id,"poster") + '</div><div class="pn-feature"><div><strong>UR</strong><span>' + h.faction + '　·　' + escape(h.role) +
      '</span></div><h2>' + escape(h.name) + '</h2><span>' + escape(h.ult) + '</span></div>' +
      '<div class="pn-summon-panel pn-glass"><nav class="pn-tabs">'+tab("常驻星穹池","pool","standard",!featured)+tab("东煌限定 UP","pool","up",featured)+'</nav>' +
      '<div class="pn-pool-data"><div class="pn-inline-title"><div class="pn-pool-emblem">'+mark("orbit")+'</div><button aria-label="概率说明" title="概率说明" class="pn-question" '+act("rates")+'>?</button></div>' +
      '<h2>' + (featured?"幽冥墨莲":"群星回响") + '</h2><p>' + (featured ? "UR 星灵中，幽冥墨姬占 75%。" : "四大阵营星灵常驻星穹。") + '</p>' +
      '<div class="pn-featured-list" aria-label="核心星灵预览">'+['h01','h02','h03'].map(id=>'<div>'+S.ui.frame(id)+'<span>'+hero(id).name.split(' · ')[0]+'</span><small>'+hero(id).rarity+'</small></div>').join('')+'<div class="pn-rate-note"><span>基础概率</span><b>UR　2%</b><b>SSR　13%</b></div></div>'+
      '<div class="pn-pity"><div><strong>UR 保底进度</strong><b>' + pity.ur + '<small> / 60</small></b></div>' + S.ui.bar(pity.ur/60*100,"cyan") + '<small>再召唤 ' + (60-pity.ur) + ' 次必得 UR　·　至多 ' + (10-pity.ssr) + ' 次获得 SSR 或以上</small></div>' +
      '<div class="pn-summon-buttons">' + button('单次召唤 <span class="pn-draw-cost">'+mark("ticket")+'×1</span>',"draw",1,"cyan") + button('十连召唤 <span class="pn-draw-cost">'+mark("ticket")+'×10</span>',"draw",10) + '</div><button class="pn-exchange-link" ' + act("exchange-dialog",1)+'>星钻兑券　' + mark("arrow") + '</button></div></div></section>';
  }
  function rates() {
    return dialog("召唤概率", '<div class="pn-rates"><div class="pn-rate-values">' +
      [["UR","2%"],["SSR","13%"],["SR","85%"]].map(([grade,rate])=>'<span><em>'+grade+'</em><b>'+rate+'</b></span>').join("") +
      '</div><p>每 10 抽至少获得 1 位 SSR 或更高品质星灵，每 60 抽至少获得 1 位 UR。获得相应品质后，该项保底重新计数。</p><p>首次十连至少结识幽冥墨姬、冰灵或凌波玉笛中的一位，此保障全账户限一次。两个卡池分别累计常规保底。常驻池的 UR 星灵均分概率，东煌 UP 池的 UR 有 75% 为幽冥墨姬。已拥有的星灵会转为该角色碎片。</p></div>');
  }
  function exchangeDialog() {
    const need=P.exchangeCount;
    return dialog("兑换唤星券",'<div class="pn-exchange-info">'+mark("ticket")+'<h3>'+costText(need*160,"星钻")+'　→　'+costText(need,"张唤星券")+'</h3><p>当前持有 '+money(state().diamonds)+' 星钻</p>'+button("确认兑换","exchange",need)+'</div>');
  }
  function results() {
    const one=P.draws.length===1, ready=P.revealed;
    return '<div class="pn-draw-results' + (ready?' instant':'') + (one?' single':'') + '" role="dialog" aria-modal="true" aria-label="召唤结果">' +
      '<div class="pn-reveal-light"></div><header><h2>召唤结果</h2><div class="pn-reveal-actions"><button '+act("skip")+(ready?' hidden':'')+' class="pn-skip">跳过动画 '+mark("arrow")+'</button>'+
      (one?'':'<button '+act("draw",10)+(ready?'':' hidden')+' aria-label="再抽十次，消耗十张唤星券" class="pn-repeat pn-button gold">再抽十次 <span class="pn-draw-cost">'+mark("ticket")+'×10</span></button>')+'</div></header>'+
      '<div class="pn-result-grid">' + P.draws.map((r,i)=>{
        const h=hero(r.id), illustrated=S.D.illustrated.includes(r.id);
        return '<div class="pn-result-card result-'+r.rarity.toLowerCase()+'" data-hero="'+r.id+'" style="--i:'+i+'"><div class="pn-result-front'+(illustrated?' illustrated':'')+'">'+
          photo(r.id,illustrated?"poster":"chibi","pn-card-scene"+(illustrated?"":" phantom"))+'<small>'+r.rarity+'</small>'+S.ui.frame(r.id)+'<b>'+escape(h.name)+'</b><em class="'+(r.isNew?'is-new':'')+'">'+
          (r.isNew?'NEW · 初次相遇':mark("shards")+' 碎片 ×'+r.shards)+'</em></div></div>';
      }).join("")+'</div>'+button("收下星灵","dismiss")+'</div>';
  }

  const trialIcons = {tower:"castle", boss:"crown", arena:"duel"};
  const chapterNames = ["浮空星港","齿轮云巅"];
  const mapNodes = [[9,60],[29,37],[48,59],[67,28],[89,45]];
  function chapterTitle(chapter) {return '第' + (chapter===1?'一':'二') + '章';}
  function campaign() {
    const s=state();
    return '<section class="pn-page pn-campaign" aria-label="'+(P.trials?"星穹试炼":"航线推图")+'">'+
      header(P.trials?"星穹试炼":titleNames.campaign,resource("ranks","战力",S.Save.power(s))) +
      '<nav class="pn-camp-modes">'+tab("主线航线","mode","campaign",!P.trials)+tab("星穹试炼","mode","trials",P.trials)+'</nav>' + (P.trials?trialPanel():mapPanel())+'</section>';
  }
  function mapPanel() {
    const s=state(), stage=S.D.stages[P.stage-1], stages=S.D.stages.filter(x=>x.chapter===P.chapter);
    const reached=s.cleared;
    const chosen=stage.chapter===P.chapter && stage.id<=reached+1;
    const trail=mapNodes.map(([x,y])=>x+','+y).join(" ");
    return '<div class="pn-map"><div class="pn-map-title"><p>'+chapterTitle(P.chapter)+'</p><h2>'+chapterNames[P.chapter-1]+'</h2></div>' +
      '<div class="pn-chart" aria-label="星轨航线"><svg class="pn-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="'+trail+'" fill="none" stroke="rgba(220,204,160,.8)" stroke-width=".45" stroke-dasharray="1.2 1.2" vector-effect="non-scaling-stroke"/>'+
      '<polyline points="'+trail+'" fill="none" stroke="rgba(238,215,157,.33)" stroke-width=".8"/></svg>' +
      stages.map((v,i)=>{const [x,y]=mapNodes[i], unlocked=v.id<=reached+1;
        return '<button class="pn-route-node'+(v.id===stage.id && unlocked?' on':'')+(!unlocked?' locked':'')+'" style="left:'+x+'%;top:'+y+'%" aria-label="'+v.code+' '+v.name+'" '+act("stage",v.id)+(unlocked?'':' disabled')+'><i>'+mark(unlocked?(v.id<=reached?"check":i===4?"crown":"star"):"lock")+'</i><b>'+v.code+'</b><small>'+v.name+'</small></button>';}).join("") +
      '</div><div class="pn-map-chapters">' + [1,2].map(i=>tab(chapterTitle(i),"chapter",i,P.chapter===i)).join("") + '<span>已通关　'+reached+' / 10</span></div></div>' +
      (chosen?'<article class="pn-intel pn-glass"><p class="pn-section-tag">'+mark("flag")+'战前情报</p><div class="pn-intel-title"><small>'+stage.code+'</small><h2>'+stage.name+'</h2></div><div class="pn-enemy-title"><b>敌方阵容</b><small>推荐战力　'+money(stage.power)+'</small></div><div class="pn-enemies">'+stage.enemies.map((id,i)=>'<div data-hero="'+id+'" title="'+(i<3?'前排':'后排')+' · '+escape(hero(id).name)+'">'+S.ui.frame(id)+'<small>'+escape(hero(id).name.split(" · ")[0])+'</small></div>').join("")+'</div>'+
      '<div class="pn-reward"><small>'+(stage.id<=reached?'首通奖励已领取':'首通奖励')+'</small><span>'+mark("diamond")+money(stage.reward.diamonds)+'</span><span>'+mark("ticket")+stage.reward.tickets+'</span></div>'+button("出征","start-route",stage.id)+'</article>':
      '<article class="pn-intel pn-glass pn-locked-intel">'+mark("lock")+'<h2>航线尚未解锁</h2><p>完成第一章全部 5 关，即可启航齿轮云巅。</p></article>');
  }
  function trialPanel() {
    const s=state(), entries=S.D.trials, tr=entries.find(t=>t.kind===P.trial)||entries[0];
    const status={tower:"已通关 "+s.tower+" / 30 层",boss:"最高伤害 "+money(s.bossBest),arena:"累计胜场 "+s.arenaWins};
    const next=S.D.bossThresholds.find(t=>t>s.bossBest);
    const details={tower:[s.tower>=30?"星穹高塔已登顶":"挑战第 "+(s.tower+1)+" 层","每层首通可领取星钻与共鸣晶核。"],
      boss:[next?"下一档 "+money(next)+" 伤害":"所有伤害档位已达成","按本场总伤害刷新纪录，首次突破档位可领取奖励。"],
      arena:["当前 "+Math.floor(s.arenaWins/3+1)+" 段","挑战六人镜像队伍，累计胜场升段领取唤星券。"]};
    const rewards = {
      tower:[s.tower>=30?'首通奖励已领完':'首通奖励', [['gem','星钻'],['core','共鸣晶核']]],
      boss:next ? ['突破档位奖励',[['gem','星钻'],['core','共鸣晶核']]] : ['挑战奖励',[['coin','星币'],['core','共鸣晶核']]],
      arena:['胜场奖励',[['ticket','唤星券']]]
    };
    const [rewardTitle,items] = rewards[tr.kind];
    return '<div class="pn-trial-selection">'+entries.map(t=>'<button class="pn-trial-card'+(t.kind===tr.kind?' on':'')+'" '+act("trial",t.kind)+' aria-pressed="'+(t.kind===tr.kind)+'">'+
      image(S.art.banner(t.kind),'pn-trial-art')+'<i>'+mark(trialIcons[t.kind])+'</i><div><h2>'+t.name+'</h2><span class="pn-trial-status">'+status[t.kind]+'</span></div>'+mark("arrow")+'</button>').join("")+
      '</div><article class="pn-trial-intel pn-glass"><div class="pn-trial-cover">'+image(S.art.banner(tr.kind),'pn-trial-art')+'<h3>'+tr.name+'</h3></div>'+
      '<div class="pn-trial-brief"><h2>'+details[tr.kind][0]+'</h2><p>'+details[tr.kind][1]+'</p></div>'+
      '<div class="pn-trial-rewards"><small>'+rewardTitle+'</small><div>'+items.map(([key,name])=>'<span>'+image(S.art.item(key))+name+'</span>').join('')+'</div></div>'+
      button("挑战"+tr.name,"start-trial",tr.kind,"crimson",tr.kind==="tower" && s.tower>=30)+'</article>';
  }
  function overlay() {
    switch (P.overlay) {
    case "formation": return formation();
    case "gear": return gearPicker();
    case "draws": return results();
    case "exchange": return exchangeDialog();
    case "rates": return rates();
    default: return "";
    }
  }
  function paint() {
    const prior=document.activeElement?.dataset;
    const focusSelector=prior?.panel ? 'button[data-panel="'+CSS.escape(prior.panel)+'"][data-value="'+CSS.escape(prior.value || '')+'"]' : '';
    const html=P.page==="roster"?roster():P.page==="gacha"?gacha():campaign();
    S.ui.root.innerHTML=html + overlay();
    const dialog=S.ui.root.querySelector('[role="dialog"]');
    if (dialog) S.ui.root.querySelector('.pn-page').inert=true;
    const scope=dialog || S.ui.root;
    const next=focusSelector ? scope.querySelector(focusSelector) : null;
    if (next && !next.disabled) next.focus({preventScroll:true});
    else if (dialog) dialog.querySelector('button:not(:disabled):not([hidden])')?.focus({preventScroll:true});
  }
  function commit(action, success) {
    action();
    S.ui.save();
    if (success) S.ui.toast(success);
  }
  function onClick(e) {
    const target=e.target.closest("button[data-panel]");
    if (!target||target.disabled) return;
    const v=target.dataset.value, n=Number(v), s=state();
    try {
      if(target.dataset.panel!=="draw") S.sound("tap");
      switch (target.dataset.panel) {
      case "roster-tab": P.rosterTab=n; break;
      case "skill": P.skill=n; break;
      case "art": P.view=v; break;
      case "hero": P.hero=v; P.skill=1; break;
      case "filter": {
        P.faction=v;
        const matching=s.owned.find(id=>hero(id).faction===v);
        if (v && matching && hero(P.hero).faction!==v) P.hero=matching;
        break;
      }
      case "upgrade": commit(()=>S.Save.upgrade(s),"全队共鸣等级已提升"); break;
      case "star": commit(()=>S.Save.starUp(s,v),"升星成功"); break;
      case "auto-equip": commit(()=>S.Save.autoEquip(s,v),"已配装当前可用的最强星装"); break;
      case "enhance-all": commit(()=>S.Save.enhanceAll(s,v),"已穿戴星装各强化一级"); break;
      case "gear-slot": P.gearSlot=n; P.overlay="gear"; break;
      case "equip": commit(()=>S.Save.equip(s,P.hero,P.gearSlot,v),"星装已装备"); break;
      case "enhance": commit(()=>S.Save.enhance(s,v),"星装强化成功"); break;
      case "formation": P.formSlot=null; P.overlay="formation"; break;
      case "position":
        if (P.formSlot==null) P.formSlot=n;
        else { if (P.formSlot!==n) commit(()=>S.Save.assign(s,P.formSlot,s.formation[n]),"站位已互换"); P.formSlot=null; }
        break;
      case "bench":
        if (P.formSlot==null) {S.ui.toast("请先选择要替换的阵位");return;}
        commit(()=>S.Save.assign(s,P.formSlot,v),"出战阵容已调整"); P.formSlot=null; break;
      case "pool": P.pool=v; break;
      case "rates": P.overlay="rates"; break;
      case "exchange-dialog": P.exchangeCount=n; P.requestedDraw=0; P.overlay="exchange"; break;
      case "exchange":
        commit(()=>S.Save.exchange(s,n),"已兑换 "+n+" 张唤星券"); P.overlay="";
        if (P.requestedDraw) {const count=P.requestedDraw; P.requestedDraw=0; draw(count);}
        break;
      case "draw":
        if (s.tickets<n) {P.exchangeCount=n-s.tickets; P.requestedDraw=n; P.overlay="exchange";} else draw(n);
        break;
      case "skip":
        finishReveal(true); return;
      case "mode": P.trials=v==="trials"; break;
      case "chapter": P.chapter=n; P.stage=Math.min(n*5,Math.max((n-1)*5+1,s.cleared+1)); break;
      case "stage": P.stage=n; break;
      case "trial": P.trial=v; break;
      case "start-route": S.ui.go("battle",{kind:"campaign",id:n}); return;
      case "start-trial": S.ui.go("battle",{kind:v,id:v==="tower"?s.tower+1:v==="arena"?s.arenaWins+1:1}); return;
      case "dismiss": P.overlay=""; P.requestedDraw=0; break;
      default: return;
      }
      paint();
    } catch (err) { S.ui.toast(err.message || "操作未完成"); }
  }
  function draw(count) {
    P.draws=S.Save.draw(state(),P.pool,count); S.ui.save();
    S.sound("summon");
    P.revealed=state().settings.powerSave || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    P.overlay="draws";
  }
  function finishReveal(skipped) {
    const results=S.ui.root.querySelector(".pn-draw-results");
    if(!results || P.revealed)return;
    P.revealed=true;
    if(skipped)results.classList.add("instant");
    const skip=results.querySelector(".pn-skip"), repeat=results.querySelector(".pn-repeat");
    const wasFocused=document.activeElement===skip;
    skip.hidden=true;
    if(repeat)repeat.hidden=false;
    if(wasFocused)(repeat || results.querySelector('[data-panel="dismiss"]')).focus({preventScroll:true});
  }
  function onReveal(event) {
    if(event.animationName==="pn-flip" && event.target.matches(".pn-result-card:last-child"))finishReveal(false);
  }
  function onKey(event) {
    if(event.key==="Escape" && P.overlay) {event.preventDefault();P.overlay="";P.requestedDraw=0;paint();}
    if(event.key==="Tab" && P.overlay){
      const buttons=S.ui.root.querySelectorAll('[role="dialog"] button:not(:disabled):not([hidden])');
      if(!buttons.length) return;
      const first=buttons[0],last=buttons[buttons.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  }
  function destroy() {
    S.ui.root.removeEventListener("click",onClick);
    S.ui.root.removeEventListener("animationend",onReveal);
    document.removeEventListener("keydown",onKey);
    P.overlay=""; P.draws=[];
  }
  function render(page, options = {}) {
    destroy();
    const s=state();
    Object.assign(P, {page,hero:options.hero||s.owned[0],view:"poster",rosterTab:options.rosterTab===1?1:0,faction:"",skill:1,formSlot:null,
      pool:"standard",stage:Math.min(10,Math.max(1,options.stage||s.cleared+1)),trial:"tower",trials:!!options.trials,
      overlay:page==="roster" && options.formation?"formation":"",requestedDraw:0});
    P.chapter=S.D.stages[P.stage-1].chapter;
    paint();
    S.ui.root.addEventListener("click",onClick);
    S.ui.root.addEventListener("animationend",onReveal);
    document.addEventListener("keydown",onKey);
  }
  S.panels={render,destroy};
})(window.Sky = window.Sky || {});
