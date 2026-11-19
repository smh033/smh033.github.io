/* =====================================================================
   RETRO FOOTBALL LAB · BROADCAST CAMERA ("Madden mode")
   Only loaded by lab.html, and only for the owner's account. It swaps the flat side view for a 3D stadium
   seen from behind the play: the same game, same rules, same controls, just a different camera.
   - The world is in yards: X = down the field (0-120, goal lines at 10 and 110), Z = across (0-53.3), Y = up.
   - Players are the game's own pixel sprites standing in the 3D world (billboards), so every skin works.
   - Play art (routes, aim spot, landing ring, defensive assignments) is drawn by the normal 2D code onto the
     old canvas and laid on the grass as a see-through layer, so it lines up with the 3D field.
   - Taps are turned into field positions by casting them onto the grass, so passing, steering, picking a
     defender etc. keep working. The joystick and the arrow keys are turned so "up" is always up the screen.
   - Kicks and replays still use the classic views.
   ===================================================================== */
(function(){
'use strict';
const YPU=0.072;            // yards per sprite pixel unit (a player is about 2 yards tall)
const V3=window.V3={on:true,ready:false,f:1,cam:null,look:null,raw:{x:0,y:0},KP:{}};
let R,scene,camera,cv3,root,overTex,overMesh,overCv,ballSpr,ringMesh,losMesh,fdMesh,lastTeams='',stadium=null,groundShadows=[];
const texOf=new WeakMap(),pool=[];
try{V3.on=localStorage.getItem('rf_v3')!=='0';}catch(e){}

/* ---------------- textures ---------------- */
const NEAREST=t=>{t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;return t;};
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
function canvasTex(c){const t=new THREE.CanvasTexture(c);NEAREST(t);if('colorSpace' in t)t.colorSpace=THREE.SRGBColorSpace;else t.encoding=THREE.sRGBEncoding;return t;}

/* the field: 16 px a yard, stripes, end zones in team colours, numbers, hash marks */
function fieldCanvas(home,away){
 const P=16,W=120*P,H=Math.round(53.33*P),c=canvas(W,H),g=c.getContext('2d');
 const night=!!(M&&M.night),gA=night?'#2c6a34':'#3f8f3a',gB=night?'#275f2f':'#38823a';
 for(let x=0;x<120;x+=5){g.fillStyle=(Math.floor(x/5)%2)?gA:gB;g.fillRect(x*P,0,5*P,H);}
 /* grass grain */
 for(let i=0;i<9000;i++){g.fillStyle=Math.random()<0.5?'rgba(0,0,0,.06)':'rgba(255,255,255,.04)';g.fillRect(Math.random()*W|0,Math.random()*H|0,2,2);}
 const ez=(x0,t)=>{const tc=teamCol(t);g.fillStyle=tc.c1;g.fillRect(x0*P,0,10*P,H);
  g.save();g.translate((x0+5)*P,H/2);g.rotate(x0<60?-Math.PI/2:Math.PI/2);g.font=`bold ${Math.round(5.2*P)}px "Press Start 2P",monospace`;g.textAlign='center';g.textBaseline='middle';
  g.lineWidth=P*0.6;g.strokeStyle='#0b0b14';g.fillStyle=tc.c2;const nm=(T(t).nickname||T(t).abbr).toUpperCase();g.strokeText(nm,0,0);g.fillText(nm,0,0);g.restore();};
 ez(0,home);ez(110,away);
 g.fillStyle='#fff';
 for(let x=10;x<=110;x+=5)g.fillRect(x*P-2,0,4,H);                       // yard lines
 for(let x=11;x<110;x++){if(x%5===0)continue;for(const y of[1,22.9,30.4,52.3])g.fillRect(x*P-1,y*P,2,P*0.7);} // hashes
 g.fillRect(0,0,W,5);g.fillRect(0,H-5,W,5);g.fillRect(0,0,5,H);g.fillRect(W-5,0,5,H);
 g.font=`${Math.round(2.4*P)}px "Press Start 2P",monospace`;g.textAlign='center';g.textBaseline='middle';
 for(let x=20;x<=100;x+=10){const n=String(x<=60?x-10:110-x);
  for(const[y,rot]of[[9,0],[44.3,Math.PI]]){g.save();g.translate(x*P,y*P);g.rotate(rot);g.fillText(n,0,0);g.restore();}}
 /* midfield: home logo letters */
 g.save();g.translate(60*P,H/2);g.font=`${Math.round(4*P)}px "Press Start 2P",monospace`;g.fillStyle='rgba(255,255,255,.85)';g.strokeStyle='rgba(0,0,0,.5)';g.lineWidth=6;
 g.strokeText(T(home).abbr,0,0);g.fillText(T(home).abbr,0,0);g.restore();
 return c;}

/* a crowd: rows of tiny fans in both teams' colours */
function crowdCanvas(home,away,rows){const W=256,H=rows*8,c=canvas(W,H),g=c.getContext('2d');const a=teamCol(home),b=teamCol(away);
 const cols=[a.c1,a.c1,a.c2,'#d8d8d8','#2a2a35',b.c1,'#c08a5a','#7a5034',a.c1];
 for(let r=0;r<rows;r++){g.fillStyle=r%2?'#3a3f4a':'#30343e';g.fillRect(0,r*8,W,8);g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,r*8+7,W,1);
  for(let x=1;x<W;x+=4){if(Math.random()<0.12)continue;const cc=cols[(Math.random()*cols.length)|0];g.fillStyle=cc;g.fillRect(x,r*8+3,3,4);g.fillStyle=['#f1c7a0','#c58c5c','#8a5a34','#5a3a22'][(Math.random()*4)|0];g.fillRect(x+0.5|0,r*8+1,2,2);}}
 return c;}
function bannerCanvas(t){const c=canvas(512,32),g=c.getContext('2d'),tc=teamCol(t);g.fillStyle=tc.c1;g.fillRect(0,0,512,32);g.fillStyle=tc.c2;g.fillRect(0,0,512,3);g.fillRect(0,29,512,3);
 g.font='16px "Press Start 2P",monospace';g.textBaseline='middle';g.fillStyle=tc.c2;const s=(T(t).name||'').toUpperCase()+'  ◆  ';let x=4;while(x<512){g.fillText(s,x,17);x+=g.measureText(s).width;}return c;}
function skyCanvas(){const c=canvas(4,256),g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,256);
 if(M&&M.night){gr.addColorStop(0,'#03050f');gr.addColorStop(.6,'#0c1430');gr.addColorStop(1,'#1c2850');}
 else{gr.addColorStop(0,'#2a3f8a');gr.addColorStop(.45,'#8a6aa8');gr.addColorStop(.75,'#f0a070');gr.addColorStop(1,'#ffd9a0');}
 g.fillStyle=gr;g.fillRect(0,0,4,256);return c;}

