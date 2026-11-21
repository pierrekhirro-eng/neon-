'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, 'public');
const SIZE = 40, HEIGHT = 25;
const rooms = new Map();
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const id = (x,y,z) => `${x},${y},${z}`;

const server = http.createServer((req,res) => {
  if(req.method !== 'GET' && req.method !== 'HEAD'){res.writeHead(405);return res.end();}
  let pathname;
  try {pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  if(pathname.includes('\0')){res.writeHead(400);return res.end();}
  const file=path.resolve(ROOT, '.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();
    res.end(data);
  });
});

function heightAt(x,z){
  const d=Math.hypot(x-20,z-20);
  if(d<7)return 5;
  const base=5+Math.sin(x*.28)*1.7+Math.cos(z*.23)*1.4+Math.sin((x+z)*.17)*.8;
  const h=clamp(Math.floor(base),2,9);
  return d<10?Math.round(5+(h-5)*(d-7)/3):h;
}
function generate(){
  const map=new Map();
  const put=(x,y,z,type)=>{if(x>=0&&x<SIZE&&z>=0&&z<SIZE&&y>=0&&y<HEIGHT)map.set(id(x,y,z),type);};
  for(let x=0;x<SIZE;x++)for(let z=0;z<SIZE;z++){
    const h=heightAt(x,z);
    for(let y=0;y<=h;y++)put(x,y,z,y===h?1:y>=h-2?2:3);
    // Small patches of sandy ground.
    if((x*19+z*23)%47===0 && h<=4)put(x,h,z,6);
  }
  for(let x=3;x<SIZE-3;x+=4)for(let z=3;z<SIZE-3;z+=5){
    if((x*31+z*17)%7>3 || Math.hypot(x-20,z-20)<10)continue;
    const ground=heightAt(x,z), top=ground+4;
    for(let y=ground+1;y<=top;y++)put(x,y,z,4);
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=-1;dy<=2;dy++){
      if(Math.abs(dx)+Math.abs(dz)+Math.abs(dy)*.8>3.8)continue;
      const xx=x+dx, yy=top+dy, zz=z+dz;
      if(!map.has(id(xx,yy,zz)))put(xx,yy,zz,5);
    }
  }
  // A small spawn camp with a contrasting floor and a welcome marker.
  for(let x=18;x<=21;x++)for(let z=18;z<=21;z++)put(x,5,z,7);
  return map;
}
function newCode(){let s;do{s=crypto.randomBytes(3).toString('hex').slice(0,4).toUpperCase();}while(rooms.has(s));return s;}
function makeRoom(){const r={code:newCode(),map:generate(),users:[null,null],players:[null,null],emptyAt:0};rooms.set(r.code,r);return r;}
function send(ws,m){if(ws&&ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<750000)ws.send(JSON.stringify(m));}
function broadcast(room,m,exclude=null){for(const client of room.users)if(client!==exclude)send(client,m);}
function spawn(slot){return {x:slot?22.5:17.5,y:6.05,z:20.5,yaw:slot?Math.PI/2:-Math.PI/2,pitch:0};}
function publishPlayers(room){broadcast(room,{type:'players',players:room.players});}
function join(ws,room){
  const slot=room.users.findIndex(c=>!c);
  if(slot<0){send(ws,{type:'error',message:'Sala cheia: só cabem dois jogadores.'});return;}
  room.users[slot]=ws;room.players[slot]=spawn(slot);room.emptyAt=0;
  ws.room=room;ws.slot=slot;
  send(ws,{type:'joined',code:room.code,slot,spawn:room.players[slot],size:SIZE,height:HEIGHT,blocks:[...room.map].map(([pos,type])=>[...pos.split(',').map(Number),type]),players:room.players});
  publishPlayers(room);
}
function validPlayer(p){return p&&['x','y','z','yaw','pitch'].every(k=>Number.isFinite(p[k]))&&p.x>=.2&&p.x<=SIZE-.2&&p.z>=.2&&p.z<=SIZE-.2&&p.y>=-3&&p.y<HEIGHT+15&&Math.abs(p.pitch)<1.7;}
const wss=new WebSocket.Server({server,maxPayload:4096,perMessageDeflate:false});
wss.on('connection',ws=>{
  ws.room=null;ws.slot=-1;ws.isAlive=true;ws.lastEdit=0;ws.lastMove=0;
  ws.on('pong',()=>ws.isAlive=true);
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(String(raw));}catch{return;}
    if(!m||typeof m!=='object'||Array.isArray(m))return;
    if(m.type==='create'&&!ws.room){if(rooms.size>=100)return send(ws,{type:'error',message:'Servidor cheio. Tente mais tarde.'});return join(ws,makeRoom());}
    if(m.type==='join'&&!ws.room){
      const code=String(m.code||'').trim().toUpperCase();
      if(!/^[0-9A-F]{4}$/.test(code))return send(ws,{type:'error',message:'Código inválido.'});
      const r=rooms.get(code);if(!r)return send(ws,{type:'error',message:'Sala não encontrada. Peça um link novo.'});
      return join(ws,r);
    }
    const room=ws.room;if(!room)return;
    if(m.type==='move'){
      const now=Date.now();if(now-ws.lastMove<45||!validPlayer(m.p))return;
      const old=room.players[ws.slot];
      if(Math.hypot(m.p.x-old.x,m.p.y-old.y,m.p.z-old.z)>3.5)return;
      ws.lastMove=now;
      room.players[ws.slot]={x:m.p.x,y:m.p.y,z:m.p.z,yaw:m.p.yaw,pitch:m.p.pitch};
      return;
    }
    if(m.type==='block'){
      const now=Date.now();if(now-ws.lastEdit<155)return;
      const {x,y,z}=m;
      if(![x,y,z].every(Number.isInteger)||x<0||x>=SIZE||z<0||z>=SIZE||y<0||y>=HEIGHT)return;
      const p=room.players[ws.slot];
      if(Math.hypot(x+.5-p.x,y+.5-(p.y+1.5),z+.5-p.z)>6)return;
      const k=id(x,y,z), action=m.action;
      if(action==='break'){
        if(y===0||!room.map.has(k))return;
        room.map.delete(k);
      } else if(action==='place'){
        const type=m.blockType;
        if(!Number.isInteger(type)||type<1||type>7||room.map.has(k))return;
        if(room.players.some(o=>o&&Math.abs(o.x-(x+.5))<.83&&Math.abs(o.z-(z+.5))<.83&&y<o.y+1.75&&y+1>o.y))return;
        room.map.set(k,type);
      } else return;
      ws.lastEdit=now;
      broadcast(room,{type:'block',x,y,z,blockType:room.map.get(k)||0});
    }
  });
  ws.on('close',()=>{
    const r=ws.room;if(!r)return;
    if(r.users[ws.slot]===ws){r.users[ws.slot]=null;r.players[ws.slot]=null;publishPlayers(r);}
    if(r.users.every(c=>!c))r.emptyAt=Date.now();
  });
  ws.on('error',()=>{});
});
setInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values())if(r.users.some(Boolean))publishPlayers(r);
  for(const [code,r] of rooms)if(r.emptyAt&&now-r.emptyAt>180000)rooms.delete(code);
},100);
setInterval(()=>{
  for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}
},30000);
server.listen(PORT,'0.0.0.0',()=>console.log(`BLOCK WORLD V3 listening on ${PORT}`));
