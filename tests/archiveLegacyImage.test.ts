import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectArchiveBmp, inspectArchiveTga } from '../src/server/archiveLegacyImage';

function bmp(w:number,h:number,bits:number,encoding:number,colours:number,stream:number[],masks:number[]=[]){
  const start=54+4*(colours+masks.length),data=Buffer.alloc(start+stream.length);
  data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(start,10);data.writeUInt32LE(40,14);
  data.writeInt32LE(w,18);data.writeInt32LE(h,22);data.writeUInt16LE(1,26);data.writeUInt16LE(bits,28);
  data.writeUInt32LE(encoding,30);data.writeUInt32LE(stream.length,34);data.writeUInt32LE(colours,46);
  masks.forEach((v,i)=>data.writeUInt32LE(v,54+i*4));data.set(stream,start);return data;
}
test('BMP RLE8 validates encoded, absolute, delta, EOL and EOB commands within image and palette',()=>{
  const good=[2,1,0,2,1,0,2,0,0,0,0,5,0,1,0,1,0,0,0,1];
  assert.deepEqual(inspectArchiveBmp(bmp(5,2,8,1,2,good)),{ext:'.bmp',width:5,height:2});
  for(const bad of [good.slice(0,-2),[6,1,0,1],[4,9,0,1],[0,2,6,0,0,1],[0,5,0,1,0,1,2,0,0,1],[0,4,1,0]]){
    assert.equal(inspectArchiveBmp(bmp(5,2,8,1,2,bad)),null);
  }
  assert.equal(inspectArchiveBmp(bmp(5,-2,8,1,2,good)),null);
});
test('BMP RLE4 handles alternating nibbles including unused nibble and absolute word padding',()=>{
  const good=[3,0x12,0,5,0x12,0x21,0x1f,0,0,1];
  assert.deepEqual(inspectArchiveBmp(bmp(8,1,4,2,3,good)),{ext:'.bmp',width:8,height:1});
  assert.equal(inspectArchiveBmp(bmp(8,1,4,2,3,[3,0x1f,0,1])),null);
  assert.equal(inspectArchiveBmp(bmp(8,1,4,2,3,good.filter((_,i)=>i!==7))),null);
});
test('BMP validates palette bounds, planes, bitfield masks and full uncompressed padded rows without allocating pixels',()=>{
  assert.ok(inspectArchiveBmp(bmp(2,1,16,3,0,[0,0,0,0],[0xf800,0x07e0,0x1f])));
  assert.equal(inspectArchiveBmp(bmp(2,1,16,3,0,[0,0,0,0],[0xf000,0xf000,0x1f])),null);
  assert.equal(inspectArchiveBmp(bmp(2,1,16,3,0,[0,0,0,0],[0xf400,0x03e0,0x1f])),null);
  assert.equal(inspectArchiveBmp(bmp(1,1,24,0,0,[0,0,0])),null);
  assert.equal(inspectArchiveBmp(bmp(2,1,8,0,2,[0,2,0,0])),null);
  const badPlane=bmp(1,1,24,0,0,[0,0,0,0]);badPlane.writeUInt16LE(2,26);assert.equal(inspectArchiveBmp(badPlane),null);
  assert.equal(inspectArchiveBmp(bmp(32767,32767,24,0,0,[0,0,0,0])),null);
});
function tga(type:number,w:number,h:number,bits:number,data:number[],palette?:{first:number;length:number;depth:number}){
  const header=Buffer.alloc(18);header[2]=type;header.writeUInt16LE(w,12);header.writeUInt16LE(h,14);header[16]=bits;
  if(palette){header[1]=1;header.writeUInt16LE(palette.first,3);header.writeUInt16LE(palette.length,5);header[7]=palette.depth;}
  return Buffer.concat([header,Buffer.alloc(palette?palette.length*Math.ceil(palette.depth/8):0),Buffer.from(data)]);
}
test('TGA validates complete uncompressed and RLE rasters, palette offsets and actual indexed pixels',()=>{
  const p={first:3,length:2,depth:24};
  assert.deepEqual(inspectArchiveTga(tga(1,2,1,8,[3,4],p)),{ext:'.tga',width:2,height:1});
  assert.equal(inspectArchiveTga(tga(1,2,1,8,[3,2],p)),null);
  assert.ok(inspectArchiveTga(tga(9,4,1,16,[0x81,3,0,1,3,0,4,0],p)));
  assert.equal(inspectArchiveTga(tga(9,4,1,16,[0x81,3,0,1,3,0,5,0],p)),null);
  assert.ok(inspectArchiveTga(tga(10,2,2,24,[0x83,44,33,22])));
  assert.ok(inspectArchiveTga(tga(11,2,2,8,[1,20,40,0x81,100])));
  for(const d of [[0x83,44,33],[0x84,44,33,22],[1,0,0,0],[0x80,44,33,22]])assert.equal(inspectArchiveTga(tga(10,2,2,24,d)),null);
  assert.equal(inspectArchiveTga(tga(1,3,1,8,[0,0,0])),null);
  assert.equal(inspectArchiveTga(tga(2,2,2,24,[1,2,3])),null);
});
test('TGA 2 extension and footer cannot serve as the missing pixels of a truncated image',()=>{
  const footer=Buffer.alloc(26);footer.write('TRUEVISION-XFILE.\0',8,'latin1');
  assert.equal(inspectArchiveTga(Buffer.concat([tga(2,4,1,24,[0,0,0]),footer])),null);
  const full=tga(2,1,1,24,[0,0,0]),ext=Buffer.alloc(495);ext.writeUInt16LE(495);
  footer.writeUInt32LE(full.length,0);assert.ok(inspectArchiveTga(Buffer.concat([full,ext,footer])));
  footer.writeUInt32LE(18,0);assert.equal(inspectArchiveTga(Buffer.concat([full,ext,footer])),null);
});
