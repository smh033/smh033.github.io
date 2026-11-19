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
   26x48 pixels with real proportions, team uniform colours only (skins are off in this mode), 4 running frames, carrying, throwing,
   and lying down. Each look is drawn once and cached. */
const S3=new Map();
const DIG=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001010010010','111101111101111','111101111001111'];
function shadeC(c,k){const n=parseInt(String(c).slice(1),16);if(isNaN(n))return c;let r=n>>16&255,g=n>>8&255,b=n&255;const f=x=>Math.max(0,Math.min(255,Math.round(k<0?x*(1+k):x+(255-x)*k)));return'#'+[f(r),f(g),f(b)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function spr3(lk,view,fr,fl,num){
 const key=[lk.helm,lk.stripe,lk.jersey,lk.trim,lk.pants,lk.socks,lk.mask||'',lk.skin,view,fr,fl.ball?1:0,fl.throw?1:0,fl.down?1:0,fl.glow?1:0,num].join('|');
 let out=S3.get(key);if(out)return out;
 if(fl.down)return spr3Down(lk,num,fl,key);
 /* athletic proportions: ~43 px tall, small helmet (~1/6 of the height), wide pads, long legs */
 const W=26,H=48,a=canvas(W,H),g=a.getContext('2d'),P=(x,y,w,h,c)=>{if(w>0&&h>0){g.fillStyle=c;g.fillRect(x,y,w,h);}};
 const tone=c=>[shadeC(c,0.22),c,shadeC(c,-0.22),shadeC(c,-0.4)];
 const J=tone(lk.jersey),Hm=tone(lk.helm),Pn=tone(lk.pants),So=tone(lk.socks),Sk=tone(lk.skin||'#c58c5c'),Tr=lk.trim,St=lk.stripe,Mk=lk.mask||'#bdbdbd',CL='#121218',CL2='#2a2a32',GL='#1e1e24',BALL='#7a3e14';
 /* a limb/part with light on the left, shadow on the right */
 const part=(x,y,w,h,T)=>{P(x,y,w,h,T[1]);if(w>2){P(x,y,1,h,T[0]);P(x+w-1,y,1,h,T[2]);}};
 const run=fr>=0,st=run?fr%4:-1,bob=(st===1||st===3)?-1:0;
 const digits=(cx0,y0,col,tall)=>{const n=String(Math.max(0,num|0)%100),w=n.length*4-1;let x=cx0-Math.floor(w/2);
  for(const ch of n){const d=DIG[+ch];for(let i=0;i<15;i++)if(d[i]==='1'){const r=i/3|0;P(x+i%3,y0+r+(tall&&r>1?1:0),1,tall&&r===1?2:1,col);}x+=4;}};
 if(view==='side'){ /* facing right */
  const y=bob,lf=st===0?5:st===2?-3:1,lb=-lf;   /* front/back leg stride */
  const leg=(dx,T,S,back)=>{const kx=12+Math.round(dx*0.5),fx=12+dx;
   part(kx-1,25+y,4,7,T);part(fx-1,32+y,3,8,S);P(fx-1,40+y,(back?4:5),2,back?CL2:CL);P(fx-1,40+y,1,1,'#fff');};
  leg(lb,[Pn[2],Pn[2],Pn[3],Pn[3]],[So[2],So[2],So[3],So[3]],true);
  /* back arm */
  const ab=st===0?-3:st===2?3:0;P(10+ab,13+y,3,6,J[2]);P(10+ab,19+y,3,4,Sk[2]);P(10+ab,23+y,3,1,GL);
  leg(lf,Pn,So,false);
  /* torso + pads */
  part(9,11+y,8,4,J);part(10,15+y,7,9,J);P(9,12+y,8,1,J[0]);P(15,13+y,2,1,Tr);P(10,23+y,7,1,Pn[2]);P(10,24+y,7,1,CL2);
  digits(13,15+y,Tr,true);
  /* helmet: small, with facemask out front */
  part(10,3+y,7,6,Hm);P(11,2+y,5,1,Hm[1]);P(11,3+y,2,2,Hm[0]);P(10,8+y,6,1,Hm[2]);P(12,2+y,1,7,St);
  P(16,5+y,2,3,Sk[1]);P(16,5+y,1,1,'#111');P(17,4+y,2,1,Mk);P(17,6+y,2,1,Mk);P(18,4+y,1,4,Mk);
  P(12,9+y,3,2,Sk[2]);
  /* front arm, ball, throw */
  if(fl.throw){part(13,1+y,3,11,J);P(13,0,3,2,Sk[1]);P(12,0,4,2,BALL);}
  else if(fl.ball){part(14,13+y,3,5,J);P(15,16+y,5,3,BALL);P(16,17+y,3,1,'#f4ead2');P(16,18+y,4,1,Sk[1]);}
  else{const af=-ab;part(13+af,13+y,3,5,J);P(13+af,18+y,3,4,Sk[1]);P(13+af,22+y,3,1,GL);}
 }else{ /* back = running away from the camera, front = towards it */
  const front=view==='front',y=bob,cx0=13;
  const lU=st===0?3:0,rU=st===2?3:0;   /* the stepping leg lifts */
  /* legs: thighs, knees, socks, cleats */
  part(8,25+y,5,7-Math.min(lU,2),Pn);part(13,25+y,5,7-Math.min(rU,2),Pn);P(8,25+y,1,6,Tr);P(17,25+y,1,6,Tr);P(12,25+y,2,2,Pn[2]);
  part(9,32+y-lU,3,8,So);part(14,32+y-rU,3,8,So);P(9,35+y-lU,3,1,Tr);P(14,35+y-rU,3,1,Tr);
  P(8,40+y-lU,5,2,CL);P(13,40+y-rU,5,2,CL);if(front){P(8,40+y-lU,1,1,'#fff');P(13,40+y-rU,1,1,'#fff');}
  /* arms swing against the legs */
  const aL=st===2?-2:st===0?2:0,aR=-aL;
  part(4,12+y,3,4,J);P(4,16+y+Math.max(0,aL),3,6,Sk[1]);P(4,16+y+Math.max(0,aL),1,6,Sk[0]);P(4,22+y+aL,3,1,GL);
  if(fl.throw){part(19,2+y,3,11,J);P(19,0,3,2,Sk[1]);P(18,0,5,2,BALL);}
  else if(fl.ball){part(19,12+y,3,4,J);P(15,15+y,6,3,BALL);P(16,16+y,4,1,'#f4ead2');P(19,16+y,3,3,Sk[1]);}
  else{part(19,12+y,3,4,J);P(19,16+y+Math.max(0,aR),3,6,Sk[1]);P(21,16+y+Math.max(0,aR),1,6,Sk[2]);P(19,22+y+aR,3,1,GL);}
  /* shoulder pads, jersey (tapers to the waist), belt */
  part(5,10+y,16,4,J);P(6,10+y,14,1,J[0]);P(5,11+y,2,2,Tr);P(19,11+y,2,2,Tr);
  part(7,14+y,12,6,J);part(8,20+y,10,4,J);P(8,23+y,10,1,J[2]);P(8,24+y,10,1,CL2);
  digits(cx0,14+y,Tr,true);
  /* small helmet */
  part(10,2+y,6,7,Hm);P(11,1+y,4,1,Hm[1]);P(10,3+y,2,2,Hm[0]);P(10,8+y,6,1,Hm[2]);
  if(front){P(11,4+y,4,4,Sk[1]);P(11,5+y,1,1,'#111');P(14,5+y,1,1,'#111');P(10,5+y,6,1,Mk);P(10,7+y,6,1,Mk);P(12,4+y,2,4,Mk);P(12,1+y,2,3,St);}
  else{P(12,1+y,2,8,St);}
  P(11,9+y,4,1,Sk[2]);
 }
 return finish3(a,W,H,fl,key);}
/* outline + cache */
function finish3(a,W,H,fl,key){
 const out=canvas(W,H),go=out.getContext('2d');
 const sil=col=>{const b=canvas(W,H),gb=b.getContext('2d');gb.drawImage(a,0,0);gb.globalCompositeOperation='source-in';gb.fillStyle=col;gb.fillRect(0,0,W,H);return b;};
 if(fl.glow){const yv=sil('#ffe600');for(const[dx,dy]of[[-2,0],[2,0],[0,-2],[0,2]])go.drawImage(yv,dx,dy);}
 const bk=sil('#0a0a12');for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]])go.drawImage(bk,dx,dy);go.drawImage(a,0,0);
 if(S3.size>4000)S3.clear();S3.set(key,out);return out;}