/* ---------------- the stadium ---------------- */
function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);return m;}
function buildStadium(home,away){
 if(stadium){scene.remove(stadium);stadium.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});}
 stadium=new THREE.Group();scene.add(stadium);
 const fTex=canvasTex(fieldCanvas(home,away));
 const field=new THREE.Mesh(new THREE.PlaneGeometry(120,53.33),new THREE.MeshBasicMaterial({map:fTex}));field.rotation.x=-Math.PI/2;field.position.set(60,0,26.665);stadium.add(field);
 /* the grass around the field and the track */
 const apron=new THREE.Mesh(new THREE.PlaneGeometry(170,100),new THREE.MeshBasicMaterial({color:M&&M.night?0x1f4a26:0x2f6f30}));apron.rotation.x=-Math.PI/2;apron.position.set(60,-0.02,26.665);stadium.add(apron);
 /* sideline wall with team banners */
 const banH=canvasTex(bannerCanvas(home));banH.wrapS=THREE.RepeatWrapping;banH.repeat.set(6,1);
 const banA=canvasTex(bannerCanvas(away));banA.wrapS=THREE.RepeatWrapping;banA.repeat.set(3,1);
 const wallM=new THREE.MeshBasicMaterial({map:banH}),wallA=new THREE.MeshBasicMaterial({map:banA});
 stadium.add(box(150,1.4,0.4,wallM,60,0.7,-6));stadium.add(box(150,1.4,0.4,wallM,60,0.7,59.3));
 stadium.add(box(0.4,1.4,66,wallA,-16,0.7,26.665));stadium.add(box(0.4,1.4,66,wallA,136,0.7,26.665));
 /* the stands: steps of seats going up and back on all four sides */
 const rows=6,crowd=canvasTex(crowdCanvas(home,away,rows));crowd.wrapS=THREE.RepeatWrapping;crowd.repeat.set(10,1);
 const seatM=new THREE.MeshBasicMaterial({map:crowd}),concrete=new THREE.MeshBasicMaterial({color:0x5a5560}),roofM=new THREE.MeshBasicMaterial({color:0x2c2a33});
 for(let tier=0;tier<5;tier++){const up=1.4+tier*2.6,out=tier*3.4;
  for(const side of[-1,1]){const z=side<0?-7.5-out:60.8+out;
   const st=new THREE.Mesh(new THREE.PlaneGeometry(176,3.9),seatM);st.position.set(60,up+1.3,z);st.rotation.x=side<0?-0.62:0.62;if(side>0)st.rotation.y=Math.PI;stadium.add(st);
   stadium.add(box(176,0.5,3.4,concrete,60,up-0.1,z+side*0.3));}
  for(const end of[-1,1]){const x=end<0?-17.5-out:137.5+out;
   const st=new THREE.Mesh(new THREE.PlaneGeometry(86,3.9),seatM);st.position.set(x,up+1.3,26.665);st.rotation.y=end<0?Math.PI/2:-Math.PI/2;st.rotation.x=0;st.rotateX(-0.62);stadium.add(st);}}
 /* upper deck faces and roof lip so the bowl reads from the low camera */
 stadium.add(box(200,6,1,roofM,60,17.5,-27));stadium.add(box(200,6,1,roofM,60,17.5,80.5));
 stadium.add(box(1,6,110,roofM,-37,17.5,26.665));stadium.add(box(1,6,110,roofM,157,17.5,26.665));
 /* video boards behind each end zone */
 for(const end of[-1,1]){const x=end<0?-30:150;const scr=new THREE.MeshBasicMaterial({color:0x0b0d14});
  for(const zz of[12,41]){stadium.add(box(1,7,13,scr,x,15,zz));const glow=new THREE.Mesh(new THREE.PlaneGeometry(12,6),new THREE.MeshBasicMaterial({color:end<0?new THREE.Color(teamCol(home).c1):new THREE.Color(teamCol(away).c1),transparent:true,opacity:0.35}));
   glow.position.set(x-end*0.6,15,zz);glow.rotation.y=end<0?Math.PI/2:-Math.PI/2;stadium.add(glow);}}
 /* goal posts on the end lines */
 const gold=new THREE.MeshBasicMaterial({color:0xf2c522}),goldD=new THREE.MeshBasicMaterial({color:0xd9a91a});
 for(const x of[0,120]){const back=x===0?-1.2:1.2;
  stadium.add(box(0.25,3.4,0.25,goldD,x+back,1.7,26.665));
  stadium.add(box(Math.abs(back)+0.2,0.25,0.25,gold,x+back/2,3.33,26.665));
  stadium.add(box(0.22,0.22,6.17,gold,x,3.33,26.665));
  for(const s of[-1,1])stadium.add(box(0.2,6.7,0.2,gold,x,3.33+3.35,26.665+s*3.085));
  for(const s of[-1,1]){const fl=box(0.05,0.4,0.6,new THREE.MeshBasicMaterial({color:0xff3b30}),x,10.1,26.665+s*3.085+0.3);stadium.add(fl);}}
 /* stadium lights */
 const lightM=new THREE.MeshBasicMaterial({color:0xfff6d8}),poleM=new THREE.MeshBasicMaterial({color:0x3a3a44});
 for(const[x,z]of[[-8,-24],[128,-24],[-8,77],[128,77]]){stadium.add(box(0.6,26,0.6,poleM,x,13,z));stadium.add(box(5,2.4,0.6,lightM,x,26,z));}
 scene.background=canvasTex(skyCanvas());scene.fog=new THREE.Fog(M&&M.night?0x0a1024:0xc8a0a0,90,260);}


