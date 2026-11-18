export const PHOTO_EXPORT_MAX=2048;
export const PHOTO_EXPORT_QUALITY=.82;
export function exportPhotoSize(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Photo dimensions unavailable');
 const scale=Math.min(1,PHOTO_EXPORT_MAX/Math.max(width,height));
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
// Decode and release one photo at a time. EXIF orientation is applied by Image.
export async function compressExportPhoto(original){
 const url=URL.createObjectURL(original),image=new Image();let canvas;
 try{
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Photo cannot be decoded'));image.src=url});
  const size=exportPhotoSize(image.naturalWidth,image.naturalHeight);
  canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
  const context=canvas.getContext('2d');if(!context)throw Error('Photo compression unavailable');
  context.fillStyle='#fff';context.fillRect(0,0,size.width,size.height);context.drawImage(image,0,0,size.width,size.height);
  const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(Error('Photo compression failed')),'image/jpeg',PHOTO_EXPORT_QUALITY));
  if(jpeg.type!=='image/jpeg')throw Error('JPEG export unavailable');
  return jpeg.size<original.size?{blob:jpeg,compressed:true,...size}:{blob:original,compressed:false};
 }finally{image.onload=image.onerror=null;image.src='';URL.revokeObjectURL(url);if(canvas){canvas.width=1;canvas.height=1}}
}

const encoder=new TextEncoder(),crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
export const exportYield=()=>new Promise(resolve=>setTimeout(resolve,0));
// ZIP stores the already-compressed JPEG/audio blobs directly. Read only 256 KB
// at a time for CRC, yielding so progress paints even on large inspections.
export async function exportZip(files,onProgress=()=>{}){
 if(files.length>65535)throw Error('Too many files for one export');
 const chunks=[],central=[],total=files.reduce((sum,file)=>sum+file.blob.size,0);let off=0,done=0;
 onProgress(0);
 for(const file of files){
  const name=encoder.encode(file.name),size=file.blob.size;let checksum=0xffffffff;
  if(name.length>65535||size>0xffffffff||off+size+30+name.length>0xffffffff)throw Error('Export exceeds ZIP size limit; split the inspection');
  for(let start=0;start<size;start+=262144){
   const part=new Uint8Array(await file.blob.slice(start,start+262144).arrayBuffer());
   for(const x of part)checksum=crcTable[(checksum^x)&255]^(checksum>>>8);
   done+=part.length;onProgress(total?done/total:0);await exportYield();
  }
  const sum=(checksum^0xffffffff)>>>0,h=new Uint8Array(30+name.length),v=new DataView(h.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,name.length,true);h.set(name,30);chunks.push(h,file.blob);
  const c=new Uint8Array(46+name.length),w=new DataView(c.buffer);
  w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,sum,true);w.setUint32(20,size,true);w.setUint32(24,size,true);w.setUint16(28,name.length,true);w.setUint32(42,off,true);c.set(name,46);central.push(c);off+=h.length+size;
 }
 const size=central.reduce((sum,bytes)=>sum+bytes.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
 if(off+size+22>0xffffffff)throw Error('Export exceeds ZIP size limit; split the inspection');
 v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,off,true);
 const result=new Blob([...chunks,...central,end],{type:'application/zip'});onProgress(1);return result;
}
