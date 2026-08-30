/**
 * server/routes/qr.routes.js
 *
 * REF-1: QR-генератор вынесен из server/index.js без изменения поведения —
 * см. подробности в backup.routes.js (тот же рефакторинг, тот же повод).
 */
'use strict';

const express = require('express');
const logger  = require('../logger');

const router = express.Router();

// Используем npm qrcode если установлен (npm install), иначе самописный fallback
let _qrLib = null;
try {
  _qrLib = require('qrcode');
  logger.info('QR', 'using npm qrcode');
} catch(e) {
  logger.info('QR', 'npm qrcode not found, using built-in generator');
}

// Встроенный генератор (fallback) ─────────────────────────────────────────────
const _GF_EXP = new Uint8Array(512);
const _GF_LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for (let i = 0; i < 255; i++) {
    _GF_EXP[i] = x; _GF_LOG[x] = i;
    x <<= 1; if (x & 256) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) _GF_EXP[i] = _GF_EXP[i - 255];
})();
function _gfMul(a,b){ return (!a||!b)?0:_GF_EXP[(_GF_LOG[a]+_GF_LOG[b])%255]; }
function _rsGen(deg){ let r=new Uint8Array(deg+1); r[deg]=1; let root=1; for(let i=0;i<deg;i++){ for(let j=0;j<deg;j++) r[j]=_gfMul(r[j],root)^r[j+1]; r[deg]=_gfMul(r[deg],root); root=_gfMul(root,2); } return r; }
function _rsEncode(data,ecLen){ const gen=_rsGen(ecLen),res=new Uint8Array(data.length+ecLen); data.forEach((b,i)=>res[i]=b); for(let i=0;i<data.length;i++){ const c=res[i]; if(c) for(let j=0;j<gen.length;j++) res[i+j]^=_gfMul(gen[j],c); } return res.slice(data.length); }
function _utf8(str){ const b=[]; for(let i=0;i<str.length;i++){ const c=str.charCodeAt(i); if(c<0x80)b.push(c); else if(c<0x800){b.push(0xC0|(c>>6));b.push(0x80|(c&0x3F));} else{b.push(0xE0|(c>>12));b.push(0x80|((c>>6)&0x3F));b.push(0x80|(c&0x3F));} } return b; }

const _VER=[null,[16,10],[28,16],[44,26],[64,18],[86,24],[108,16],[124,18],[154,22],[182,22],[216,26]];
const _ALIGN=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const _FMT_MASK=0b101010000010010;