/* ---------------- 3D player sprites ----------------
   Drawn just for this mode: the camera sits behind the play, so each player needs a BACK view (running away
   from you, name-bar number on the back), a FRONT view (coming at you, facemask) and a SIDE view (crossing).
   26x36 pixels, team uniform colours only (skins are off in this mode), 4 running frames, carrying, throwing,
   and lying down. Each look is drawn once and cached. */
const S3=new Map();
const DIG=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001010010010','111101111101111','111101111001111'];
function shadeC(c,k){const n=parseInt(String(c).slice(1),16);if(isNaN(n))return c;let r=n>>16&255,g=n>>8&255,b=n&255;const f=x=>Math.max(0,Math.min(255,Math.round(k<0?x*(1+k):x+(255-x)*k)));return'#'+[f(r),f(g),f(b)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function spr3(lk,view,fr,fl,num){
 const key=[lk.helm,lk.stripe,lk.jersey,lk.trim,lk.pants,lk.socks,lk.mask||'',lk.skin,view,fr,fl.ball?1:0,fl.throw?1:0,fl.down?1:0,fl.glow?1:0,num].join('|');
 let out=S3.get(key);if(out)return out;
 const W=26,H=36,a=canvas(W,H),g=a.getContext('2d'),P=(x,y,w,h,c)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
 const J=lk.jersey,Jd=shadeC(J,-0.25),Jl=shadeC(J,0.18),Hm=lk.helm,Hd=shadeC(Hm,-0.28),Hl=shadeC(Hm,0.3),Tr=lk.trim,Pn=lk.pants,Pd=shadeC(Pn,-0.22),Sk=lk.skin||'#c58c5c',Sd=shadeC(Sk,-0.2),So=lk.socks,Mk=lk.mask||'#c8c8c8',CL='#16161c',GL='#2a2a30';
 const run=fr>=0,st=run?fr%4:-1,legA=st===0?-2:st===2?2:0,bob=(st===1||st===3)?-1:0;
 const digits=(x0,y0,col)=>{const n=String(Math.max(0,num|0)%100),w=n.length*4-1;let x=x0-Math.floor(w/2);for(const ch of n){const d=DIG[+ch];for(let i=0;i<15;i++)if(d[i]==='1')P(x+i%3,y0+(i/3|0),1,1,col);x+=4;}};
 if(view==='side'){ /* facing right */
  const y=bob;
  /* back arm (behind the body) */
  P(10+(st===0?2:st===2?-2:0),13+y,3,6,Jd);P(10+(st===0?2:st===2?-2:0),19+y,3,2,Sd);
  /* legs: stride */
  const fx=st===0?4:st===2?-2:st===1||st===3?1:1,bx=-fx;
  P(11+bx,22+y,4,5,Pd);P(11+bx,27+y,3,4,shadeC(So,-0.2));P(10+bx,31+y,5,2,CL);
  P(12+fx,22+y,4,5,Pn);P(12+fx,27+y,3,4,So);P(12+fx,31+y,6,2,CL);
  /* body */
  P(10,12+y,7,9,J);P(10,12+y,7,2,Jl);P(9,13+y,2,6,Tr);P(10,20+y,7,2,Pd);
  digits(13,14+y,Tr);
  /* helmet */
  P(10,3+y,8,7,Hm);P(11,2+y,6,1,Hm);P(11,3+y,3,1,Hl);P(10,9+y,7,1,Hd);P(13,2+y,1,8,lk.stripe);
  P(16,6+y,2,3,Sk);P(18,5+y,2,1,Mk);P(18,7+y,2,1,Mk);P(19,5+y,1,4,Mk);P(16,5+y,1,1,'#111');
  P(12,10+y,3,2,Sk);
  /* front arm / ball / throw */
  if(fl.throw){P(13,4+y,3,9,J);P(13,2+y,3,2,Sk);P(12,0,4,3,'#7a3e14');}
  else if(fl.ball){P(14,13+y,4,4,J);P(16,15+y,5,3,'#7a3e14');P(17,16+y,3,1,'#f4ead2');}
  else{const ax=st===0?-2:st===2?3:1;P(13+ax,13+y,3,5,J);P(13+ax,18+y,3,2,Sk);P(13+ax,20+y,3,1,GL);}
 }else{ /* back (away from the camera) or front (towards it) */
  const front=view==='front',y=bob;
  /* legs */
  const lU=st===0?-2:0,rU=st===2?-2:0;
  P(8,21+y,5,5+lU,Pn);P(13,21+y,5,5+rU,Pn);P(8,21+y,1,5+lU,Tr);P(17,21+y,1,5+rU,Tr);P(12,22+y,2,4,Pd);
  P(9,26+y+lU,3,4,So);P(14,26+y+rU,3,4,So);
  P(8,30+y+lU,5,2,CL);P(13,30+y+rU,5,2,CL);
  /* arms: swing opposite to legs */
  const aL=st===2?-1:st===0?1:0,aR=-aL;
  P(4,12+y+aL,3,4,J);P(4,16+y+aL,3,3,Sk);P(4,19+y+aL,3,1,GL);
  if(fl.throw){P(19,3+y,3,9,J);P(19,1+y,3,2,Sk);P(18,-1+y<0?0:-1+y,4,3,'#7a3e14');}
  else if(fl.ball){P(19,12+y,3,4,J);P(15,15+y,6,3,'#7a3e14');P(16,16+y,4,1,'#f4ead2');}
  else{P(19,12+y+aR,3,4,J);P(19,16+y+aR,3,3,Sk);P(19,19+y+aR,3,1,GL);}
  /* jersey and pads */
  P(6,11+y,14,3,J);P(6,11+y,14,1,Jl);P(6,12+y,2,1,Tr);P(18,12+y,2,1,Tr);P(8,14+y,10,6,J);P(8,19+y,10,1,Jd);P(8,20+y,10,1,Pd);
  digits(13,13+y,Tr);
  /* helmet */
  P(9,2+y,8,8,Hm);P(10,1+y,6,1,Hm);P(10,2+y,2,2,Hl);P(9,9+y,8,1,Hd);
  if(front){P(10,5+y,6,4,Sk);P(11,6+y,1,1,'#111');P(14,6+y,1,1,'#111');P(9,6+y,8,1,Mk);P(9,8+y,8,1,Mk);P(12,5+y,1,4,Mk);P(13,5+y,1,4,Mk);P(12,1+y,2,4,lk.stripe);}
  else{P(12,1+y,2,9,lk.stripe);P(11,10+y,4,1,Sk);}
 }
 if(fl.down){const r=canvas(W,H),gr=r.getContext('2d');gr.translate(W/2,H-6);gr.rotate(Math.PI/2);gr.drawImage(a,-W/2,-H+4);g.clearRect(0,0,W,H);g.drawImage(r,0,0);}
 /* dark outline (and a gold one for stars) */
 out=canvas(W,H);const go=out.getContext('2d');
 const sil=col=>{const b=canvas(W,H),gb=b.getContext('2d');gb.drawImage(a,0,0);gb.globalCompositeOperation='source-in';gb.fillStyle=col;gb.fillRect(0,0,W,H);return b;};
 if(fl.glow){const yv=sil('#ffe600');for(const[dx,dy]of[[-2,0],[2,0],[0,-2],[0,2]])go.drawImage(yv,dx,dy);}
 const bk=sil('#0a0a12');for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]])go.drawImage(bk,dx,dy);go.drawImage(a,0,0);
 if(S3.size>4000)S3.clear();S3.set(key,out);return out;}

