(() => {
  'use strict';
  const Sky=window.Sky ||= {};

  // Frequency sweeps and filtered noise give combat transients weight without
  // putting the full mix through a continuous oscillator buzz.
  const effects={
    tap(tone,noise){
      tone('sine',1430,1080,.095,.086);
      tone('triangle',2080,1530,.063,.028);
      noise('highpass',2600,4200,.036,.028);
    },
    tab(tone,noise){
      noise('bandpass',620,2950,.16,.080,0,.035);
      tone('sine',560,920,.126,.041,.025);
    },
    back(tone,noise){
      tone('sine',715,355,.17,.088,0,.011);
      noise('lowpass',1150,400,.14,.043,0,.022);
    },
    collect(tone){
      [523,659,784,1047].forEach((note,i)=>tone('triangle',note,note,.32,.062,i*.055));
      tone('sine',2093,2093,.27,.042,.18);
    },
    upgrade(tone,noise){
      tone('sine',196,392,.44,.118,0,.082);
      noise('bandpass',420,4800,.40,.053,0,.15);
      [392,494,587,784,988].forEach((note,i)=>tone('triangle',note,note,.43,.067,.074*i));
    },
    summon(tone,noise){
      tone('sine',146,440,.73,.12,0,.36);
      noise('bandpass',250,6400,.66,.068,0,.32);
      [392,523,659,784,1047,1319,1568].forEach((note,i)=>tone('triangle',note,note,.48,.064,.35+i*.060));
      tone('sine',2093,2093,.52,.048,.62);
    },
    slash(tone,noise){
      noise('bandpass',4800,680,.18,.24,0,.019);
      noise('highpass',3900,1500,.075,.15,.038);
      tone('triangle',1360,855,.19,.052,.032);
      tone('sine',2230,1750,.13,.043,.038);
    },
    cast(tone,noise){
      tone('sine',196,392,.23,.12,0,.055);
      tone('triangle',490,930,.20,.068,0,.038);
      noise('bandpass',710,4400,.19,.12,.036,.027);
      tone('sine',1420,690,.163,.062,.064);
    },
    hit(tone,noise){
      tone('sine',148,46,.16,.34,0,.006);
      tone('triangle',360,104,.102,.11);
      noise('highpass',2200,1350,.073,.23);
      noise('lowpass',1100,230,.13,.18);
    },
    crit(tone,noise){
      tone('sine',164,39,.25,.46,0,.007);
      tone('triangle',394,82,.16,.22);
      noise('bandpass',3200,810,.17,.35);
      [1047,1568,2620].forEach((note,i)=>tone(i?'sine':'triangle',note,note*.93,.34,.079,.016+i*.022));
    },
    shield(tone,noise){
      tone('sine',272,238,.33,.13,0,.046);
      tone('triangle',528,680,.25,.076,0,.036);
      tone('sine',1160,1150,.37,.084,.038);
      tone('sine',1830,1790,.28,.057,.067);
      noise('bandpass',1900,760,.20,.11,0,.023);
    },
    heal(tone,noise){
      [587,740,880,1175].forEach((note,i)=>tone('sine',note,note,.42,.081,i*.042,.027));
      tone('triangle',1480,1470,.32,.045,.13);
      noise('bandpass',4800,2250,.27,.034,.025,.052);
    },
    ult_start(tone,noise){
      tone('sine',74,236,.44,.19,0,.24);
      tone('triangle',181,362,.33,.070,.038,.15);
      noise('bandpass',160,3830,.42,.18,0,.24);
      tone('sine',185,53,.25,.25,.25);
      noise('highpass',4900,1550,.18,.15,.26);
    },
    win(tone){
      [294,370,440,587].forEach((note,i)=>tone('triangle',note,note,.55,.13,i*.12,.041));
      [294,440,587,740].forEach(note=>tone('sine',note,note,.81,.086,.36,.057));
      tone('triangle',1175,1175,.66,.083,.40,.034);
    },
    lose(tone,noise){
      [233,196,146].forEach((note,i)=>tone('triangle',note,note*.82,.44,.12,i*.16,.038));
      tone('sine',109,56,.85,.19,0,.065);
      noise('lowpass',850,115,.69,.073,.03,.09);
    }
  };

  Sky.createEffects=(manifest={})=>{
    let context,compressor,master,noiseBuffer,resuming;
    let enabled=true,volume=.72,unlocked=false;
    const seed=new Uint32Array(1);
    try {window.crypto.getRandomValues(seed);}catch {seed[0]=Date.now();}
    function random(){
      // Keep sound randomization out of the random stream used by combat and summons.
      seed[0]=(Math.imul(seed[0],1664525)+1013904223)>>>0;
      return seed[0]/4294967296;
    }
    const counts={},recent=[],liveSamples=new Set(),brokenSamples=new Set();
    const maxSamples=4;
    const audible=()=>enabled && volume>0 && !document.hidden;

    function applyVolume(){
      if(master){
        const start=context.currentTime;
        master.gain.cancelScheduledValues(start);
        master.gain.setTargetAtTime(enabled ? volume*.79 : 0,start,.017);
      }
      // File URLs can't be sampled reliably by MediaElementAudioSourceNode. Reserve
      // headroom for its four native voices beside the compressed, synthesized mix.
      for(const clip of liveSamples)
        if(!clip.connected)clip.media.volume=volume*.145;
    }
    function configure(settings){
      enabled=!!settings.enabled;
      if(Number.isFinite(settings.volume))volume=Math.max(0,Math.min(1,settings.volume));
      if(!enabled || !volume)for(const clip of liveSamples)clip.stop();
      applyVolume();
    }
    function unlock(){
      unlocked=true;
      const AudioEngine=window.AudioContext || window.webkitAudioContext;
      if(!AudioEngine || !enabled || document.hidden)return;
      try{
        if(!context){
          context=new AudioEngine();
          master=context.createGain(); master.gain.value=0;
          compressor=context.createDynamicsCompressor();
          compressor.threshold.value=-19;
          compressor.knee.value=19;
          compressor.ratio.value=7;
          compressor.attack.value=.003;
          compressor.release.value=.15;
          compressor.connect(master).connect(context.destination);
          applyVolume();
        }
        if(context.state!=='running' && !resuming){
          resuming=context.resume().catch(()=>{}).finally(()=>{resuming=null;});
        }
      } catch { /* A browser may disable or interrupt audio output. */ }
    }
    function record(name,source,pitch){
      counts[name]=(counts[name] || 0)+1;
      recent.push({name,source,pitch,time:performance.now()});
      if(recent.length>48)recent.shift();
    }
    function createNoise(){
      const size=Math.ceil(context.sampleRate);
      const buffer=context.createBuffer(1,size,context.sampleRate);
      const data=buffer.getChannelData(0);
      for(let i=0;i<size;i++)data[i]=random()*2-1;
      return buffer;
    }
    function synth(name,pitch){
      const play=()=>{
        if(!audible() || context?.state!=='running')return;
        const start=context.currentTime;
        function schedule(source,filter,length,peak,delay,attack){
          const s=start+delay,end=s+length,amp=context.createGain();
          amp.gain.setValueAtTime(.0001,s);
          amp.gain.exponentialRampToValueAtTime(peak,s+attack);
          amp.gain.exponentialRampToValueAtTime(.0001,end);
          if(filter)source.connect(filter).connect(amp);
          else source.connect(amp);
          amp.connect(compressor);
          source.onended=()=>{source.disconnect();filter?.disconnect();amp.disconnect();};
          source.start(s);source.stop(end+.012);
        }
        const tone=(wave,from,to,length,peak,delay=0,attack=.006)=>{
          const source=context.createOscillator();
          source.type=wave;
          source.frequency.setValueAtTime(from*pitch,start+delay);
          source.frequency.exponentialRampToValueAtTime(to*pitch,start+delay+length*.83);
          schedule(source,null,length,peak,delay,attack);
        };
        const noise=(mode,from,to,length,peak,delay=0,attack=.008)=>{
          const source=context.createBufferSource(),filter=context.createBiquadFilter();
          source.buffer=noiseBuffer ||= createNoise();
          source.playbackRate.value=pitch;
          filter.type=mode;filter.Q.value=mode==='bandpass'?.78:.5;
          filter.frequency.setValueAtTime(from*pitch,start+delay);
          filter.frequency.exponentialRampToValueAtTime(to*pitch,start+delay+length*.85);
          schedule(source,filter,length,peak,delay,attack);
        };
        try {effects[name](tone,noise);record(name,'synth',pitch);}
        catch { /* The audio device may change between scheduling and playback. */ }
      };
      if(context?.state==='running')play();
      else resuming?.then(play);
    }
    function playSample(name,src,pitch){
      if(liveSamples.size>=maxSamples)liveSamples.values().next().value.stop();
      const media=new Audio();
      const events=new AbortController();
      let input;
      const clip={media,connected:false,stop};
      liveSamples.add(clip);
      function stop(){
        if(!liveSamples.delete(clip))return;
        events.abort();
        input?.disconnect();
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
      function failed(){
        if(!liveSamples.has(clip))return;
        if(media.error)brokenSamples.add(src);
        stop();synth(name,pitch);
      }
      try{
        const url=new URL(src,document.baseURI);
        const sameOrigin=/^https?:$/.test(location.protocol) && url.origin===location.origin;
        if(sameOrigin && context?.state==='running'){
          input=context.createMediaElementSource(media);
          input.connect(compressor);
          clip.connected=true;
        }
        media.volume=clip.connected?.55:volume*.145;
        media.defaultPlaybackRate=pitch;
        media.playbackRate=pitch;
        media.preservesPitch=false;
        media.addEventListener('ended',stop,{once:true,signal:events.signal});
        media.addEventListener('error',failed,{once:true,signal:events.signal});
        media.src=url.href;
        Promise.resolve(media.play()).then(()=>{
          if(liveSamples.has(clip))record(name,'asset',pitch);
        },failed);
      }catch{failed();}
    }
    function play(name='tap'){
      if(!unlocked || !audible() || !Object.hasOwn(effects,name))return;
      const pitch=.95+random()*.10;
      const src=manifest['sfx_'+name];
      if(typeof src==='string' && !brokenSamples.has(src))playSample(name,src,pitch);
      else synth(name,pitch);
    }
    function inspect(){
      return {enabled,volume,context:context?.state??null,compressor:!!compressor,
        counts:{...counts},recent:recent.map(event=>({...event})),activeSamples:liveSamples.size};
    }
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)for(const clip of liveSamples)clip.stop();
    });
    return {unlock,configure,play,inspect};
  };
})();
