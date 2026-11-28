(() => {
  'use strict';
  const Sky = globalThis.Sky ||= {};
  const factions = ['东煌', '圣辉', '机巧', '秘影'];
  const advantage = {东煌: '秘影', 秘影: '圣辉', 圣辉: '机巧', 机巧: '东煌'};
  const slots = ['武器', '星甲', '饰品', '圣物'];
  const rarities = ['R', 'SR', 'SSR', 'UR'];
  const weaponBonus=.06;
  const resonanceInBase=new Set(['h07','h08','h09','h10','h11']);
  const calibratedWeaponBonus=.06;
  const heroes = [
    ['h01', '幽冥墨姬', '东煌', 'UR', '爆发诅咒 · 后排输出', 'ink', '九幽墨莲斩', '忘川墨镰', 1030, 184, 52, 112,
      '冥花初绽', '三段紫焰各造成 105% 攻击的伤害，使目标攻击下降 20%，持续两次行动。'],
    ['h02', '冰灵 · 霜华', '东煌', 'UR', '群体冰控 · 后排法师', 'ice', '霜天星落', '霜华星杖', 1060, 167, 51, 104,
      '寒星引', '对全体敌人造成 118% 攻击的冰伤，每位目标有 25% 概率被冻结一次行动。'],
    ['h03', '凌波玉笛', '东煌', 'SSR', '净疗回春 · 后排治疗', 'water', '清音沧澜曲', '潮生玉笛', 1140, 150, 60, 99,
      '碧波鸣', '为所有存活友军回复 145% 攻击的生命，并清除冻结、减攻和破甲。'],
    ['h04', '艾莉娅 · 圣翼', '圣辉', 'SSR', '护盾援护 · 前排坦克', 'light', '天穹圣壁', '白昼圣盾', 1520, 130, 88, 92,
      '破晓盾击', '为前排友军附加 155% 攻击的护盾。护盾受击时向攻击者反射已吸收伤害的 30%。'],
    ['h05', '薇尔 · 星轨', '机巧', 'SSR', '连射追击 · 后排射手', 'gear', '魔导齐射', '双子铳星', 980, 163, 49, 110,
      '轨道弹', '发射四枚星弹，随机索敌，各造成 85% 攻击的伤害，每次击破目标回复 35 怒气。'],
    ['h06', '莉莉丝 · 绯月', '秘影', 'SSR', '切后刺客 · 前排突袭', 'blood', '猩红月蚀', '赤月棘刃', 1110, 169, 51, 116,
      '绯刺', '切入敌方后排，攻击当前生命最低的星灵，造成 265% 攻击的伤害，并回复实际伤害的 40%。'],
    ['h07', '望舒 · 星渊', '秘影', 'SSR', '星界统御 · 群体增攻', 'ink', '星渊垂幕', '星渊浑天星杖', 1160, 149, 57, 101,
      '引星入幕', '对全体敌人造成 82% 攻击的星界伤害，使同路敌人冻结一次行动。我方全员攻击提升 15%，持续两次行动。'],
    ['h08', '苍雷 · 希露', '机巧', 'SSR', '雷霆破甲 · 前排控制', 'thunder', '万雷裁决', '苍雷弧光太刀', 1450, 132, 83, 87,
      '弧刃引雷', '对敌方前排造成 138% 攻击的雷伤，使其防御降低 20%，持续两次行动。主目标额外冻结一次行动。'],
    ['h09', '离火 · 凰姬', '东煌', 'UR', '炽焰灼烧 · 群体爆发', 'fire', '离火焚天', '离火焚天凤枪', 1040, 180, 48, 103,
      '燎羽飞焰', '对全体敌人造成 112% 攻击的火伤。接下来两次行动后，目标各承受 32% 攻击的无视护盾灼伤。'],
    ['h10', '汐月 · 瑶光', '圣辉', 'SSR', '月潮济航 · 净化回能', 'water', '月潮归息', '月潮琉璃剑', 1110, 141, 58, 102,
      '潮汐剑纹', '为全体友军回复 105% 攻击的生命，清除控制、减攻、破甲与灼烧，其余友军回复 18 怒气。'],
    ['h11', '赛琳娜 · 暗冕', '秘影', 'UR', '暗翼斩杀 · 后排收割', 'blood', '暗冕终裁', '暗冕鸦羽棘镰', 1050, 179, 50, 114,
      '鸦羽裂锋', '诅咒生命比例最低的敌方后排，造成 205% 攻击的伤害。若目标仍存活且生命低于 35%，追加 145% 攻击的伤害。诅咒使目标攻击下降 20%，持续两次行动。']
  ].map(([id, name, faction, rarity, role, element, ult, weapon, hp, atk, def, speed, basic, desc]) => ({
    id, name, faction, rarity, role, element, ult, weapon, hp, atk, def, speed, basic,
    weaponBonus, baseWeaponBonus:resonanceInBase.has(id)?calibratedWeaponBonus:0,
    skills: [
      {name: basic, desc: '对同路优先的前排目标造成 100% 攻击的伤害，回复 34 怒气。'},
      {name: ult, desc},
      {name: '星脉共鸣', desc: '升至 3 星解锁，常驻攻击额外提升 8%。'},
      {name: '命星觉醒', desc: '升至 5 星解锁，必杀的伤害、治疗与护盾倍率提升 15%。'}
    ]
  }));
  const mech='enemy_boss_mech', guard='enemy_vanguard', caster='enemy_caster', striker='enemy_striker';
  const enemies = [
    [mech,'浮空机神阿斯特拉','机巧','UR','首领 · 雷场镇压','thunder','雷场贯射','星核歼灭',1450,132,83,87],
    [guard,'星骸重盾卫','圣辉','SSR','前排坦克 · 护盾援护','light','星骸盾击','星骸拒守',1320,128,76,93],
    [caster,'虚空星术士','秘影','SSR','后排法师 · 虚空诅咒','ink','虚光星弹','虚空裂幕',1050,149,51,99],
    [striker,'齿轮浮游猎手','机巧','SSR','后排猎手 · 斩袭','gear','齿轮穿刺','齿轮追猎',1050,156,52,110]
  ].map(([id,name,faction,rarity,role,element,basic,ult,hp,atk,def,speed])=>({
    id,name,faction,rarity,role,element,basic,ult,hp,atk,def,speed,enemy:true,boss:id===mech
  }));
  const byId = Object.fromEntries([...heroes,...enemies].map(hero=>[hero.id,hero]));
  const illustrated = heroes.map(hero=>hero.id);
  const nextPoster = id => illustrated[(illustrated.indexOf(id)+1) % illustrated.length];
  const starter = ['h04','h08','h05','h01','h02','h03'];
  const enemyTeams = [
    [guard,guard,striker,caster,striker,caster], [guard,striker,guard,striker,caster,caster],
    [striker,guard,guard,caster,caster,striker], [guard,guard,caster,striker,caster,striker],
    [guard,mech,guard,caster,striker,caster]
  ];
  const arenaTeams = [
    ['h08','h07','h04','h06','h05','h03'], ['h08','h06','h07','h05','h03','h02'],
    ['h04','h08','h06','h01','h05','h03'], ['h07','h04','h08','h02','h06','h05'],
    ['h04','h06','h08','h03','h02','h01']
  ];
  const stages = ['启明星门','星港浮桥','雾海灯塔','破晓船坞','云港守望者',
    '齿轮边境','悬空升降井','逆风钟楼','天穹熔炉','云巅之冠'].map((name, i) => {
    const chapter = i < 5 ? 1 : 2;
    return {
      id: i + 1, name, chapter, code: chapter + '-' + (i % 5 + 1), power: 5400 + i * 750,
      enemies: [...enemyTeams[i % 5]], scale: 0.62 + i * 0.085,
      reward: {diamonds: 100 + 20 * i, tickets: i % 5 === 4 ? 3 : 1}
    };
  });
  const trials = [
    {kind: 'tower', name: '星穹高塔', desc: '逐层突破三十重星门，首通获得星钻和共鸣晶核。'},
    {kind: 'boss', name: '天城首领', desc: '挑战浮空机神与五名护卫，按历史最高伤害领取阶梯奖励。'},
    {kind: 'arena', name: '星环演武', desc: '迎战六人镜像小队，每三胜升段并额外获得唤星券。'}
  ];
  Sky.D = {heroes, enemies, hero: id => byId[id], illustrated, nextPoster, factions, advantage, rarities, slots, starter, enemyTeams, arenaTeams,
    stages, trials, chapters: ['浮空星港', '齿轮云巅'], bossThresholds: [3000,8000,15000,25000,40000]};
})();