/* ---------------- setup ---------------- */
function init(){
 cv3=document.createElement('canvas');cv3.id='cv3';cv3.width=1280;cv3.height=720;
 cv3.style.cssText='position:absolute;left:0;top:0;width:640px;height:360px;image-rendering:pixelated;display:none;pointer-events:none';
 const st=document.getElementById('stage');st.insertBefore(cv3,document.getElementById('cv'));
 R=new THREE.WebGLRenderer({canvas:cv3,antialias:false,alpha:false,preserveDrawingBuffer:true});R.setPixelRatio(1);R.setSize(1280,720,false);
 if('outputColorSpace' in R)R.outputColorSpace=THREE.SRGBColorSpace;else R.outputEncoding=THREE.sRGBEncoding;
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(50,16/9,0.3,400);
 root=new THREE.Group();scene.add(root);
 /* play art layer: the 2D canvas's field window laid on the grass */
 overCv=canvas(1280,Math.round(FH*2));overTex=canvasTex(overCv);
 overMesh=new THREE.Mesh(new THREE.PlaneGeometry(CW/PXY,53.33),new THREE.MeshBasicMaterial({map:overTex,transparent:true,depthWrite:false}));overMesh.rotation.x=-Math.PI/2;overMesh.renderOrder=2;root.add(overMesh);
 /* line of scrimmage and the yellow first-down line */
 const lineGeo=new THREE.PlaneGeometry(0.28,53.33);
 losMesh=new THREE.Mesh(lineGeo,new THREE.MeshBasicMaterial({color:0x3c78ff,transparent:true,opacity:.9,depthWrite:false}));losMesh.rotation.x=-Math.PI/2;losMesh.position.y=0.02;root.add(losMesh);
 fdMesh=new THREE.Mesh(lineGeo,new THREE.MeshBasicMaterial({color:0xffe600,transparent:true,opacity:.95,depthWrite:false}));fdMesh.rotation.x=-Math.PI/2;fdMesh.position.y=0.02;root.add(fdMesh);
 /* the ring under the player you control */
 ringMesh=new THREE.Mesh(new THREE.RingGeometry(0.7,0.95,24),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.9,depthWrite:false}));ringMesh.rotation.x=-Math.PI/2;ringMesh.position.y=0.03;root.add(ringMesh);
 ballSpr=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,alphaTest:0.4}));ballSpr.scale.set(0.95,0.5,1);root.add(ballSpr);
 V3.ready=true;}

