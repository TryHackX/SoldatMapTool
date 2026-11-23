type ImageInfo = {ext:string;width:number;height:number};
function dimensions(width:number,height:number){
  return width>0 && height>0 && width<=32767 && height<=32767 && width*height<=64*1024*1024;
}

// The display decoder intentionally supplies missing palette entries/pixels for preview.
// Archive validation instead walks every encoded command and requires complete input.
function checkBmpRle(data:Buffer,pos:number,end:number,width:number,height:number,bits:number,colours:number) {
  let x=0,y=0;
  const index=(byte:number,i:number)=>bits===8?byte:(i%2===0?byte>>>4:byte&15);
  while(pos+2<=end){
    const n=data[pos++],op=data[pos++];
    if(n){
      if(y>=height||x+n>width||index(op,0)>=colours||bits===4&&n>1&&index(op,1)>=colours)return false;
      x+=n;continue;
    }
    if(op===1)return true;
    if(y>=height)return false;
    if(op===0){x=0;y++;continue;}
    if(op===2){
      if(pos+2>end)return false;
      x+=data[pos++];y+=data[pos++];
      if(x>width||y>=height)return false;
      continue;
    }
    const payload=bits===8?op:Math.ceil(op/2),aligned=payload+(payload%2);
    if(pos+aligned>end || x+op>width)return false;
    if(colours<2**bits)for(let i=0;i<op;i++){
      if(index(data[pos+(bits===8?i:i>>1)],i)>=colours)return false;
    }
    x+=op;pos+=aligned;
  }
  return false; // A missing end-of-bitmap escape is not proof of a complete compressed image.
}

function validMasks(data:Buffer,offset:number,count:number,bits:number) {
  let occupied=0;
  for(let i=0;i<count;i++){
    const mask=data.readUInt32LE(offset+4*i);
    if(!mask||bits===16&&mask>65535||(occupied&mask)!==0)return false;
    const lowest=mask&-mask, normalized=mask/(lowest>>>0);
    if((normalized&(normalized+1))!==0)return false;
    occupied|=mask;
  }
  return true;
}

export function inspectArchiveBmp(data:Buffer):ImageInfo|null {
  if(data.length<26 || data[0]!==0x42 || data[1]!==0x4d)return null;
  const fileSize=data.readUInt32LE(2)||data.length,pixelsAt=data.readUInt32LE(10),dib=data.readUInt32LE(14);
  if(fileSize>data.length||![12,16,40,52,56,64,108,124].includes(dib)||14+dib>pixelsAt||pixelsAt>=fileSize)return null;
  const core=dib===12,os2=core||dib===16||dib===64;
  const width=core?data.readUInt16LE(18):data.readInt32LE(18),signedHeight=core?data.readUInt16LE(20):data.readInt32LE(22),height=Math.abs(signedHeight);
  const planes=data.readUInt16LE(core?22:26),bits=data.readUInt16LE(core?24:28);
  const encoding=dib>=40?data.readUInt32LE(30):0,encodedBytes=dib>=40?data.readUInt32LE(34):0;
  if(planes!==1||!dimensions(width,height)||![1,4,8,16,24,32].includes(bits))return null;
  if((os2||encoding===1||encoding===2)&&signedHeight<0)return null;
  if(![0,1,2,3,6].includes(encoding)||encoding===1&&bits!==8||encoding===2&&bits!==4)return null;
  let headerEnd=14+dib;
  if(encoding===3||encoding===6){
    if(os2||(bits!==16&&bits!==32))return null;
    const count=encoding===6?4:3;
    if(dib===40)headerEnd+=count*4;
    if(14+40+count*4>headerEnd||headerEnd>pixelsAt||!validMasks(data,54,count,bits))return null;
  }
  const declaredColours=dib>=40?data.readUInt32LE(46):0;
  const colours=declaredColours||(bits<=8?2**bits:0);
  if((bits<=8&&colours>2**bits)||headerEnd+colours*(core?3:4)>pixelsAt)return null;
  if(encodedBytes>fileSize-pixelsAt)return null;
  const end=encodedBytes?pixelsAt+encodedBytes:fileSize;
  if(encoding===1||encoding===2){
    if(!checkBmpRle(data,pixelsAt,end,width,height,bits,colours))return null;
  }else{
    const stride=Math.ceil(width*bits/32)*4;
    if(stride*height>end-pixelsAt)return null;
    if(bits<=8&&colours<2**bits){
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const b=data[pixelsAt+y*stride+Math.floor(x*bits/8)];
        if(((b>>>(8-bits-((x*bits)%8)))&((1<<bits)-1))>=colours)return null;
      }
    }
  }
  return {ext:'.bmp',width,height};
}