function _makeQRSvg(text) {
  const bytes = _utf8(text);
  let ver = 1;
  while (ver <= 10 && _VER[ver][0] < bytes.length + 3) ver++;
  if (ver > 10) throw new Error('Text too long');
  const [dataCap, ecLen] = _VER[ver];
  const size = ver * 4 + 17;
  const bits = [];
  const pb = (v,n) => { for(let i=n-1;i>=0;i--) bits.push((v>>i)&1); };
  pb(4,4); pb(bytes.length,8); bytes.forEach(b=>pb(b,8)); pb(0,4);
  while(bits.length%8) bits.push(0);
  const pads=[0xEC,0x11]; let pi=0;
  while(bits.length<dataCap*8){pb(pads[pi&1],8);pi++;}
  const data=new Uint8Array(dataCap);
  for(let i=0;i<dataCap;i++) for(let j=0;j<8;j++) data[i]|=bits[i*8+j]<<(7-j);
  const ec=_rsEncode(data,ecLen);
  const cw=[...data,...ec];
  const M=Array.from({length:size},()=>new Int8Array(size).fill(-1));
  const F=Array.from({length:size},()=>new Uint8Array(size));
  const sf=(r,c,v)=>{if(r>=0&&r<size&&c>=0&&c<size){M[r][c]=v;F[r][c]=1;}};
  const addFinder=(row,col)=>{for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){const v=(r>=0&&r<=6&&(r===0||r===6||c===0||c===6))||(r>=2&&r<=4&&c>=2&&c<=4)?1:0;sf(row+r,col+c,v);}};
  addFinder(0,0);addFinder(0,size-7);addFinder(size-7,0);
  for(let i=8;i<size-8;i++){sf(6,i,i%2?0:1);sf(i,6,i%2?0:1);}
  sf(4*ver+9,8,1);
  const ap=_ALIGN[ver];
  for(const ar of ap)for(const ac of ap){if(F[ar][ac])continue;for(let r=-2;r<=2;r++)for(let c=-2;c<=2;c++)sf(ar+r,ac+c,(Math.abs(r)===2||Math.abs(c)===2||(!r&&!c))?1:0);}
  const plFmt=(mi)=>{const d=(0b01<<3)|mi;let rem=d;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>9)*0x537);const fmt=((d<<10)|rem)^_FMT_MASK;const p=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];const p2=[[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];for(let i=0;i<15;i++){const b=(fmt>>(14-i))&1;sf(...p[i],b);sf(...p2[i],b);}};
  const MASKS=[(r,c)=>(r+c)%2===0,(r,c)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>(r*c)%2+(r*c)%3===0,(r,c)=>((r*c)%2+(r*c)%3)%2===0,(r,c)=>((r+c)%2+(r*c)%3)%2===0];
  const Fc=F.map(r=>new Uint8Array(r));
  let bestM=0,bestP=Infinity,bestMat=null;
  for(let mi=0;mi<8;mi++){
    const tryM=M.map(r=>new Int8Array(r));
    for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(!Fc[r][c])tryM[r][c]=-1;
    let bi=0;
    for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++){for(let dc=0;dc<2;dc++){const c=right-dc,r=((right+1)&2)?vert:size-1-vert;if(Fc[r][c])continue;const bit=bi<cw.length*8?(cw[bi>>3]>>(7-(bi&7)))&1:0;bi++;tryM[r][c]=bit^(MASKS[mi](r,c)?1:0);}}}
    let p=0;
    for(let r=0;r<size;r++){for(let run=0,c=0;c<size;c++){if(c>0&&tryM[r][c]===tryM[r][c-1]){run++;if(run===4)p+=3;else if(run>4)p++;}else run=0;}}
    for(let c=0;c<size;c++){for(let run=0,r=0;r<size;r++){if(r>0&&tryM[r][c]===tryM[r-1][c]){run++;if(run===4)p+=3;else if(run>4)p++;}else run=0;}}
    for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++)if(tryM[r][c]===tryM[r+1][c]&&tryM[r][c]===tryM[r][c+1]&&tryM[r][c]===tryM[r+1][c+1])p+=3;
    let dark=0;tryM.forEach(row=>row.forEach(v=>{if(v===1)dark++;}));
    p+=Math.abs(Math.round(dark/(size*size)*100/5)*5-50)/5*10;
    if(p<bestP){bestP=p;bestM=mi;bestMat=tryM;}
  }
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)M[r][c]=bestMat[r][c];
  plFmt(bestM);
  const quiet=4,cell=10,svgSz=(size+quiet*2)*cell;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgSz}" height="${svgSz}" viewBox="0 0 ${svgSz} ${svgSz}"><rect width="${svgSz}" height="${svgSz}" fill="white"/>`;
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(M[r][c]===1)svg+=`<rect x="${(c+quiet)*cell}" y="${(r+quiet)*cell}" width="${cell}" height="${cell}" fill="black"/>`;
  svg+='</svg>';
  return svg;
}
// ─── конец встроенного генератора ────────────────────────────────────────────

router.get('/', async (req, res) => {
  const text = (req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    if (_qrLib) {
      // npm qrcode — проверен, даёт корректные коды
      const svg = await _qrLib.toString(text, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }
    // Fallback — встроенный генератор
    const svg = _makeQRSvg(text);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
