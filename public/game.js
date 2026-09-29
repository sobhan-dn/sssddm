(() => {
  'use strict';
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const words = [
    ['CAT','A','A furry pet that says meow'],['DOG','O','A loyal pet that loves to bark'],['SUN','U','It lights up the daytime sky'],['FISH','I','An animal that swims underwater'],
    ['MOON','O','It glows in the night sky'],['BIRD','I','An animal with feathers and wings'],['TREE','R','A tall plant with a trunk'],['BOOK','O','You turn its pages to read'],
    ['STAR','A','A tiny light in the night sky'],['APPLE','P','A crunchy red or green fruit'],['HOUSE','U','A place where people live'],['WATER','A','A clear drink that keeps you hydrated'],
    ['GREEN','E','The color of fresh grass'],['SMILE','I','A happy look on your face'],['LIGHT','I','It helps you see in the dark'],['CLOUD','O','A soft white shape in the sky']
  ];
  const palette = ['#ffd13f','#ff6d7d','#65e4bb','#7d67dc','#ff9e48'];
  const state = {
    running:false, paused:false, gameOver:false, gas:false, brake:false, boosting:false,
    muted:false, time:0, camera:0, score:0, combo:1, answered:0, boost:1,
    player:{x:220,y:300,vx:0,vy:0,r:34,angle:0,angular:0,letter:'A',grounded:false},
    particles:[], obstacles:[], current:null, nextObstacle:900, flash:0, shake:0
  };
  let W=0,H=0,dpr=1,last=0,audio=null;

  function resize(){dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
  addEventListener('resize',resize);resize();
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const terrain=(x)=> H*.66 + Math.sin(x*.006)*32 + Math.sin(x*.014+1.4)*13 + Math.sin(x*.0022)*34;
  function beep(freq=440,duration=.08,type='sine',gain=.035){
    if(state.muted)return; audio ||= new (window.AudioContext||window.webkitAudioContext)();
    const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);g.gain.setValueAtTime(gain,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+duration);
  }
  function newQuestion(){
    let q; do{q=words[Math.floor(Math.random()*words.length)]}while(state.current&&q[0]===state.current[0]);
    const idx=q[0].indexOf(q[1]), shown=q[0].slice(0,idx)+'_'+q[0].slice(idx+1);
    const pool='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(c=>c!==q[1]);
    const opts=[q[1]];while(opts.length<4){const c=pool.splice(Math.floor(Math.random()*pool.length),1)[0];opts.push(c)}opts.sort(()=>Math.random()-.5);
    state.current=q;$('wordDisplay').textContent=shown.split('').join(' ');$('hintText').textContent=q[2];
    const box=$('choices');box.innerHTML='';opts.forEach(c=>{const b=document.createElement('button');b.className='letter';b.textContent=c;b.setAttribute('aria-label',`Letter ${c}`);b.onclick=()=>choose(c,b);box.appendChild(b)});
    $('streak').innerHTML=Array.from({length:5},(_,i)=>`<i class="${i<state.answered%5?'on':''}"></i>`).join('');
  }
  function choose(letter,button){
    if(!state.running||state.paused)return;
    document.querySelectorAll('.letter').forEach(b=>b.disabled=true);
    if(letter===state.current[1]){
      button.classList.add('correct');state.player.letter=letter;state.score+=100*state.combo;state.combo=Math.min(9,state.combo+1);state.answered++;state.boost=Math.min(1,state.boost+.24);toast(['Awesome! ✦','Correct — keep rolling! ⚡','Great pick! +100'][state.answered%3]);beep(660,.08);setTimeout(()=>beep(880,.12),70);
      burst(state.player.x,state.player.y,palette[state.answered%palette.length],18);
    }else{
      button.classList.add('wrong');state.combo=1;state.score=Math.max(0,state.score-30);state.player.vx*=.55;state.shake=9;toast(`Almost! The answer was ${state.current[1]}`);beep(160,.18,'sawtooth');
      document.querySelectorAll('.letter').forEach(b=>{if(b.textContent===state.current[1])b.classList.add('correct')});
    }
    updateUI();setTimeout(newQuestion,850);
  }
  function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),900)}
  function burst(x,y,color,n){for(let i=0;i<n;i++)state.particles.push({x,y,vx:rnd(-180,180),vy:rnd(-220,-30),life:rnd(.5,1),color,size:rnd(3,8)})}
  function addObstacle(){state.obstacles.push({x:state.nextObstacle,type:Math.random()>.45?'crate':'spike',hit:false});state.nextObstacle+=rnd(480,760)}
  function update(dt){
    if(!state.running||state.paused)return;state.time+=dt;const p=state.player;
    const gas=state.gas?330:0, brake=state.brake?420:0, boost=state.boosting&&state.boost>0;
    p.vx+=((gas+(boost?430:0)-brake)-p.vx*1.05)*dt;p.vx=Math.max(-70,Math.min(boost?610:430,p.vx));
    if(boost){state.boost=Math.max(0,state.boost-dt*.3);if(Math.random()>.5)burst(p.x-25,p.y,'#ffe268',1)}
    const wx=state.camera+p.x, ground=terrain(wx), dist=ground-(p.y+p.r);
    p.vy+=790*dt;p.grounded=false;
    if(dist<0&&p.vy>0){const slope=(terrain(wx+2)-terrain(wx-2))/4,ny=-1/Math.sqrt(1+slope*slope);p.y=ground-p.r;p.vy*= -.18;p.vy+=slope*p.vx*.18;p.grounded=true;p.angular=p.vx/p.r;if(Math.abs(p.vy)>75)state.shake=Math.min(8,Math.abs(p.vy)/30)}
    p.vy=Math.min(p.vy,850);p.y+=p.vy*dt;p.angle+=p.angular*dt;
    state.camera+=Math.max(0,p.vx)*dt;p.x= Math.min(W*.34,220);
    while(state.nextObstacle<state.camera+W+400)addObstacle();
    state.obstacles.forEach(o=>{const sx=o.x-state.camera,gy=terrain(o.x);if(!o.hit&&Math.abs(sx-p.x)<p.r+23&&p.y+p.r>gy-48){o.hit=true;if(boost){state.score+=50;burst(sx,gy-25,'#ffd64b',20);beep(520,.08)}else{p.vx*=.38;p.vy=-260;state.combo=1;state.shake=15;burst(sx,gy-25,'#ff715f',14);beep(100,.2,'square')}}});
    state.obstacles=state.obstacles.filter(o=>o.x>state.camera-150);
    state.particles.forEach(a=>{a.vy+=500*dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.life-=dt});state.particles=state.particles.filter(a=>a.life>0);
    state.score+=Math.floor(Math.max(0,p.vx)*dt*.035);state.shake*=.88;
    if(p.y>H+150){endGame()}updateUI();
  }
  function updateUI(){$('distance').textContent=Math.floor(state.camera/10);$('score').textContent=state.score.toLocaleString('en-US');$('combo').textContent=`×${state.combo}`;$('boostMeter').style.transform=`scaleX(${state.boost})`;}
  function cloud(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='rgba(255,255,255,.45)';for(const [a,b,r]of[[0,8,20],[22,3,26],[49,11,18]]){ctx.beginPath();ctx.arc(a,b,r,0,7);ctx.fill()}ctx.restore()}
  function draw(){
    ctx.clearRect(0,0,W,H);const sh=state.shake?rnd(-state.shake,state.shake):0;ctx.save();ctx.translate(sh,sh*.3);
    const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'#5f53bc');grad.addColorStop(.55,'#d49ac2');grad.addColorStop(1,'#f7bd83');ctx.fillStyle=grad;ctx.fillRect(-20,-20,W+40,H+40);
    ctx.fillStyle='rgba(255,221,138,.65)';ctx.beginPath();ctx.arc(W*.82,H*.22,55,0,7);ctx.fill();cloud(W*.17-(state.camera*.03%(W+150)),H*.24,1);cloud(W*.73-(state.camera*.018%(W+250)),H*.36,.7);
    for(let layer=0;layer<2;layer++){ctx.beginPath();ctx.moveTo(-10,H);for(let x=-20;x<W+30;x+=12){const wx=state.camera*(layer?.28:.12)+x;const y=H*(layer?.60:.52)+Math.sin(wx*(layer?.006:.0035))*22+Math.sin(wx*.012)*8;ctx.lineTo(x,y)}ctx.lineTo(W+10,H);ctx.fillStyle=layer?'#8370ba':'#a987c5';ctx.fill()}
    ctx.beginPath();ctx.moveTo(-20,H);for(let x=-20;x<W+30;x+=6)ctx.lineTo(x,terrain(state.camera+x));ctx.lineTo(W+20,H);ctx.fillStyle='#593a72';ctx.fill();
    ctx.beginPath();ctx.moveTo(-20,H);for(let x=-20;x<W+30;x+=6)ctx.lineTo(x,terrain(state.camera+x)-7);ctx.lineTo(W+20,H);ctx.fillStyle='#efab62';ctx.fill();
    ctx.beginPath();for(let x=-20;x<W+30;x+=5){const y=terrain(state.camera+x)-9;x===-20?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.strokeStyle='#ffe08b';ctx.lineWidth=5;ctx.stroke();
    state.obstacles.forEach(o=>drawObstacle(o,o.x-state.camera,terrain(o.x)));
    state.particles.forEach(a=>{ctx.globalAlpha=Math.max(0,a.life);ctx.fillStyle=a.color;ctx.fillRect(a.x-a.size/2,a.y-a.size/2,a.size,a.size)});ctx.globalAlpha=1;drawPlayer();ctx.restore();
  }
  function drawObstacle(o,x,y){ctx.save();ctx.translate(x,y);if(o.hit){ctx.globalAlpha=.35;ctx.rotate(.5)}if(o.type==='crate'){ctx.fillStyle='#c55750';ctx.fillRect(-23,-46,46,46);ctx.strokeStyle='#ffba73';ctx.lineWidth=5;ctx.strokeRect(-20,-43,40,40);ctx.beginPath();ctx.moveTo(-18,-40);ctx.lineTo(18,-5);ctx.moveTo(18,-40);ctx.lineTo(-18,-5);ctx.stroke()}else{ctx.fillStyle='#3c2b58';for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*19-12,0);ctx.lineTo(i*19,-42);ctx.lineTo(i*19+12,0);ctx.fill()}}ctx.restore()}
  function drawPlayer(){const p=state.player;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);ctx.shadowColor='rgba(32,14,64,.35)';ctx.shadowBlur=13;ctx.shadowOffsetY=8;ctx.fillStyle=palette[state.answered%palette.length];ctx.beginPath();ctx.arc(0,0,p.r,0,7);ctx.fill();ctx.shadowColor='transparent';ctx.strokeStyle='#fff8dc';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='rgba(72,42,91,.25)';ctx.lineWidth=3;ctx.setLineDash([6,7]);ctx.beginPath();ctx.arc(0,0,p.r-9,0,7);ctx.stroke();ctx.setLineDash([]);ctx.rotate(-p.angle);ctx.fillStyle='#402969';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 34px sans-serif';ctx.fillText(p.letter,0,2);ctx.restore()}
  function loop(t){const dt=Math.min(.033,(t-last)/1000||0);last=t;update(dt);draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);
  function reset(){Object.assign(state,{running:true,paused:false,gameOver:false,gas:false,brake:false,boosting:false,time:0,camera:0,score:0,combo:1,answered:0,boost:1,particles:[],obstacles:[],nextObstacle:850,shake:0});Object.assign(state.player,{x:Math.min(220,W*.34),y:H*.4,vx:0,vy:0,r:34,angle:0,angular:0,letter:'A'});newQuestion();updateUI();$('tip').style.opacity=1;}
  function start(){reset();$('startOverlay').classList.remove('visible');$('gameOverOverlay').classList.remove('visible');beep(440,.08);setTimeout(()=>beep(660,.1),90)}
  function endGame(){state.running=false;state.gameOver=true;$('finalScore').textContent=`${state.score.toLocaleString('en-US')} POINTS`;$('finalMessage').textContent=`You rolled ${Math.floor(state.camera/10).toLocaleString('en-US')} meters and completed ${state.answered.toLocaleString('en-US')} words!`;$('gameOverOverlay').classList.add('visible')}
  function bindHold(id,key){const el=$(id),on=e=>{e.preventDefault();if(!state.running)return;state[key]=true;el.classList.add('pressed');audio?.resume();if(key==='gas')$('tip').style.opacity=0},off=e=>{e?.preventDefault();state[key]=false;el.classList.remove('pressed')};el.addEventListener('pointerdown',on);addEventListener('pointerup',off);addEventListener('pointercancel',off)}
  bindHold('gasButton','gas');bindHold('brakeButton','brake');bindHold('boostButton','boosting');
  addEventListener('keydown',e=>{if(['ArrowRight','d','D'].includes(e.key))state.gas=true;if(['ArrowLeft','a','A'].includes(e.key))state.brake=true;if(e.key===' ')state.boosting=true});
  addEventListener('keyup',e=>{if(['ArrowRight','d','D'].includes(e.key))state.gas=false;if(['ArrowLeft','a','A'].includes(e.key))state.brake=false;if(e.key===' ')state.boosting=false});
  $('startButton').onclick=start;$('againButton').onclick=start;$('pauseButton').onclick=()=>{if(!state.running)return;state.paused=true;$('pauseOverlay').classList.add('visible')};$('resumeButton').onclick=()=>{state.paused=false;$('pauseOverlay').classList.remove('visible')};$('restartButton').onclick=()=>{reset();$('pauseOverlay').classList.remove('visible')};$('soundButton').onclick=()=>{state.muted=!state.muted;$('soundButton').textContent=state.muted?'×':'♪'};
  newQuestion();draw();
})();