/* ---------------- one frame ---------------- */
function spriteFor(i){let s=pool[i];if(!s){const m=new THREE.SpriteMaterial({transparent:true,alphaTest:0.35});s=new THREE.Sprite(m);s.center.set(0.5,2/36);root.add(s);
  const sh=new THREE.Mesh(new THREE.CircleGeometry(0.55,12),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.32,depthWrite:false}));sh.rotation.x=-Math.PI/2;sh.scale.set(1.3,0.8,1);sh.position.y=0.015;root.add(sh);s.userData.sh=sh;pool[i]=s;}
 return s;}
function texFor(c){let t=texOf.get(c);if(!t){t=canvasTex(c);texOf.set(c,t);}return t;}
const camRight=new THREE.Vector3(),tmp=new THREE.Vector3();
function frameCam(dt){
 /* behind your team before the snap; once someone has the ball, behind him the way he's going */
 const own=(M.def?-M.dir:M.dir),car=M.phase!=='pre'&&M.carrier?(M.carrier.side==='O'?M.dir:-M.dir):null,f=V3.f=car!=null?car:own;
 const holder=M.carrier||(M.phase==='live'&&M.play==='pass'&&!M.thrown?M.qb:null);let tx=M.los,tz=M.ballY,lead=0;
 const b=M.ball;
 if(M.phase==='live'){if(b&&b.F&&!b.done){const p=ballPos(b);tx=p.x;tz=p.y;}else if(holder){tx=holder.x;tz=holder.y;lead=1;}}
 if(M.phase==='dead'&&holder){tx=holder.x;tz=holder.y;}
 const inAir=M.phase==='live'&&b&&b.F&&!b.done,back=inAir?15:M.phase==='live'&&M.carrier?13:17,h=inAir?8.5:M.phase==='live'&&M.carrier?7:8.2;
 const want={x:tx-f*back,y:h,z:26.665+(tz-26.665)*0.75},look={x:tx+f*(14+lead*3),y:0,z:26.665+(tz-26.665)*0.85};
 const k=V3.cam?Math.min(1,dt*(M.phase==='live'?5:3.5)):1;
 if(!V3.cam){V3.cam=Object.assign({},want);V3.look=Object.assign({},look);}
 for(const a of['x','y','z']){V3.cam[a]+=(want[a]-V3.cam[a])*k;V3.look[a]+=(look[a]-V3.look[a])*k;}
 if(M.shake>0){V3.cam.x+=(Math.random()-.5)*M.shake*0.04;V3.cam.y+=(Math.random()-.5)*M.shake*0.03;}
 camera.position.set(V3.cam.x,V3.cam.y,V3.cam.z);camera.lookAt(V3.look.x,V3.look.y,V3.look.z);camera.updateMatrixWorld();
 camRight.setFromMatrixColumn(camera.matrixWorld,0);}

