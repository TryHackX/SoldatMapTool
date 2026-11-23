export function uint8ToBase64(bytes:Uint8Array) {
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return window.btoa(binary);
}