/* a tackled player flat on the turf, head to the right (mirrored when he went down the other way) */
function spr3Down(lk,num,fl,key){
 const W=40,H=48,a=canvas(W,H),g=a.getContext('2d'),P=(x,y,w,h,c)=>{if(w>0&&h>0){g.fillStyle=c;g.fillRect(x,y,w,h);}};
 const tone=c=>[shadeC(c,0.22),c,shadeC(c,-0.22),shadeC(c,-0.4)];
 const J=tone(lk.jersey),Hm=tone(lk.helm),Pn=tone(lk.pants),So=tone(lk.socks),Sk=tone(lk.skin||'#c58c5c'),Mk=lk.mask||'#bdbdbd';
 const y0=34;   /* lying on rows 34-41, the ground is row 42 */
 P(2,y0+3,3,3,'#121218');P(1,y0+5,4,2,'#121218');                    // cleats
 P(5,y0+2,6,4,So[1]);P(5,y0+2,6,1,So[0]);P(7,y0+2,1,4,lk.trim);         // socks
 P(11,y0+1,8,6,Pn[1]);P(11,y0+1,8,1,Pn[0]);P(11,y0+6,8,1,Pn[2]);P(11,y0+3,8,1,lk.trim);   // pants with stripe
 P(19,y0+1,2,6,'#2a2a32');                                             // belt
 P(21,y0,10,7,J[1]);P(21,y0,10,1,J[0]);P(21,y0+6,10,1,J[2]);P(28,y0-1,4,3,J[1]);   // jersey + pad
 {const n=String(Math.max(0,num|0)%100);let x=23;for(const ch of n){const d=DIG[+ch];for(let i=0;i<15;i++)if(d[i]==='1')P(x+i%3,y0+1+(i/3|0),1,1,lk.trim);x+=4;}}
 P(22,y0+7,7,2,Sk[1]);P(29,y0+7,2,2,'#1e1e24');                         // arm stretched along the turf
 P(32,y0-1,6,7,Hm[1]);P(33,y0-2,4,1,Hm[1]);P(32,y0-1,2,2,Hm[0]);P(32,y0+5,6,1,Hm[2]);P(34,y0-2,1,8,lk.stripe);  // helmet
 P(37,y0+1,2,4,Mk);P(38,y0+1,1,4,Mk);
 return finish3(a,W,H,fl,key);}


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
function spriteFor(i){let s=pool[i];if(!s){const m=new THREE.SpriteMaterial({transparent:true,alphaTest:0.35});s=new THREE.Sprite(m);s.center.set(0.5,6/48);root.add(s);
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
  /* before/after the play everyone faces the other team; during it, the way he's running */
  let fx=M.phase==='live'?f.vx||0:0,fz=M.phase==='live'?f.vy||0:0;const sp=Math.hypot(fx,fz);if(sp<1.2){fx=(f.side==='O'?M.dir:-M.dir);fz=0;}else{fx/=sp;fz/=sp;}
  const along=fx*cf.x+fz*cf.z,acr=fx*camRight.x+fz*camRight.z;
  const isDown=!!(o.down||o.dive);if(isDown&&f.dn3==null)f.dn3=acr<0?-1:1;if(!isDown)f.dn3=null;
  const view=along>0.45?'back':along<-0.45?'front':'side',flip=isDown?f.dn3<0:view==='side'&&acr<0;
  const fr=o.run&&!o.dive?Math.floor((o.t||0)*9)%4:-1,num=f.pl&&f.pl.num!=null?f.pl.num:0;
  const c=spr3(st.lk,view,fr,{ball:o.ball,throw:o.throw,down:o.down||o.dive,glow:false},num),t=texFor(c);if(s.material.map!==t){s.material.map=t;s.material.needsUpdate=true;}
  s.scale.set((flip?-1:1)*c.width*0.052,c.height*0.052,1);s.position.set(f.x,(st.jy||0)/14,f.y);s.visible=true;
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


/* ---------------- kicks in 3D ----------------
   Same kick as the classic view (k.d yards from the hold to the posts, the ball's path from k.hAt / drift),
   but seen from behind the holder like a TV kick camera, with both lines set up at the line of scrimmage. */
function lineup(list){let i=0;for(const it of list){const s=spriteFor(i++),c=it.c,t=texFor(c);if(s.material.map!==t){s.material.map=t;s.material.needsUpdate=true;}
  s.scale.set((it.flip?-1:1)*c.width*0.052,c.height*0.052,1);s.position.set(it.x,it.h||0,it.z);s.visible=true;s.userData.sh.position.set(it.x,0.015,it.z);s.userData.sh.visible=true;}
 for(;i<pool.length;i++){pool[i].visible=false;pool[i].userData.sh.visible=false;}}
function kickWorld(){const k=M.kick,d=M.dir,goal=d>0?120:0,bx=goal-d*k.d;return{k,d,goal,bx,los:bx+d*7};}
function draw3DKick(){
 const now=performance.now(),dt=Math.min(0.1,(now-(V3.lt||now))/1000);V3.lt=now;
 const tk=L.user+'|'+M.op+'|'+(M.night?1:0);if(tk!==lastTeams){lastTeams=tk;buildStadium(L.user,M.op);}
 const W=kickWorld(),k=W.k,d=W.d,mid=26.665;
 const own=netHost()?!k.guest:netGuest()?!!k.mine:true,kt=own?L.user:M.op,ku=own?M.uU:M.uO,dt2=own?M.op:L.user,du=own?M.uO:M.uU;
 const lkK=lookFor(k.K,kt,ku),lkH=lookFor(((own?M.dep:M.odep)||M.dep).QB[0],kt,ku),lkO=lookFor(null,kt,ku),lkD=lookFor(null,dt2,du);
 const fly=k.st==='fly',ft=fly?k.t:0,rush=Math.min(1.6,ft*2.2);
 const L1=[];
 for(let i=-4;i<=4;i++){const t=Math.abs(i);L1.push({c:spr3(lkO,'back',-1,{},50+t*7%40),x:W.los-d*0.6-d*(t>=4?0.6:0),z:mid+i*1.05});}
 for(let i=-4;i<=4;i++){if(i===0)continue;const c=spr3(lkD,'front',fly?Math.floor(ft*9)%4:-1,{},90+i);L1.push({c,x:W.los+d*(0.8-rush*(Math.abs(i)<3?0.4:0.9)),z:mid+i*1.1+Math.sign(i)*rush*0.4});}
 L1.push({c:spr3(lkD,'front',-1,{},40),x:W.los+d*3.2,z:mid-2});L1.push({c:spr3(lkD,'front',-1,{},41),x:W.los+d*3.2,z:mid+2});
 /* holder kneeling (a short sprite: the lying pose would read wrong) and the kicker */
 L1.push({c:spr3Down(lkH,(k.K&&0)||12,{},'hold|'+lkH.key),x:W.bx-d*0.4,z:mid+0.9,flip:d<0});
 const kr=fly?Math.min(1,k.t/0.25):0;L1.push({c:spr3(lkK,'back',fly&&k.t<0.25?Math.floor(k.t*30)%4:-1,{},3),x:W.bx-d*(2.6-kr*2.2),z:mid-1.4+kr*1.2});
 lineup(L1);
 /* ball: on the tee/hold, then in flight */
 let bp=null;
 if(k.st==='aim')bp={x:W.bx,y:0.3,z:mid};
 else if(fly){const u=clamp(k.t/1.4,0,1),z=u*k.zEnd,rz=z/k.d,lat=(k.latG-k.drift)*rz+k.drift*rz*rz;let h=k.hAt(z);if(k.t>1.4)h=Math.max(0,h-(k.t-1.4)*9);bp={x:W.bx+d*z,y:Math.max(0.2,h),z:mid+lat*d};}
 if(bp){const A=ballArt(curBall()),t=texFor(Math.floor(performance.now()/60)%2?A.side:A.end);if(ballSpr.material.map!==t){ballSpr.material.map=t;ballSpr.material.needsUpdate=true;}ballSpr.position.set(bp.x,bp.y,bp.z);ballSpr.visible=true;}else ballSpr.visible=false;
 losMesh.visible=false;fdMesh.visible=false;ringMesh.visible=false;overMesh.visible=false;
 /* camera: low behind the holder; follows the ball up once it's kicked */
 const want={x:W.bx-d*(fly?13-Math.min(6,k.t*5):13.5),y:fly?3.6+Math.min(3,k.t*2):3.4,z:mid+1.2},look={x:W.goal,y:fly&&bp?Math.min(6,bp.y*0.6+2):4.2,z:mid};
 if(!V3.kcam||V3.kcam.id!==k){V3.kcam={id:k,c:Object.assign({},want),l:Object.assign({},look)};}
 const K=Math.min(1,dt*4);for(const a of['x','y','z']){V3.kcam.c[a]+=(want[a]-V3.kcam.c[a])*K;V3.kcam.l[a]+=(look[a]-V3.kcam.l[a])*K;}
 camera.position.set(V3.kcam.c.x,V3.kcam.c.y,V3.kcam.c.z);camera.lookAt(V3.kcam.l.x,V3.kcam.l.y,V3.kcam.l.z);camera.updateMatrixWorld();camRight.setFromMatrixColumn(camera.matrixWorld,0);
 V3.cam=null;R.render(scene,camera);overMesh.visible=true;
 return {W,own};}
/* the kick screen's controls (power bar, swipe line, aim line), on the flat canvas over the 3D view */
function proj(x,y,z){tmp.set(x,y,z).project(camera);return{x:(tmp.x+1)/2*CW,y:(1-tmp.y)/2*CH};}
function kickUI(info){const k=M.kick,own=info.own,W=info.W;
 const kt=own?L.user:M.op;
 if(k.st==='aim'&&!own&&(netHost()||netGuest())){const dots='.'.repeat(1+Math.floor(performance.now()/400)%3),bx=CW/2-120;rect(bx,138,240,34,'rgba(0,0,20,.72)');
  ctext(abbr(kt)+' IS LINING UP THE KICK'+dots,CW/2,149,'#ffe94a','center',8);}
 /* broadcast tag top-left: SPECIAL TEAMS / EXTRA POINT, wind */
 rect(8,58,150,12,'#1d9a3a');ctext('SPECIAL TEAMS',12,61,'#fff','left',6);rect(8,70,180,16,'rgba(8,10,18,.88)');ctext(k.kind==='xp'?'EXTRA POINT':k.d+' YARD FIELD GOAL',14,75,'#fff','left',8);
 {const p=proj(W.goal,10.3,26.665);rect(p.x-34,p.y-22,68,14,'rgba(8,10,18,.85)');const dir=M.wind>0?'→':M.wind<0?'←':'';ctext((dir?dir+' ':'')+Math.abs(M.wind)+' MPH',p.x,p.y-18,'#fff','center',6);}
 const sw=k.sw;
 if(k.st==='aim'&&own){
  ctext(IS_MOBILE?'SWIPE UP TO KICK':'DRAG UP AND RELEASE TO KICK',CW/2,CH-84,'#fff');
  /* horizontal broadcast-style power meter under the kicker */
  const need=kickNeed(),mx=CW/2-110,my=CH-64,mw=220;rect(mx-2,my-2,mw+4,16,'#000');rect(mx,my,mw,12,'#1c2a5e');
  const tX=v=>mx+clamp(v/1.4,0,1)*mw;rect(tX(1.05),my,tX(1.4)-tX(1.05),12,'rgba(229,72,77,.75)');
  ctext('POWER',mx-6,my+3,'#ffe94a','right',6);
  if(sw){const dx=sw.cx-sw.sx,dy=sw.cy-sw.sy,len=Math.hypot(dx,dy),pw=dy<0?clamp(len/170,0,1.4):0;rect(mx,my,tX(pw)-mx,12,pw>1.05?'#ff5c5c':pw>=need?'#38d27a':'#ffe94a');
   cx.save();cx.setLineDash([4,4]);cx.strokeStyle='rgba(255,255,255,.7)';cx.lineWidth=2;cx.beginPath();cx.moveTo(sw.sx,sw.sy);cx.lineTo(sw.cx,sw.cy);cx.stroke();cx.restore();
   if(dy<-10){const ang=clamp(Math.atan2(dx,-dy)*0.75,-0.45,0.45),a=proj(W.bx,0.3,26.665),b=proj(W.goal,5,26.665+k.d*Math.tan(ang)*W.d);cx.save();cx.setLineDash([2,5]);cx.strokeStyle='rgba(255,233,74,.95)';cx.lineWidth=2;cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();cx.restore();}}
  rect(tX(need)-1,my-4,3,20,'#fff');
 }}

/* ---------------- replays in 3D: a slow orbiting camera around the play ---------------- */
function draw3DReplay(){
 const now=performance.now(),dt=Math.min(0.1,(now-(V3.lt||now))/1000);V3.lt=now;
 const Rc=M.rec,ft=clamp(M.rp.t*30,0,Rc.f.length-1),i=Math.floor(ft),u=ft-i,f0=Rc.f[i],f1=Rc.f[Math.min(i+1,Rc.f.length-1)],mix=(a,b)=>a+(b-a)*u;
 const same=f0.ps.length===f1.ps.length,list=[];let cxs=0,czs=0;
 for(let k=0;k<f0.ps.length;k++){const a=f0.ps[k],b=same?f1.ps[k]:a,x=mix(a.x,b.x),y=mix(a.y,b.y),o=u<0.5?a.o:b.o,lk=a.lk;
  const vx=(b.x-a.x)*30,vy=(b.y-a.y)*30;list.push({x,y,vx,vy,o,lk,jy:mix(a.jy,b.jy),side:a.side});}
 const bl=(a,b)=>a&&b?{x:mix(a.x,b.x),y:mix(a.y,b.y),z:mix(a.z,b.z)}:a,bp=bl(f0.b,f1.b)||bl(f0.lo,f1.lo);
 /* follow the ball (or the middle of the action) and slowly circle it */
 let tx,tz;if(bp){tx=bp.x;tz=bp.y;}else{for(const p of list){cxs+=p.x;czs+=p.y;}tx=cxs/Math.max(1,list.length);tz=czs/Math.max(1,list.length);}
 if(!V3.rp||V3.rp.id!==Rc){V3.rp={id:Rc,tx,tz,a:Math.random()*Math.PI*2};}
 V3.rp.tx+=(tx-V3.rp.tx)*Math.min(1,dt*3);V3.rp.tz+=(tz-V3.rp.tz)*Math.min(1,dt*3);V3.rp.a+=dt*0.25;
 const rad=11,cp={x:V3.rp.tx+Math.cos(V3.rp.a)*rad,y:4.2,z:V3.rp.tz+Math.sin(V3.rp.a)*rad};
 camera.position.set(cp.x,cp.y,cp.z);camera.lookAt(V3.rp.tx,1,V3.rp.tz);camera.updateMatrixWorld();camRight.setFromMatrixColumn(camera.matrixWorld,0);
 const cf={x:V3.rp.tx-cp.x,z:V3.rp.tz-cp.z};{const n=Math.hypot(cf.x,cf.z)||1;cf.x/=n;cf.z/=n;}
 const items=list.map(p=>{let fx=p.vx,fz=p.vy;const sp=Math.hypot(fx,fz);if(sp<1.2){fx=(p.o&&p.o.face)||1;fz=0;}else{fx/=sp;fz/=sp;}
  const along=fx*cf.x+fz*cf.z,acr=fx*camRight.x+fz*camRight.z,dn=!!(p.o&&(p.o.down||p.o.dive));
  const view=along>0.45?'back':along<-0.45?'front':'side',fr=p.o&&p.o.run&&!p.o.dive?Math.floor((p.o.t||0)*9)%4:-1;
  const c=spr3(p.lk,view,fr,{ball:p.o&&p.o.ball,throw:p.o&&p.o.throw,down:dn},0);return{c,x:p.x,z:p.y,h:(p.jy||0)/14,flip:dn?acr<0:view==='side'&&acr<0};});
 lineup(items);
 if(bp){const A=ballArt(curBall()),t=texFor(Math.floor(M.rp.t*14)%2?A.side:A.end);if(ballSpr.material.map!==t){ballSpr.material.map=t;ballSpr.material.needsUpdate=true;}ballSpr.position.set(bp.x,0.25+(bp.z||0)*0.7,bp.y);ballSpr.visible=true;}else ballSpr.visible=false;
 losMesh.visible=false;fdMesh.visible=false;ringMesh.visible=false;overMesh.visible=false;
 R.render(scene,camera);overMesh.visible=true;V3.cam=null;}
function replayUI(){const by=58;rect(0,by,CW,24,'rgba(0,0,0,.82)');
 if(Math.floor(M.tt*2)%2===0){cx.fillStyle='#e8423a';cx.beginPath();cx.arc(14,by+12,5,0,Math.PI*2);cx.fill();}
 ctext('REPLAY',24,by+7,'#fff','left',10);ctext(M.rp.lab||'',CW/2,by+7,'#ffe94a','center',10);ctext(M.rp.fast?'FAST FORWARD >>':'TAP TO SPEED UP',CW-112,by+8,'#b7c8ff','right',7);}

/* ---------------- broadcast scoreboard along the bottom ---------------- */
function scoreboard(){let el=document.getElementById('v3sb');
 if(!el){el=document.createElement('div');el.id='v3sb';document.getElementById('stage').appendChild(el);
  const css=document.createElement('style');css.textContent=`
  body.v3on #gtop{display:none!important}
  #v3sb{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:40;pointer-events:none;display:none;font-family:"Press Start 2P",monospace;filter:drop-shadow(0 3px 0 rgba(0,0,0,.6))}
  body.v3on #v3sb{display:block}
  #v3sb .tab{position:absolute;left:50%;transform:translateX(-50%);top:100%;background:linear-gradient(#ffd23a,#e8a812);color:#111;font-size:6px;padding:3px 10px 2px;white-space:nowrap;clip-path:polygon(0 0,100% 0,calc(100% - 6px) 100%,6px 100%)}
  #v3sb .row{display:flex;align-items:stretch;height:26px;border:1px solid rgba(255,255,255,.35);background:#0d1120}
  #v3sb .tm{display:flex;align-items:center;gap:6px;padding:0 8px;min-width:96px;position:relative}
  #v3sb .tm .ab{font-size:8px;color:#fff}
  #v3sb .tm .to{position:absolute;left:8px;right:8px;bottom:3px;display:flex;gap:2px}#v3sb .tm .to i{flex:1;height:2px;background:rgba(255,255,255,.25)}#v3sb .tm .to i.on{background:#ffd23a}
  #v3sb .tm .po{width:6px;height:4px;background:#8a4818;border:1px solid #000;border-radius:3px}
  #v3sb .sc{font-size:12px;color:#ffd23a;min-width:34px;text-align:center;display:flex;align-items:center;justify-content:center;background:#151a2c}
  #v3sb .mid{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 10px;background:#0a0d18;color:#fff;border-left:1px solid rgba(255,255,255,.15);border-right:1px solid rgba(255,255,255,.15)}
  #v3sb .mid span{font-size:5px;color:#9fb0d8}#v3sb .mid b{font-size:9px}`;document.head.appendChild(css);}
 const q=M.qtr<=4?['1ST','2ND','3RD','4TH'][M.qtr-1]:M.qtr===5?'OT':(M.qtr-4)+'OT';
 const offense=!(M.ov&&M.ov.type==='drive'),ours=offense&&!M.def&&M.play!=='kickoff';
 const dn=M.phase==='kick'&&M.kick?(M.kick.kind==='xp'?'EXTRA POINT':'FIELD GOAL')+' · '+abbr(M.dir===M.udir?L.user:M.op):(M.phase==='pre'||M.phase==='live'||M.phase==='dead')&&M.play!=='ret'?String(downTxt()).toUpperCase():'';
 const tm=(t,sc,to,has,right)=>{const c=teamCol(t);const pips=`<span class="to">${[0,1,2].map(i=>`<i class="${i<to?'on':''}"></i>`).join('')}</span>`;
  const blk=`<div class="tm" style="background:linear-gradient(${right?'270deg':'90deg'},${c.c1},${shadeC(c.c1,-0.35)})">${has&&right?'<i class="po"></i>':''}<span class="ab" style="color:${txtCol(c.c1,c.c2)}">${esc(abbr(t))}</span>${has&&!right?'<i class="po"></i>':''}${pips}</div>`;
  const s=`<div class="sc">${sc}</div>`;return right?s+blk:blk+s;};
 const html=`${dn?`<div class="tab">${esc(dn)}</div>`:''}<div class="row">${tm(L.user,M.sc[0],M.to,ours,false)}<div class="mid"><span>${q}</span><b>${clockTxt()}</b></div>${tm(M.op,M.sc[1],M.oto==null?3:M.oto,!ours&&offense,true)}</div>`;
 if(el._h!==html){el.innerHTML=html;el._h=html;}}

/* ---------------- hooking the game ---------------- */
const draw2D=window.draw;
function active(){return V3.on&&V3.ready&&M&&UI.scr==='game'&&!M.prac&&!(M.phase==='kick'&&!M.kick)&&!(M.phase==='replay'&&!M.rec);}
window.draw=function(){
 if(!active()){if(cv3)cv3.style.display='none';document.body.classList.remove('v3on');return draw2D();}
 cv3.style.display='block';document.body.classList.add('v3on');scoreboard();
 hiRes();cx.imageSmoothingEnabled=false;LOGO_Q.length=0;HELM_Q.length=0;
 cx.setTransform(HIK,0,0,HIK,0,0);cx.clearRect(0,0,CW,CH);
 if(M.phase==='kick'){const info=draw3DKick();kickUI(info);return;}
 if(M.phase==='replay'){draw3DReplay();replayUI();return;}
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
window.cpos=function(e){const p=cpos2D(e);V3.raw={x:p.x,y:p.y};if(!active()||M.phase==='kick'||M.phase==='replay')return p;return toFlat(p.x,p.y);};
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