function draw3D(){
 const now=performance.now(),dt=Math.min(0.1,(now-(V3.lt||now))/1000);V3.lt=now;
 const tk=L.user+'|'+M.op+'|'+(M.night?1:0);if(tk!==lastTeams){lastTeams=tk;const home=M.home===false?M.op:L.user,away=home===L.user?M.op:L.user;buildStadium(home,away);V3.cam=null;}
 frameCam(dt);
 /* players */
 const all=[...M.O,...M.D],holder=curHolder();let i=0;
 const cf={x:V3.look.x-V3.cam.x,z:V3.look.z-V3.cam.z};{const n=Math.hypot(cf.x,cf.z)||1;cf.x/=n;cf.z/=n;}
 for(const f of all){const st=plState(f,holder),s=spriteFor(i++),o=st.o;
  /* which way is he facing, seen from the camera? */
  let fx=f.vx||0,fz=f.vy||0;const sp=Math.hypot(fx,fz);if(sp<1.2){fx=(f.side==='O'?M.dir:-M.dir);fz=0;}else{fx/=sp;fz/=sp;}
  const along=fx*cf.x+fz*cf.z,acr=fx*camRight.x+fz*camRight.z;
  const view=along>0.45?'back':along<-0.45?'front':'side',flip=view==='side'&&acr<0;
  const fr=o.run&&!o.dive?Math.floor((o.t||0)*9)%4:-1,num=f.pl&&f.pl.num!=null?f.pl.num:0;
  const c=spr3(st.lk,view,fr,{ball:o.ball,throw:o.throw,down:o.down||o.dive,glow:o.glow},num),t=texFor(c);if(s.material.map!==t){s.material.map=t;s.material.needsUpdate=true;}
  s.scale.set((flip?-1:1)*c.width*YPU*1.2,c.height*YPU*1.2,1);s.position.set(f.x,(st.jy||0)/14,f.y);s.visible=true;
  s.userData.sh.position.set(f.x,0.015,f.y);s.userData.sh.visible=true;}
 for(;i<pool.length;i++){pool[i].visible=false;pool[i].userData.sh.visible=false;}
 /* the ball in the air (carried balls are part of the runner's sprite) */
 let bp=null;if(M.ball){bp=ballPos(M.ball);}else if(M.predBall){const pb=M.predBall;bp=ballPos(pb);}else if(M.loose){bp={x:M.loose.x,y:M.loose.y,z:M.loose.z||0};}
 if(bp){const A=ballArt(curBall()),t=texFor(Math.floor(M.tt*14)%2?A.side:A.end);if(ballSpr.material.map!==t){ballSpr.material.map=t;ballSpr.material.needsUpdate=true;}
  ballSpr.position.set(bp.x,0.25+(bp.z||0)*0.7,bp.y);ballSpr.visible=true;}else ballSpr.visible=false;
 /* lines */
 const showL=(M.phase==='pre'||M.phase==='live'||M.phase==='dead')&&M.play!=='ret'&&M.O.length;
 losMesh.visible=!!showL;losMesh.position.x=M.los;losMesh.position.z=26.665;
 fdMesh.visible=!!(showL&&M.fdX<110&&!M.conv);fdMesh.position.x=M.fdX;fdMesh.position.z=26.665;
 /* ring under the player you're running */
 const ctl=M.def?(M.play==='intret'?M.carrier:M.ctl):M.carrier&&M.carrier.side==='O'?M.carrier:(M.phase==='pre'||(M.phase==='live'&&M.play==='pass'&&!M.thrown))?M.qb:null;
 ringMesh.visible=!!ctl;if(ctl){ringMesh.position.x=ctl.x;ringMesh.position.z=ctl.y;ringMesh.material.color.set(M.def?0xffe94a:0xffffff);}
 /* play art from the 2D code, copied off the flat canvas and laid on the grass */
 const og=overCv.getContext('2d');og.clearRect(0,0,overCv.width,overCv.height);
 og.drawImage(cv,0,FT*HIK,CW*HIK,FH*HIK,0,0,overCv.width,overCv.height);overTex.needsUpdate=true;
 overMesh.position.set(M.cam,0.025,26.665);overMesh.scale.x=M.dir<0?-1:1;
 R.render(scene,camera);}

