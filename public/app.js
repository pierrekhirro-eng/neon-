(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const COARSE = matchMedia('(pointer:coarse)').matches;
  const CHUNK = 8;
  const BLOCKS = ['','GRAMA','TERRA','PEDRA','MADEIRA','FOLHAS','AREIA','TÁBUAS'];
  const key = (x,y,z) => `${x},${y},${z}`;
  let socket=null, room='', slot=0, online=false, size=40, maxHeight=25;
  let world=new Map(), scene, camera, renderer, atlas, material;
  let chunks=new Map(), selection, friend, friendTarget=null;
  let lookId=null, joyId=null, lookX=0, lookY=0, joystick={x:0,y:0};
  let keys=new Set(), yaw=0, pitch=0, jump=false, vertical=0, onGround=false;
  let sensitivity=5, selected=1, mode='auto', controlSize=1;
  let fps=0, frames=0, fpsStart=0, lastFrame=0, lastRender=0, lastSend=0, lastAim=0;
  let renderScale=COARSE?.86:1.3, paused=false, initialized=false, toastTimer;
  let currentTarget=null;
  const p={x:17.5,y:6.05,z:20.5};
  let ray=null;
  const faces=[
    {n:[1,0,0],v:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]},
    {n:[-1,0,0],v:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]},
    {n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]},
    {n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
    {n:[0,0,1],v:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]]},
    {n:[0,0,-1],v:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]}
  ];
  const showError = t => $('#lobbyError').textContent=t;
  function toast(t){const n=$('#toast');n.textContent=t;n.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.classList.remove('show'),2400);}
  function send(obj){if(online&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(obj));}
  function connect(action,code=''){
    if(socket && socket.readyState<=1)socket.close();
    online=false;showError('');
    $('#create').disabled=true;$('#join').disabled=true;
    const url=(location.protocol==='https:'?'wss://':'ws://')+location.host;
    const ws=new WebSocket(url);socket=ws;
    const fail=t=>{showError(t);$('#create').disabled=false;$('#join').disabled=false;};
    ws.addEventListener('open',()=>ws.send(JSON.stringify({type:action,code})));
    ws.addEventListener('message',event=>{
      if(socket!==ws)return;
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='error'){fail(m.message||'Não foi possível entrar.');return;}
      if(m.type==='joined'){
        online=true;room=m.code;slot=m.slot;size=m.size;maxHeight=m.height;
        p.x=m.spawn.x;p.y=m.spawn.y;p.z=m.spawn.z;
        yaw=m.spawn.yaw;pitch=m.spawn.pitch;vertical=0;onGround=false;
        world=new Map();for(const b of m.blocks)world.set(key(b[0],b[1],b[2]),b[3]);
        $('#shownCode').textContent=room;
        $('#lobby').classList.add('hidden');$('#game').classList.remove('hidden');
        history.replaceState(null,'',`?sala=${room}`);
        if(!initialized){try{init3D();}catch(e){console.error(e);online=false;$('#lobby').classList.remove('hidden');$('#game').classList.add('hidden');fail('Não foi possível iniciar o 3D. Atualize a página ou tente outro navegador.');return;}}
        else rebuildAll();
        updatePlayers(m.players);
        $('#status').textContent=m.players[1-slot]?'AMIGO CONECTADO':'AGUARDANDO AMIGO';
        toast('MUNDO CARREGADO!');
        $('#create').disabled=false;$('#join').disabled=false;
      } else if(m.type==='players'){
        updatePlayers(m.players);
        $('#status').textContent=m.players[1-slot]?'● AMIGO ONLINE':'○ AGUARDANDO AMIGO';
      } else if(m.type==='block'){
        put(m.x,m.y,m.z,m.blockType);
        rebuildNear(m.x,m.z);
      }
    });
    ws.addEventListener('close',()=>{if(socket!==ws)return;const was=online;online=false;fail('Conexão encerrada. Atualize a página.');if(was){$('#status').textContent='● DESCONECTADO';toast('CONEXÃO PERDIDA');}});
    ws.addEventListener('error',()=>{if(socket===ws)fail('Não foi possível acessar o servidor.');});
  }
  $('#create').onclick=()=>connect('create');
  $('#join').onclick=()=>{const c=$('#roomCode').value.trim().toUpperCase();if(!/^[0-9A-F]{4}$/.test(c))return showError('Digite o código de 4 caracteres.');connect('join',c);};
  $('#roomCode').onkeydown=e=>{if(e.key==='Enter')$('#join').click();};
  $('#copy').onclick=async()=>{
    const link=`${location.origin}/?sala=${room}`;
    try {if(navigator.share&&COARSE){await navigator.share({title:'Block World',url:link});return;}await navigator.clipboard.writeText(link);toast('LINK COPIADO!');}
    catch {try{await navigator.clipboard.writeText(link);toast('LINK COPIADO!');}catch{toast('CÓDIGO DA SALA: '+room);}}
  };
  $('#fullscreenBtn').onclick=async()=>{
    try {if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('TELA CHEIA INDISPONÍVEL');}
    if(COARSE){try{await screen.orientation.lock('landscape');}catch{}}
  };
  const settings=$('#settings');
  function toggleSettings(force){paused=typeof force==='boolean'?force:!paused;settings.classList.toggle('hidden',!paused);keys.clear();joystick={x:0,y:0};$('#stick').style.transform='';}
  $('#settingsBtn').onclick=()=>toggleSettings(true);
  $('#closeSettings').onclick=()=>toggleSettings(false);
  $('#resume').onclick=()=>toggleSettings(false);
  $('#sensitivity').oninput=e=>sensitivity=Number(e.target.value);
  $('#controlSize').oninput=e=>{controlSize=Number(e.target.value)/100;document.documentElement.style.setProperty('--ui-scale',controlSize);};
  $('#quality').onchange=e=>{mode=e.target.value;applyQuality();};

  const texColors=[['#6cb748','#7ccc52','#549d3e'],['#865c37','#a4774b','#ba8a55'],['#8b6441','#a1744b','#754f32'],['#8a929a','#a6abb1','#737e89'],['#946536','#ae7d42','#6c4b2c'],['#337b40','#4e9a53','#286835'],['#decb83','#f0da96','#c6b570'],['#b37a45','#cd9255','#936037'],['#b98852','#d2a66e','#815d35']];
  function hash(a,b,c){let v=(a*374761393+b*668265263+c*2147483647)|0;v=(v^(v>>>13))*1274126177;return ((v^(v>>>16))>>>0)/4294967295;}
  function makeAtlas(){
    const cv=document.createElement('canvas');cv.width=cv.height=48;
    const g=cv.getContext('2d',{alpha:false});
    for(let tile=0;tile<9;tile++){
      const bx=(tile%3)*16,by=Math.floor(tile/3)*16;
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){
        const r=hash(x,y,tile),palette=texColors[tile];let color=palette[r<.25?0:r<.82?1:2];
        if(tile===1 && y<4)color=['#68ad46','#81cd54','#569b39'][Math.floor(r*3)];
        if(tile===4 && x%5===0)color='#73502c';
        if(tile===7 && y%5===0)color='#81552f';
        if(tile===8 && Math.max(Math.abs(x-8),Math.abs(y-8))%4===0)color='#8a613a';
        g.fillStyle=color;g.fillRect(bx+x,by+y,1,1);
      }
    }
    const t=new THREE.CanvasTexture(cv);
    t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;
    t.generateMipmaps=false;t.colorSpace=THREE.SRGBColorSpace;
    t.needsUpdate=true;return t;
  }
  function tileFor(type,face){
    if(type===1)return face===2?0:face===3?2:1;
    if(type===2)return 2;if(type===3)return 3;
    if(type===4)return face===2||face===3?8:4;
    if(type===5)return 5;if(type===6)return 6;return 7;
  }
  function get(x,y,z){return world.get(key(x,y,z))||0;}
  function put(x,y,z,type){const k=key(x,y,z);if(type)world.set(k,type);else world.delete(k);}
  function chunkId(cx,cz){return cx+','+cz;}
  function buildChunk(cx,cz){
    const cid=chunkId(cx,cz),old=chunks.get(cid);
    if(old){scene.remove(old);old.geometry.dispose();chunks.delete(cid);}
    const positions=[],normals=[],uv=[],indices=[];let vcount=0;
    const startX=cx*CHUNK,startZ=cz*CHUNK;
    for(let x=startX;x<Math.min(size,startX+CHUNK);x++)for(let z=startZ;z<Math.min(size,startZ+CHUNK);z++)for(let y=0;y<maxHeight;y++){
      const type=get(x,y,z);if(!type)continue;
      for(let f=0;f<6;f++){
        const face=faces[f],[nx,ny,nz]=face.n;
        if(get(x+nx,y+ny,z+nz))continue;
        const tile=tileFor(type,f),col=tile%3,row=Math.floor(tile/3);
        const u0=(col+.012)/3,u1=(col+.988)/3;
        const v0=1-(row+.988)/3,v1=1-(row+.012)/3;
        const uvFace=[[u0,v0],[u0,v1],[u1,v1],[u1,v0]];
        for(let i=0;i<4;i++){
          const vert=face.v[i];positions.push(x+vert[0],y+vert[1],z+vert[2]);normals.push(nx,ny,nz);uv.push(...uvFace[i]);
        }
        indices.push(vcount,vcount+1,vcount+2,vcount,vcount+2,vcount+3);vcount+=4;
      }
    }
    if(!vcount)return;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geo.setIndex(indices);geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,material);
    mesh.userData.chunk=cid;scene.add(mesh);chunks.set(cid,mesh);
  }
  function rebuildAll(){if(!scene)return;for(const mesh of chunks.values()){scene.remove(mesh);mesh.geometry.dispose();}chunks.clear();for(let cx=0;cx<Math.ceil(size/CHUNK);cx++)for(let cz=0;cz<Math.ceil(size/CHUNK);cz++)buildChunk(cx,cz);}
  function rebuildNear(x,z){if(!scene)return;const cx=Math.floor(x/CHUNK),cz=Math.floor(z/CHUNK);const affected=new Set([chunkId(cx,cz)]);
    if(x%CHUNK===0)affected.add(chunkId(cx-1,cz));if(x%CHUNK===CHUNK-1)affected.add(chunkId(cx+1,cz));
    if(z%CHUNK===0)affected.add(chunkId(cx,cz-1));if(z%CHUNK===CHUNK-1)affected.add(chunkId(cx,cz+1));
    for(const c of affected){const [a,b]=c.split(',').map(Number);if(a>=0&&b>=0&&a<Math.ceil(size/CHUNK)&&b<Math.ceil(size/CHUNK))buildChunk(a,b);}
  }
  function createFriend(){
    friend=new THREE.Group();
    const palette=slot===0?0xe57a95:0x64b9ed;
    const body=new THREE.Mesh(new THREE.BoxGeometry(.68,.82,.37),new THREE.MeshLambertMaterial({color:palette}));body.position.y=1.05;
    const head=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.48),new THREE.MeshLambertMaterial({color:0xe9bd96}));head.position.y=1.72;
    const hair=new THREE.Mesh(new THREE.BoxGeometry(.53,.16,.51),new THREE.MeshLambertMaterial({color:0x523a30}));hair.position.y=2.04;
    const pants=new THREE.MeshLambertMaterial({color:0x2e4b72});
    for(const x of [-.19,.19]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.28,.72,.33),pants);leg.position.set(x,.36,0);friend.add(leg);}
    for(const x of [-.49,.49]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.23,.75,.32),body.material);arm.position.set(x,1.04,0);friend.add(arm);}
    friend.add(body,head,hair);friend.visible=false;scene.add(friend);
  }
  function updatePlayers(players){if(!players||!friend)return;friendTarget=players[1-slot];if(!friendTarget){friend.visible=false;return;}if(!friend.visible){friend.position.set(friendTarget.x,friendTarget.y,friendTarget.z);}friend.visible=true;}
  function init3D(){
    if(!window.THREE){throw new Error('Biblioteca gráfica THREE não carregou.');}
    scene=new THREE.Scene();scene.background=new THREE.Color(0x94d0ed);scene.fog=new THREE.Fog(0x94d0ed,17,36);
    camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,44);camera.rotation.order='YXZ';
    renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance',alpha:false});
    renderer.outputEncoding=THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(devicePixelRatio,renderScale));renderer.setSize(innerWidth,innerHeight);
    $('#gameView').appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe7faff,0x7b9362,1.35));
    const sun=new THREE.DirectionalLight(0xfff3c4,.75);sun.position.set(15,32,10);scene.add(sun);
    ray=new THREE.Raycaster();
    atlas=makeAtlas();material=new THREE.MeshLambertMaterial({map:atlas,side:THREE.FrontSide});
    selection=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012,1.012,1.012)),new THREE.LineBasicMaterial({color:0xffffff,depthTest:false,transparent:true,opacity:.85}));selection.visible=false;selection.renderOrder=10;scene.add(selection);
    createFriend();rebuildAll();setupLook();
    window.addEventListener('resize',resize,{passive:true});
    document.addEventListener('visibilitychange',()=>{lastFrame=0;keys.clear();joystick={x:0,y:0};});
    initialized=true;requestAnimationFrame(loop);
  }
  function resize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
  function pixelRatio(){renderer.setPixelRatio(Math.min(devicePixelRatio,renderScale));renderer.setSize(innerWidth,innerHeight);}
  function applyQuality(){if(!renderer)return;
    renderScale=mode==='low'?.7:mode==='medium'?1:mode==='high'?Math.min(1.5,devicePixelRatio):COARSE?.85:1.3;pixelRatio();
  }
  function collides(x,y,z){const r=.27;
    if(x<r||z<r||x>size-r||z>size-r)return true;
    for(let bx=Math.floor(x-r);bx<=Math.floor(x+r);bx++)for(let bz=Math.floor(z-r);bz<=Math.floor(z+r);bz++)for(let by=Math.floor(y+.03);by<=Math.floor(y+1.70);by++)if(get(bx,by,bz))return true;
    return false;
  }
  function axisMove(axis,n){if(n===0)return true;const count=Math.max(1,Math.ceil(Math.abs(n)/.10)),step=n/count;
    for(let i=0;i<count;i++){
      const x=p.x+(axis==='x'?step:0),y=p.y+(axis==='y'?step:0),z=p.z+(axis==='z'?step:0);
      if(collides(x,y,z))return false;
      p[axis]+=step;
    }return true;
  }
  function movement(dt){
    if(paused)return;
    let f=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))-joystick.y;
    let s=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+joystick.x;
    const length=Math.hypot(f,s);if(length>1){f/=length;s/=length;}
    const speed=keys.has('ShiftLeft')?5.8:4.5;
    axisMove('x',(-Math.sin(yaw)*f+Math.cos(yaw)*s)*speed*dt);
    axisMove('z',(-Math.cos(yaw)*f-Math.sin(yaw)*s)*speed*dt);
    if(jump&&(onGround||collides(p.x,p.y-.10,p.z))){vertical=7.2;onGround=false;}jump=false;
    vertical=Math.max(-20,vertical-20*dt);
    const dy=vertical*dt;
    if(!axisMove('y',dy)){if(vertical<0)onGround=true;vertical=0;}else onGround=false;
    if(p.y< -2){p.x=17.5;p.z=20.5;p.y=12;vertical=0;}
  }
  function aim(){
    if(!scene||!camera)return null;
    ray.setFromCamera(new THREE.Vector2(0,0),camera);ray.far=5.5;
    const hit=ray.intersectObjects([...chunks.values()],false)[0];if(!hit)return null;
    const n=hit.face.normal,v=hit.point;
    const x=Math.floor(v.x-n.x*.012),y=Math.floor(v.y-n.y*.012),z=Math.floor(v.z-n.z*.012);
    return {x,y,z,px:x+Math.round(n.x),py:y+Math.round(n.y),pz:z+Math.round(n.z)};
  }
  function edit(action){
    if(!online||paused)return;
    const t=aim();if(!t)return;
    const placed=action==='place',x=placed?t.px:t.x,y=placed?t.py:t.y,z=placed?t.pz:t.z;
    if(x<0||x>=size||z<0||z>=size||y<0||y>=maxHeight||(!placed&&y===0))return;
    // Server confirms changes and broadcasts them to both players.
    send({type:'block',action,x,y,z,blockType:selected});
  }
  function updateAim(){currentTarget=aim();selection.visible=!!currentTarget;
    if(currentTarget){selection.position.set(currentTarget.x+.5,currentTarget.y+.5,currentTarget.z+.5);$('#targetText').textContent=BLOCKS[get(currentTarget.x,currentTarget.y,currentTarget.z)]||'';}
    else $('#targetText').textContent='';
  }
  function rotate(dx,dy){const value=(COARSE?.0035:.0021)*(sensitivity/5);yaw-=dx*value;pitch=clamp(pitch-dy*value,-1.47,1.47);}
  function setupLook(){const c=renderer.domElement;
    if(!COARSE){
      c.addEventListener('mousedown',e=>{e.preventDefault();if(paused)return;if(document.pointerLockElement!==c){c.requestPointerLock?.();return;}if(e.button===0)edit('break');if(e.button===2)edit('place');});
      c.addEventListener('contextmenu',e=>e.preventDefault());
      document.addEventListener('mousemove',e=>{if(document.pointerLockElement===c&&!paused)rotate(e.movementX,e.movementY);});
    } else {
      c.addEventListener('pointerdown',e=>{if(lookId!==null||paused)return;e.preventDefault();lookId=e.pointerId;lookX=e.clientX;lookY=e.clientY;c.setPointerCapture(e.pointerId);});
      c.addEventListener('pointermove',e=>{if(lookId!==e.pointerId||paused)return;rotate(e.clientX-lookX,e.clientY-lookY);lookX=e.clientX;lookY=e.clientY;});
      const release=e=>{if(lookId===e.pointerId)lookId=null;};
      c.addEventListener('pointerup',release);c.addEventListener('pointercancel',release);
    }
  }
  const stick=$('#stick'),joy=$('#joystick');
  function moveJoy(e){const r=joy.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),max=r.width*.31,l=Math.hypot(dx,dy)||1,f=Math.min(1,max/l);const x=dx*f,y=dy*f;joystick={x:x/max,y:y/max};stick.style.transform=`translate(${x}px,${y}px)`;}
  joy.addEventListener('pointerdown',e=>{e.preventDefault();if(joyId!==null)return;joyId=e.pointerId;joy.setPointerCapture(e.pointerId);moveJoy(e);});
  joy.addEventListener('pointermove',e=>{if(joyId===e.pointerId)moveJoy(e);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])joy.addEventListener(name,e=>{if(e.pointerId===joyId){joyId=null;joystick={x:0,y:0};stick.style.transform='';}});
  $('#jumpBtn').addEventListener('pointerdown',e=>{e.preventDefault();jump=true;});
  function bindAction(selector,action){const el=$(selector);let interval=null;
    el.addEventListener('pointerdown',e=>{e.preventDefault();if(paused)return;el.setPointerCapture(e.pointerId);el.classList.add('pressed');edit(action);clearInterval(interval);interval=setInterval(()=>edit(action),215);});
    const stop=()=>{el.classList.remove('pressed');clearInterval(interval);interval=null;};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,stop);
  }
  bindAction('#breakBtn','break');bindAction('#placeBtn','place');
  function select(n){selected=n;document.querySelectorAll('.slot').forEach(el=>el.classList.toggle('selected',Number(el.dataset.block)===n));}
  document.querySelectorAll('.slot').forEach(el=>el.onclick=()=>select(Number(el.dataset.block)));
  window.addEventListener('keydown',e=>{if(['INPUT','SELECT'].includes(document.activeElement?.tagName))return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='Space')jump=true;if(/^Digit[1-7]$/.test(e.code))select(Number(e.code.slice(5)));if(e.code==='Escape'&&paused)toggleSettings(false);});
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();joystick={x:0,y:0};stick.style.transform='';});
  function loop(now){requestAnimationFrame(loop);
    if(!online||!renderer){lastFrame=now;return;}
    // Mobile target 30 FPS: update physics and render together; no CPU busy loop.
    if(COARSE&&now-lastRender<30)return;
    const dt=Math.min(.05,(now-(lastFrame||now))/1000);lastFrame=now;lastRender=now;
    movement(dt);
    camera.position.set(p.x,p.y+1.56,p.z);camera.rotation.set(pitch,yaw,0,'YXZ');
    if(friendTarget&&friend){
      const t=clamp(dt*11,0,1);friend.position.lerp(new THREE.Vector3(friendTarget.x,friendTarget.y,friendTarget.z),t);
      const delta=Math.atan2(Math.sin(friendTarget.yaw-friend.rotation.y),Math.cos(friendTarget.yaw-friend.rotation.y));friend.rotation.y+=delta*t;
    }
    if(now-lastAim>60){updateAim();lastAim=now;}
    if(now-lastSend>100){send({type:'move',p:{x:p.x,y:p.y,z:p.z,yaw,pitch}});lastSend=now;}
    renderer.render(scene,camera);
    frames++;
    if(!fpsStart)fpsStart=now;
    if(now-fpsStart>1900){fps=Math.round(frames*1000/(now-fpsStart));$('#fps').textContent=`${fps} FPS`;
      if(mode==='auto'&&COARSE){const old=renderScale;if(fps<23)renderScale=Math.max(.65,renderScale-.09);else if(fps>29)renderScale=Math.min(1.04,renderScale+.035);if(Math.abs(old-renderScale)>.02)pixelRatio();}
      frames=0;fpsStart=now;
    }
  }
  const initial=new URLSearchParams(location.search).get('sala');
  if(initial&&/^[0-9A-F]{4}$/i.test(initial)){$('#roomCode').value=initial.toUpperCase();connect('join',initial.toUpperCase());}
  window.__BLOCK_WORLD__={get online(){return online;},get room(){return room;},get chunks(){return chunks.size;},get blocks(){return world.size;},get fps(){return fps;},get player(){return {...p};},get selected(){return selected;}};
  console.log('BLOCK WORLD V3 loaded');
})();