// Later TGA revisions append developer/extension data. A short pixel stream must never
// become "complete" by reading bytes from those tables or from the signature footer.
function tgaPixelEnd(data:Buffer,start:number,height:number) {
  if(data.length<26 || data.toString('latin1',data.length-18)!=='TRUEVISION-XFILE.\0')return data.length;
  const footer=data.length-26,extension=data.readUInt32LE(footer),directory=data.readUInt32LE(footer+4);
  let end=footer;
  function reserve(at:number,size:number){
    if(!at)return true;
    if(at<start||at+size>footer)return false;
    end=Math.min(end,at);return true;
  }
  if(extension){
    if(!reserve(extension,2))return -1;
    const size=data.readUInt16LE(extension);
    if(size<2||!reserve(extension,size))return -1;
    if(size>=495&&(!reserve(data.readUInt32LE(extension+482),2048)||
      !reserve(data.readUInt32LE(extension+486),2)||!reserve(data.readUInt32LE(extension+490),height*4)))return -1;
  }
  if(directory){
    if(!reserve(directory,2))return -1;
    const n=data.readUInt16LE(directory);
    if(!reserve(directory,2+n*10))return -1;
    for(let i=0;i<n;i++){
      const at=directory+2+i*10;
      if(!reserve(data.readUInt32LE(at+2),data.readUInt32LE(at+6)))return -1;
    }
  }
  return end;
}
export function inspectArchiveTga(data:Buffer):ImageInfo|null {
  if(data.length<18)return null;
  const type=data[2],kind=type&7,colourMap=data[1],bits=data[16],descriptor=data[17];
  const width=data.readUInt16LE(12),height=data.readUInt16LE(14);
  if(![1,2,3,9,10,11].includes(type)||colourMap>1||!dimensions(width,height)||(descriptor>>>6)===3)return null;
  const first=data.readUInt16LE(3),entries=data.readUInt16LE(5),colourBits=data[7],alpha=descriptor&15;
  if(alpha>8 || kind===1&&(!colourMap||![8,16].includes(bits)) ||
      kind===2&&![15,16,24,32].includes(bits) || kind===3&&![8,16].includes(bits))return null;
  if(kind===2&&(bits===15||bits===24)&&alpha!==0 || kind===3&&bits===8&&alpha!==0)return null;
  if(colourMap && (!entries||![15,16,24,32].includes(colourBits)||first+entries>65536))return null;
  const stride=Math.ceil(bits/8),count=width*height;
  let pos=18+data[0]+(colourMap?entries*Math.ceil(colourBits/8):0);
  const end=tgaPixelEnd(data,pos,height);
  if(pos>end)return null;
  const checkEntries=kind===1 && (first!==0||entries<2**bits);
  const indexFits=(at:number)=>{
    const index=bits===8?data[at]:data.readUInt16LE(at);
    return index>=first && index<first+entries;
  };
  if(type<8){
    if(pos+count*stride>end)return null;
    if(checkEntries)for(let i=0;i<count;i++)if(!indexFits(pos+i*stride))return null;
  }else{
    let remaining=count;
    while(remaining){
      if(pos>=end)return null;
      const command=data[pos++],run=(command&127)+1,stored=command&128?1:run;
      if(run>remaining||pos+stored*stride>end)return null;
      if(checkEntries)for(let i=0;i<stored;i++)if(!indexFits(pos+i*stride))return null;
      pos+=stored*stride;remaining-=run;
    }
  }
  return {ext:'.tga',width,height};
}
