// Native-size star phantoms for the unillustrated chibi slots.
(() => {
  'use strict';
  const Sky=window.Sky ||= {};
  const knightWing='M76 96C42 85 24 58 19 36c-4 28 11 54 29 67-21-5-34-15-43-27 5 26 23 42 46 49-12 1-22-1-32-6 12 16 23 22 43 26z';
  const fullHair='M67 31C41 45 55 69 45 94c-5 15-16 19-32 23 21 8 47-2 54-15-2 22-16 34-22 39 34-4 47-24 48-47z';
  const mantle='M74 89Q50 102 45 131c-5 16-13 29-22 39 17-3 27-8 38-20-4 13-10 21-14 27 18-4 35-20 42-32l31 25 18 5c-11-19-20-38-23-59l-10-20z';
  const skirt='M74 123l29 1 17 25-14-4 1 11-16-8-6 8-12-12-13 9 5-16-12 5z';
  const variants={
    h04:{accent:'#e8d9ff',back:knightWing,hair:fullHair,skirt,hat:'M63 46l-16-12 16 3-7-20 17 13 8-21 9 22 10-14 4 17 13-6-9 16-25-3z',
      arm:'M110 99Q125 92 137 100l16 7-2 25-22 24-19-12-9-22z',trim:'M110 105l17-5 20 10-2 19-17 19-14-11-8-18z M113 119l14 17 16-24',
      emblem:[128,120,9]},
    h05:{accent:'#b1f2fa',back:'M69 87Q51 63 31 65l-11 16 28 12-20-2 8 10 29 2z',hair:'M69 33Q47 37 51 65c-2 11-8 22-18 27 18 1 30-9 32-19l8 15 10-26z',skirt,
      hat:'M58 42l4-17 35-6 10 13 14 2-11 8-24-4-15 7z',
      arm:'M108 104l15-5 2-12 11-2 1 5 29-4 2 7-29 9-3 12-11 3-2-7-12 4z M59 110l-18-8-18-4-7 5 17 8 7 10 9-4 13 3z',
      trim:'M130 94l31-5 M23 103l17 7',emblem:[131,97,4]},
    h06:{accent:'#f3b9ff',back:fullHair,hair:'M66 39Q45 50 52 73c2 14-2 26-14 33 21 1 35-15 35-27l15 15 5-30z',skirt,
      hat:'M23 53c14-9 26-16 34-19l11-19L99 7 86 19l4 11 23 6 19-1c-13 10-27 15-51 12L65 43z',
      arm:'M115 132c26-19 42-44 38-72 14 18 15 39 4 58-8 14-20 23-37 28l6-10z',trim:'M124 134c21-14 34-38 33-57',emblem:[153,77,5]},
    h07:{accent:'#d3e4ff',back:knightWing,hair:'M66 32Q48 41 55 65l-8 14 15-5 1 10 16-12 9 6 9-27z',
      skirt:'M72 124l33-2 14 22-14-5-9 11-9-6-11 7-1-12-12 6z',hat:'M58 42l-7-13 13 5 9-18 6 13 16-17 5 16 13 1-11 10-23-2z',
      arm:'M109 128l9-20-8-6 4-3 8 3 24-54 7-11-1 22-21 46 8 2-1 4-10-1-12 22z',trim:'M125 100l23-52',emblem:[124,106,5]},
    h08:{accent:'#c1cdff',back:'M64 90l-16-19-19 4-7 18 12 23 24 4z',hair:'M58 53l-7 3 1-17 20-15 25 2 13 13-8 14-7-4-13 13-3-8-13 12z',
      skirt:'M69 125l34-3 16 19-8 9-16-7-9 8-14-7-12 3z',hat:'M51 44l9-18 18-9 23 4 10 12 1 10-23-3-14 7-10-3-8 12z',
      arm:'M108 103l16-14 18 3 13 16-2 21-17 16-21-9-12-18z',trim:'M116 105l12-10 13 3 10 13-3 17-13 11-14-7-7-14z',emblem:[133,116,8]}
  };
  const lum='url(#veil)', metal='url(#pearl)', hair='url(#hair)';
  const layer=(d,fill,stroke='#bfccff',width=.9,opacity=1)=>`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
  const spark=(x,y,r,c)=>layer(`M${x} ${y-r}q.3 ${r*.83} ${r*.65} ${r}q-${r*.57} .25 -${r*.65} ${r}q-.2 -${r*.80} -${r*.65} -${r}q${r*.58} -.3 ${r*.65} -${r}z`,c,'none');
  function draw(v){
    const defs=`<defs>
      <linearGradient id="veil" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#aedbff"/><stop offset=".25" stop-color="#7187d6"/><stop offset=".57" stop-color="#675bb6"/><stop offset="1" stop-color="#929ddd" stop-opacity=".42"/></linearGradient>
      <linearGradient id="pearl" x1=".05" y1="0" x2=".83" y2="1"><stop stop-color="#eff9ff"/><stop offset=".28" stop-color="#aac7fa"/><stop offset=".50" stop-color="#817acb"/><stop offset=".76" stop-color="#6657ad"/><stop offset="1" stop-color="${v.accent}"/></linearGradient>
      <linearGradient id="hair" x1=".1" y1="0" x2=".85" y2="1"><stop stop-color="#c6f1ff"/><stop offset=".28" stop-color="#9eb7f6"/><stop offset=".60" stop-color="#9390d7"/><stop offset="1" stop-color="#615ea9" stop-opacity=".84"/></linearGradient>
      <linearGradient id="face" x1="0" y1=".9" x2=".9" y2=".25"><stop stop-color="#817db6"/><stop offset=".52" stop-color="#b6acdd"/><stop offset="1" stop-color="#d3d9f8"/></linearGradient>
      <radialGradient id="aura"><stop stop-color="#a7aeff" stop-opacity=".31"/><stop offset="1" stop-color="#abb9ff" stop-opacity="0"/></radialGradient>
    </defs>`;
    const rear=layer(v.back,lum,'#adc7f9',1,.76)+layer(mantle,lum,'#b7d5f8',1,.75)+
      layer('M58 115q-8 33-24 44m37-45q-1 25-17 46m43-47 26 45','none','#ceccff',.65,.8);
    const legs=layer('M71 136l17 8-3 21-8 24-10 25-9 6-7 1 7-9 8-31 2-24z',metal)+
      layer('M89 143l15-7 5 25 7 35 7 12 9 5-2 5-15-1-7-9-11-39z',metal)+
      layer('M63 185l15 2-13 29-10 4-4 0 9-10z M106 187l9-4 7 25 10 5-2 5-14-1-7-9z',lum)+
      layer('M67 187l5 4-9 18m48-23 8 24','none',v.accent,1.05);
    const body=layer('M69 87l12-6 17 1 13 13 9 17-8 11-8-3 1 15-14 6-26-7 1-14-7 4-10-9 12-22z',metal)+
      layer('M68 92l20 10 16-13-7 29-11 6-15-11z',lum)+layer(v.skirt,metal)+
      layer('M70 121l19 5 15-8 3 6-17 8-21-6z',metal,v.accent,.9)+
      layer('M67 91l19 11-1 10-10-6m26-15-10 12 2 8 6-5','none',v.accent,1)+
      spark(88,113,5,'#eaf6ff');
    const head=layer(v.hair,hair)+layer('M64 52Q62 30 83 26c16-4 28 7 29 20l-1 11 5 8-6 2-2 9-9 8-12 1-7-3-4 5-5-18z','url(#face)','#b8b8eb',1)+
      layer('M53 53C47 34 59 20 79 19c17-4 30 7 34 20l-10-6 5 12-10-3-7 10 1-9-12 15-1-9-9 15-2-6-3 19-10 4 3-17-9 3z',hair,'#cfdbff',1)+
      layer('M56 44q10-17 30-19m-26 24c8-12 14-17 29-20m3-4 10 7','none','#e7f3ff',.85,.85)+
      layer('M94 57q6 2 14-3-4 6-12 5z','#7578b1','none')+
      layer('M98 58l7-2','none','#eef7ff',1.15)+layer('M103 70l4-1','none','#a095c0',.8)+
      layer(v.hat,metal,v.accent,1)+spark(69,39,3.5,'#eef6ff');
    const details=layer(v.arm,metal,v.accent,1)+layer(v.trim,'none','#e4edff',.9)+spark(...v.emblem,'#f4f6ff')+
      layer('M53 155l9-14 13-5m25 13 7 13 6 19','none','#d9edff',.55)+
      spark(62,142,2.9,'#e4fdff')+spark(107,162,2.6,'#f1e9ff')+spark(64,184,1.8,'#e4faff');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280" viewBox="0 0 180 225">${defs}
      <ellipse cx="88" cy="102" rx="77" ry="101" fill="url(#aura)"/>
      <g opacity=".83">${rear}${legs}${body}${head}${details}</g>
      ${spark(43,65,2.7,'#cadcff')}${spark(124,61,2,'#dfdbff')}${spark(46,166,2.6,'#c6d9ff')}${spark(129,180,1.8,'#e0d3ff')}</svg>`;
  }
  Sky.silhouettes=Object.fromEntries(Object.entries(variants).map(([id,v])=>[id,draw(v)]));
})();