/* ---------------- hooking the game ---------------- */
const draw2D=window.draw;
function active(){return V3.on&&V3.ready&&M&&UI.scr==='game'&&M.phase!=='kick'&&M.phase!=='replay';}
window.draw=function(){
 if(!active()){if(cv3)cv3.style.display='none';cv.style.background='';return draw2D();}
 cv3.style.display='block';
 hiRes();cx.imageSmoothingEnabled=false;LOGO_Q.length=0;HELM_Q.length=0;
 cx.setTransform(HIK,0,0,HIK,0,0);cx.clearRect(0,0,CW,CH);
 /* ground art first (copied into the 3D world)... */
 if(M.phase==='pre'&&!M.def)drawRoutes();
 if(M.phase==='pre'&&M.def&&!M.ov)drawDefArt();
 drawTarget();if(M.aim)drawAimSpot();if(M.aim)drawAimShadow();
 draw3D();
 /* ...then the flat canvas only keeps the things that live on the screen itself */
 cx.setTransform(HIK,0,0,HIK,0,0);cx.clearRect(0,0,CW,CH);
 if(M.aim){const ai=aimInfo(M.aim);if(ai.pull>=PASS.PULL_MIN){const q=M.qb;ctextScreen(ai.run?'RUN':ai.bullet?'BULLET':'LOB',ai.bullet?'#ffdf5b':'#fff');}}
 drawJoy();};
