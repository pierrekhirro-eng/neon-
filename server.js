'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const PORT = Number(process.env.PORT || 3000);
const root = path.join(__dirname, 'public');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  let p;
  try { p = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(root, '.' + (p === '/' ? '/index.html' : p));
  if (!file.startsWith(root + path.sep) && file !== path.join(root,'index.html')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200, {'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
});
const wss = new WebSocket.Server({server});
const rooms = new Map();
const W=960,H=540,R=17;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const obstacles=[{x:325,y:145,w:90,h:105},{x:545,y:290,w:90,h:105},{x:440,y:242,w:80,h:55}];
function code(){let c;do{c=Math.random().toString(36).slice(2,6).toUpperCase();}while(rooms.has(c));return c;}
function player(i){return {id:i,x:i?760:200,y:270,hp:100,kills:0,dir:0,shootAt:0,invuln:0,input:{x:0,y:0,aimX:1,aimY:0,fire:false}};}
function makeRoom(c){const rm={code:c,clients:[null,null],players:[player(0),player(1)],bullets:[],enemies:[],pickups:[],phase:'waiting',phaseUntil:0,wave:0,spawnLeft:0,spawnAt:0,waveEndAt:0,last:Date.now()};rooms.set(c,rm);return rm;}
function send(ws,data){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function broadcast(rm,data){rm.clients.forEach(ws=>send(ws,data));}
function startWave(rm,now){rm.wave++;rm.spawnLeft=5+rm.wave*3;rm.spawnAt=now+600;rm.phase='playing';broadcast(rm,{type:'event',message:`ONDA ${rm.wave}!`,tone:'info'});}
function resetMatch(rm,now){rm.players=[player(0),player(1)];rm.bullets=[];rm.enemies=[];rm.pickups=[];rm.wave=0;rm.phase='countdown';rm.phaseUntil=now+1700;}
function occupy(ws,rm){const index=rm.clients.findIndex(c=>!c);if(index===-1)return false;rm.clients[index]=ws;ws.room=rm;ws.slot=index;send(ws,{type:'joined',code:rm.code,slot:index});broadcast(rm,{type:'event',message:index?'Seu parceiro entrou!':'Sala criada! Compartilhe o link.',tone:'info'});if(rm.clients.every(Boolean))resetMatch(rm,Date.now());return true;}
function circleBox(x,y,r,b){const nx=clamp(x,b.x,b.x+b.w),ny=clamp(y,b.y,b.y+b.h);return (x-nx)**2+(y-ny)**2<r*r;}
function movable(x,y,r=R){return x>=r&&x<=W-r&&y>=r&&y<=H-r&&!obstacles.some(b=>circleBox(x,y,r,b));}
function spawnEnemy(rm){for(let i=0;i<30;i++){const side=Math.floor(Math.random()*4),x=side===0?25:side===1?W-25:25+Math.random()*(W-50),y=side===2?25:side===3?H-25:25+Math.random()*(H-50);if(rm.players.every(p=>Math.hypot(p.x-x,p.y-y)>180)){const strong=Math.random()<Math.min(.12+rm.wave*.025,.36);rm.enemies.push({x,y,hp:strong?100:45,maxHp:strong?100:45,speed:(strong?62:83)+Math.min(rm.wave*5,65),r:strong?22:15,attackAt:0});break;}}}
function update(rm,now,dt){if(rm.phase==='countdown'&&now>=rm.phaseUntil)startWave(rm,now);if(rm.phase==='intermission'&&now>=rm.phaseUntil)startWave(rm,now);if(rm.phase!=='playing')return;
if(rm.spawnLeft>0&&now>=rm.spawnAt){spawnEnemy(rm);rm.spawnLeft--;rm.spawnAt=now+Math.max(200,750-rm.wave*30);}
for(const p of rm.players){if(p.hp<=0)continue;const input=p.input;let dx=clamp(input.x,-1,1),dy=clamp(input.y,-1,1);const len=Math.max(1,Math.hypot(dx,dy));dx/=len;dy/=len;const speed=235*dt;const nx=p.x+dx*speed,ny=p.y+dy*speed;if(movable(nx,p.y))p.x=nx;if(movable(p.x,ny))p.y=ny;if(Math.hypot(input.aimX,input.aimY)>.1)p.dir=Math.atan2(input.aimY,input.aimX);if(input.fire&&now>=p.shootAt){p.shootAt=now+195;rm.bullets.push({x:p.x+Math.cos(p.dir)*25,y:p.y+Math.sin(p.dir)*25,vx:Math.cos(p.dir)*670,vy:Math.sin(p.dir)*670,owner:p.id,life:0});}}
for(let i=rm.bullets.length-1;i>=0;i--){const b=rm.bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life+=dt;let hit=false;for(let j=rm.enemies.length-1;j>=0;j--){const e=rm.enemies[j];if(Math.hypot(b.x-e.x,b.y-e.y)<e.r+6){e.hp-=25;hit=true;if(e.hp<=0){rm.enemies.splice(j,1);rm.players[b.owner].kills++;if(Math.random()<.16)rm.pickups.push({x:e.x,y:e.y});}break;}}if(hit||b.x<6||b.x>W-6||b.y<6||b.y>H-6||b.life>1.6||obstacles.some(o=>circleBox(b.x,b.y,6,o)))rm.bullets.splice(i,1);}
for(const e of rm.enemies){let target=null,dist=Infinity;for(const p of rm.players){if(p.hp<=0)continue;const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<dist){dist=d;target=p;}}if(!target)break;const dx=(target.x-e.x)/(dist||1),dy=(target.y-e.y)/(dist||1);const step=e.speed*dt;if(movable(e.x+dx*step,e.y,e.r))e.x+=dx*step;if(movable(e.x,e.y+dy*step,e.r))e.y+=dy*step;if(dist<e.r+R+3&&now>=e.attackAt&&now>=target.invuln){target.hp=Math.max(0,target.hp-13);target.invuln=now+570;e.attackAt=now+800;}}
for(let i=rm.pickups.length-1;i>=0;i--){const item=rm.pickups[i];const p=rm.players.find(p=>p.hp>0&&p.hp<100&&Math.hypot(p.x-item.x,p.y-item.y)<R+16);if(p){p.hp=Math.min(100,p.hp+30);rm.pickups.splice(i,1);}}
if(rm.players.every(p=>p.hp===0)){rm.phase='finished';broadcast(rm,{type:'event',message:`FIM DE JOGO · ONDA ${rm.wave}`,tone:'info'});return;}
if(rm.spawnLeft===0&&rm.enemies.length===0){rm.phase='intermission';rm.phaseUntil=now+3000;rm.players.forEach(p=>{if(p.hp===0)p.hp=40;else p.hp=Math.min(100,p.hp+15);p.invuln=now+1200;});broadcast(rm,{type:'event',message:`ONDA ${rm.wave} CONCLUÍDA!`,tone:'win'});}}
let last=Date.now();setInterval(()=>{const now=Date.now(),dt=Math.min((now-last)/1000,.05);last=now;for(const rm of rooms.values()){update(rm,now,dt);broadcast(rm,{type:'state',players:rm.players.map(p=>({x:p.x,y:p.y,hp:p.hp,kills:p.kills,dir:p.dir,invuln:p.invuln>now})),bullets:rm.bullets,enemies:rm.enemies,pickups:rm.pickups,phase:rm.phase,phaseRemaining:Math.max(0,rm.phaseUntil-now),wave:rm.wave,remaining:rm.enemies.length+rm.spawnLeft});}},1000/30);
wss.on('connection',ws=>{ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});ws.on('message',raw=>{if(raw.length>1024)return;let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
if(m.type==='create'&&!ws.room){occupy(ws,makeRoom(code()));return;}
if(m.type==='join'&&!ws.room){const c=String(m.code||'').trim().toUpperCase();const rm=rooms.get(c);if(!rm)return send(ws,{type:'error',message:'Sala não encontrada.'});if(!occupy(ws,rm))send(ws,{type:'error',message:'Sala cheia.'});return;}
if(!ws.room)return;const rm=ws.room;
if(m.type==='input'){const p=rm.players[ws.slot],v=m;const valid=n=>typeof n==='number'&&Number.isFinite(n)?clamp(n,-1,1):0;p.input={x:valid(v.x),y:valid(v.y),aimX:valid(v.aimX),aimY:valid(v.aimY),fire:v.fire===true};}
if(m.type==='restart'&&rm.phase==='finished'&&rm.clients.every(Boolean))resetMatch(rm,Date.now());
});ws.on('close',()=>{const rm=ws.room;if(!rm)return;rm.clients[ws.slot]=null;rm.phase='waiting';rm.bullets=[];rm.enemies=[];rm.pickups=[];rm.players.forEach(p=>p.input.fire=false);broadcast(rm,{type:'event',message:'O outro jogador saiu. Aguardando reconexão.',tone:'info'});if(rm.clients.every(c=>!c))rooms.delete(rm.code);});});
setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},30000);
server.listen(PORT,()=>console.log(`Arena Dupla em http://localhost:${PORT}`));
