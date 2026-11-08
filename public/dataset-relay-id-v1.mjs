const encoder=new TextEncoder();

export async function relayIdForUrl(value){
  const url=String(value||"").trim();
  if(!url)return"";
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(url));
  const bytes=new Uint8Array(digest).slice(0,16);
  return"f_"+[...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
}
