(() => {
  'use strict';
  const Sky = window.Sky ||= {};
  const stems = {h01:'c07', h02:'protag', h03:'c15'};
  const paths = {poster:['posters','lobby_cg_'], avatar:['avatars','avatar_'], chibi:['chibi','chibi_'], weapon:['weapons','weapon_']};
  const custom = new Set();
  const vectors = Object.fromEntries(Object.entries(Sky.silhouettes).map(([id,svg])=>[id,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)]));
  function pathOf(id, kind) {
    const [folder, prefix] = paths[kind];
    return 'assets/' + folder + '/' + prefix + ((kind !== 'weapon' && stems[id]) || id) + '.png';
  }
  function art(id,kind) {
    if(kind==='chibi' && vectors[id] && !custom.has(id)) return vectors[id];
    return pathOf(id,kind);
  }
  const slots=['weapon','armor','accessory','relic'];
  art.icon = key => 'assets/icons/icon_'+key+'.png';
  art.item = key => 'assets/items/item_'+key+'.png';
  art.emblem = key => 'assets/ui/emblem_'+key+'.png';
  art.gear = (slot,rarity) => 'assets/items/gear_'+slots[slot]+'_'+(rarity==='UR'?'ur':'sr')+'.png';
  art.isCustomChibi = id => custom.has(id);
  // Dimensions are available for local images without reading their pixels. The empty
  // slot is never used for drawing. A full-size replacement takes effect on the next launch.
  art.ready = Promise.all(Object.keys(vectors).map(id=>new Promise(resolve=>{
    const probe=new Image();
    probe.onload=()=>{ if(probe.naturalWidth>1 && probe.naturalHeight>1)custom.add(id); resolve(); };
    probe.onerror=()=>resolve();
    probe.src=pathOf(id,'chibi');
  })));
  art.textureURL = id => location.protocol === 'file:' && Sky.offlineChibi?.[id] || art(id, 'chibi');
  Sky.art = art;
  Sky.scene = id => 'assets/scenes/bg_' + id + '.png';
})();