function ctextScreen(t,col){cx.save();cx.font='10px "Press Start 2P",monospace';cx.textAlign='center';cx.textBaseline='top';cx.fillStyle='#000';cx.fillText(t,CW/2+1,64+1);cx.fillStyle=col;cx.fillText(t,CW/2,64);cx.restore();}
/* the throw preview as dots on the grass (the 2D version draws them in the air for the side view) */
function drawAimShadow(){const a=M.aim;if(!a||!M.qb)return;const ai=aimInfo(a);if(ai.pull<PASS.PULL_MIN||ai.run)return;const F=ai.F,end=F.T*0.87,dtt=1.45/Math.max(8,F.v);
 for(let t=dtt;t<=end+1e-6;t+=dtt){const p=flightAt(F,t),px=wx(p.x),py=wy(p.y);rect(px-2,py-2,5,5,'#000');rect(px-1,py-1,3,3,ai.bullet?'#ffdf5b':'#fff');}}

/* taps: cast onto the grass and hand the game the spot in its own flat-view coordinates */
const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3(),nd=new THREE.Vector2();
const cpos2D=window.cpos;
window.cpos=function(e){const p=cpos2D(e);V3.raw={x:p.x,y:p.y};if(!active())return p;return toFlat(p.x,p.y);};
function toFlat(sx,sy){nd.set(sx/CW*2-1,-(sy/CH*2-1));ray.setFromCamera(nd,camera);
 let ok=ray.ray.intersectPlane(plane,hit);
 if(!ok||hit.distanceTo(camera.position)>90){const d=ray.ray.direction.clone();d.y=Math.min(d.y,-0.05);ray.ray.direction.copy(d.normalize());ok=ray.ray.intersectPlane(plane,hit);if(!ok)return{x:CW/2,y:CH/2};}
 const x=clamp(hit.x,-10,130),y=clamp(hit.z,-5,58);return{x:wx(x),y:wy(y)};}
const joyHit2D=window.joyHit;window.joyHit=function(p){return joyHit2D(active()?V3.raw:p);};
document.addEventListener('pointermove',e=>{if(!active())return;const r=cv.getBoundingClientRect();V3.raw={x:(e.clientX-r.left)*CW/r.width,y:(e.clientY-r.top)*CH/r.height};},true);
/* the stick: "up" on screen is up the field (away from the camera) */
window.joyVec=function(){if(!(ptr.down&&M.input==='joy'))return null;const P=active()?V3.raw:ptr;let dx=P.x-JOY.ox,dy=P.y-JOY.oy;let d=Math.hypot(dx,dy);
 if(IS_MOBILE&&d>JOY.r*1.35){const k=(d-JOY.r*1.35)/d;JOY.ox+=dx*k;JOY.oy+=dy*k;dx=P.x-JOY.ox;dy=P.y-JOY.oy;d=Math.hypot(dx,dy);}
 if(d<4)return{x:0,y:0,m:0};const m=Math.min(1,d/JOY.r);let ux=dx/d,uy=dy/d;
 if(active()){const f=V3.f,fx=-uy*f,fy=ux*f;ux=fx*M.dir;uy=fy;}   // screen -> field -> the flat view's stick
 return{x:ux,y:uy,m};};
/* arrow keys / WASD the same way: read the real keys, hand the game turned ones */
const KM2={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
addEventListener('keydown',e=>{const k=KM2[e.code];if(k)V3.KP[k]=true;},true);addEventListener('keyup',e=>{const k=KM2[e.code];if(k)V3.KP[k]=false;},true);
addEventListener('blur',()=>{V3.KP={};});
const step2D=window.step;
window.step=function(dt){if(active()&&M){const P=V3.KP,f=V3.f,c=f*M.dir;   /* c=1: camera faces where the offense goes */
  const fwd=!!P.up,bk=!!P.down,rt=!!P.right,lt=!!P.left;
  keys.right=c>0?fwd:bk;keys.left=c>0?bk:fwd;keys.down=f>0?rt:lt;keys.up=f>0?lt:rt;}
 return step2D(dt);};

/* a toggle on the pause menu and the title screen */
ACT.v3Toggle=()=>{V3.on=!V3.on;try{localStorage.setItem('rf_v3',V3.on?'1':'0');}catch(e){}toast(V3.on?'BROADCAST CAMERA ON':'CLASSIC CAMERA');if(UI.scr!=='game')render();};
init();
})();
