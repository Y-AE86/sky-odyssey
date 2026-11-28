(() => {
  'use strict';
  const Sky = window.Sky ||= {};
  const stems = {h01:'c07', h02:'protag', h03:'c15'};
  const paths = {poster:['posters','lobby_cg_'], avatar:['avatars','avatar_'], chibi:['chibi','chibi_'], weapon:['weapons','weapon_']};
  function art(id, kind) {
    if(Sky.D.hero(id)?.enemy && (kind==='chibi' || kind==='avatar')) return 'assets/chibi/'+id+'.png';
    const [folder, prefix] = paths[kind];
    return 'assets/' + folder + '/' + prefix + ((kind !== 'weapon' && stems[id]) || id) + '.png';
  }
  const slots=['weapon','armor','accessory','relic'];
  art.icon = key => 'assets/icons/icon_'+key+'.png';
  art.item = key => 'assets/items/item_'+key+'.png';
  art.emblem = key => 'assets/ui/emblem_'+key+'.png';
  const factions = {东煌:'donghuang', 圣辉:'shenghui', 机巧:'jiqiao', 秘影:'miying'};
  art.badge = key => 'assets/badges/'+key+'.png';
  art.faction = name => art.badge('faction_'+factions[name]);
  const banners = {campaign:'tile_campaign', idle:'tile_idle_box', event:'tile_event', shop:'tile_shop',
    tower:'banner_tower', boss:'banner_boss', arena:'banner_arena'};
  art.banner = key => 'assets/banners/'+banners[key]+'.png';
  art.gear = (slot,rarity) => 'assets/items/gear_'+slots[slot]+'_'+(rarity==='UR'?'ur':'sr')+'.png';
  art.video = id => Sky.D.illustrated.includes(id) && Sky.posterVideoIds?.includes(id)
    ? 'assets/videos/lobby_cg_'+id+'.mp4' : null;
  art.ultVideo = id => Sky.D.illustrated.includes(id) && Sky.ultVideoIds?.includes(id)
    ? 'assets/videos/ult_'+id+'.mp4' : null;
  art.vfxVideo = id => Sky.D.illustrated.includes(id) && Sky.vfxVideoIds?.includes(id)
    ? 'assets/videos/vfx_'+id+'.mp4' : null;
  art.domain = id => Sky.D.illustrated.includes(id) ? 'assets/domains/domain_'+id+'.png' : null;
  const ultimateLayout = {kind:'damage',mode:'single',impactFrame:3,frameMs:72,stagger:108,scale:.41,anchorY:.46};
  const effects = {
    h01:{},
    h02:{mode:'group',stagger:80,scale:.25,groupScale:.51,anchorY:.47,alpha:.58,groupAlpha:.79},
    h03:{kind:'heal',mode:'group',impactFrame:4,stagger:55,scale:.25,groupScale:.46,anchorY:.72,ground:true,alpha:.69},
    h04:{kind:'shield',mode:'target',stagger:65,scale:.30,anchorY:.45,alpha:.70},
    h05:{mode:'projectile',scale:.32,anchorY:.47,alpha:.81},
    h06:{anchorY:.455,impactHold:26}
  };
  for(const [id,layout] of Object.entries(effects))
    effects[id]={...ultimateLayout,...layout,src:'assets/vfx/vfx_ult_'+id+'.png'};
  effects.spark={src:'assets/vfx/vfx_hit_spark.png',impactFrame:0,frameMs:51,scale:.18,anchorY:.50};
  art.battleVfx = key => Object.hasOwn(effects,key) ? effects[key] : null;
  art.ultimateVfx = id => id==='spark' ? null : art.battleVfx(id);
  const fieldArt = new Set([...Object.keys(effects).filter(id=>id!=='spark').map(id=>'proj_'+id),
    'status_shield','status_freeze','status_curse','status_heal_ring','vfx_impact_crack']);
  art.battleArt = key => fieldArt.has(key) ? 'assets/vfx/'+key+'.png' : null;
  art.impactCrack = art.battleArt('vfx_impact_crack');
  // Classic scripts also work when the player opens index.html through file:.
  function assetScript(src,key) {
    let pending;
    return () => {
      if(Sky[key]) return Promise.resolve(Sky[key]);
      if(!pending) pending=new Promise(resolve=>{
        const script=document.createElement('script');
        script.src=src;
        script.onload=script.onerror=()=>{
          script.remove();
          pending=null;
          resolve(Sky[key] || null);
        };
        document.head.append(script);
      });
      return pending;
    };
  }
  art.loadPoses = assetScript('js/chibi-poses.js','chibiPoses');
  art.pose = (id,state) => {
    const key=id+'_'+state;
    return Sky.chibiPoses?.includes(key) ? 'assets/chibi/chibi_'+key+'.png' : null;
  };
  // WebGL cannot upload the pixels of a file: image. Read the byte-for-byte
  // inline fallback on demand, keeping the effect atlas separate from chibis.
  function offlinePack(src,key) {
    const load=assetScript(src,key);
    return () => location.protocol==='file:' ? load() : Promise.resolve(null);
  }
  art.loadOfflineTextures = offlinePack('js/offline-textures.js','offlineChibi');
  const loadVfx = offlinePack('js/offline-vfx.js','offlineVfx');
  art.loadOfflineVfx = async key => art.battleVfx(key) ? (await loadVfx())?.[key] || null : null;
  const loadBattleArt = offlinePack('js/offline-battle-art.js','offlineBattleArt');
  art.loadOfflineBattleArt = async key => fieldArt.has(key) ? (await loadBattleArt())?.[key] || null : null;
  Sky.art = art;
  Sky.scene = id => 'assets/scenes/bg_' + id + '.png';
})();
