import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DB = path.join(__dirname, "data.json");
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";
const TTL = Number(process.env.SESSION_TTL_HOURS || 24) * 3600_000;
const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY
  ? Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "base64")
  : crypto.randomBytes(32);

if (TOKEN_KEY.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");

function load(){ try{return JSON.parse(fs.readFileSync(DB,"utf8"));}catch{return {users:[],sessions:[],oauthStates:[],socialAccounts:[],leads:[]};}}
function save(db){ fs.writeFileSync(DB, JSON.stringify(db,null,2), {mode:0o600}); }
function id(){return crypto.randomUUID();}
function sha(v){return crypto.createHash("sha256").update(v).digest("hex");}
function rand(){return crypto.randomBytes(32).toString("base64url");}
function hashPassword(password,salt=crypto.randomBytes(16).toString("hex")){
  return `${salt}:${crypto.scryptSync(password,salt,64).toString("hex")}`;
}
function verifyPassword(password,stored){
  const [salt,key]=stored.split(":");
  const got=crypto.scryptSync(password,salt,64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(got,"hex"),Buffer.from(key,"hex"));
}
function encrypt(text){
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",TOKEN_KEY,iv);
  const data=Buffer.concat([cipher.update(text,"utf8"),cipher.final()]);
  return [iv,cipher.getAuthTag(),data].map(x=>x.toString("base64url")).join(".");
}
function decrypt(blob){
  const [ivS,tagS,dataS]=blob.split(".");
  const decipher=crypto.createDecipheriv("aes-256-gcm",TOKEN_KEY,Buffer.from(ivS,"base64url"));
  decipher.setAuthTag(Buffer.from(tagS,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataS,"base64url")),decipher.final()]).toString();
}
// TOTP (RFC 6238, SHA-1, 30 seconds)
function totp(secret, at=Date.now()){
  const key=Buffer.from(secret,"base32");
  const counter=Buffer.alloc(8); counter.writeBigInt64BE(BigInt(Math.floor(at/30000)));
  const h=crypto.createHmac("sha1",key).update(counter).digest();
  const o=h[19]&15, n=(h.readUInt32BE(o)&0x7fffffff)%1000000;
  return String(n).padStart(6,"0");
}
function base32Decode(s){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="", out=[];
  for(const c of s.replace(/=+$/,"").toUpperCase()){
    const v=alphabet.indexOf(c); if(v<0) continue;
    bits += v.toString(2).padStart(5,"0");
    while(bits.length>=8){out.push(parseInt(bits.slice(0,8),2)); bits=bits.slice(8);}
  }
  return Buffer.from(out);
}
function otpSecret(){return base32Decode(crypto.randomBytes(20).toString("base64").replace(/[^A-Z2-7]/gi,"").slice(0,32));}
function json(res,status,obj){res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer","content-security-policy":"default-src 'self'; frame-ancestors 'none'"});res.end(JSON.stringify(obj));}
function body(req){return new Promise((resolve,reject)=>{let b="";req.on("data",c=>{b+=c;if(b.length>1e6)req.destroy();});req.on("end",()=>{try{resolve(b?JSON.parse(b):{});}catch{reject(new Error("Invalid JSON"));}});});}
function cookies(req){return Object.fromEntries((req.headers.cookie||"").split(";").filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1))]}));}
function setSession(res,s){
  const secure=COOKIE_SECURE?"; Secure":"";
  res.setHeader("Set-Cookie",`session=${encodeURIComponent(s)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(TTL/1000)}${secure}`);
}
function auth(req,db){
  const s=cookies(req).session;if(!s)return null;
  const row=db.sessions.find(x=>x.hash===sha(s)&&x.expiresAt>Date.now()); if(!row)return null;
  return db.users.find(u=>u.id===row.userId)||null;
}
function redirect(res,url){res.writeHead(302,{Location:url, "cache-control":"no-store"});res.end();}

const rate=new Map();
function limited(req){
  const ip=req.socket.remoteAddress||"unknown", now=Date.now(), a=(rate.get(ip)||[]).filter(t=>now-t<60000);
  a.push(now);rate.set(ip,a);return a.length>60;
}

const server=http.createServer(async(req,res)=>{
  try{
    if(limited(req)) return json(res,429,{error:"Too many requests"});
    const db=load(); const u=new URL(req.url,`http://${req.headers.host}`);
    if(req.method==="GET" && u.pathname==="/health") return json(res,200,{ok:true,service:"fly-next-social-hub"});
    if(req.method==="GET" && u.pathname==="/api/me"){
      const user=auth(req,db); return json(res,200,{authenticated:!!user,user:user?{id:user.id,email:user.email,mfaEnabled:!!user.mfaEnabled}:null});
    }
    if(req.method==="POST" && u.pathname==="/api/register"){
      const b=await body(req);
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email||"") || (b.password||"").length<12) return json(res,400,{error:"Use a valid email and a password of at least 12 characters"});
      if(db.users.some(x=>x.email===b.email.toLowerCase())) return json(res,409,{error:"Account already exists"});
      const user={id:id(),email:b.email.toLowerCase(),passwordHash:hashPassword(b.password),mfaEnabled:false,createdAt:new Date().toISOString()};
      db.users.push(user);save(db);return json(res,201,{ok:true,userId:user.id});
    }
    if(req.method==="POST" && u.pathname==="/api/login"){
      const b=await body(req), user=db.users.find(x=>x.email===String(b.email||"").toLowerCase());
      if(!user || !verifyPassword(b.password||"",user.passwordHash)) return json(res,401,{error:"Invalid credentials"});
      if(user.mfaEnabled){
        if(!/^\d{6}$/.test(b.otp||"") || totp(user.mfaSecret)!==b.otp) return json(res,401,{error:"2-step verification required"});
      }
      const raw=rand();db.sessions.push({id:id(),userId:user.id,hash:sha(raw),expiresAt:Date.now()+TTL,createdAt:Date.now()});save(db);setSession(res,raw);
      return json(res,200,{ok:true,mfa:user.mfaEnabled});
    }
    if(req.method==="POST" && u.pathname==="/api/logout"){
      const s=cookies(req).session;if(s){db.sessions=db.sessions.filter(x=>x.hash!==sha(s));save(db);}
      res.setHeader("Set-Cookie","session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");return json(res,200,{ok:true});
    }
    if(req.method==="POST" && u.pathname==="/api/mfa/setup"){
      const user=auth(req,db);if(!user)return json(res,401,{error:"Login required"});
      if(user.mfaEnabled)return json(res,409,{error:"MFA already enabled"});
      const secret=otpSecret().toString("base32");user.pendingMfaSecret=secret;save(db);
      const issuer="Fly%20Next%20Social%20Hub";const label=encodeURIComponent(`Fly Next:${user.email}`);
      return json(res,200,{secret,otpauth:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`});
    }
    if(req.method==="POST" && u.pathname==="/api/mfa/enable"){
      const user=auth(req,db);if(!user)return json(res,401,{error:"Login required"});
      if(!user.pendingMfaSecret)return json(res,400,{error:"Run MFA setup first"});
      if(totp(user.pendingMfaSecret)!==String((await body(req)).otp||""))return json(res,400,{error:"Invalid code"});
      user.mfaSecret=user.pendingMfaSecret;delete user.pendingMfaSecret;user.mfaEnabled=true;save(db);return json(res,200,{ok:true});
    }
    if(req.method==="POST" && u.pathname==="/api/oauth/state"){
      const user=auth(req,db);if(!user)return json(res,401,{error:"Login required"});
      const b=await body(req);if(!["facebook","instagram","youtube","tiktok","whatsapp"].includes(b.provider))return json(res,400,{error:"Unsupported provider"});
      const state=rand();db.oauthStates.push({stateHash:sha(state),userId:user.id,provider:b.provider,expiresAt:Date.now()+10*60_000});save(db);
      // Provider-specific authorization URL is intentionally configured server-side later.
      return json(res,200,{state,provider:b.provider,message:"OAuth state created. Configure the provider credentials/redirect URI before enabling live authorization."});
    }
    if(req.method==="GET" && u.pathname==="/api/leads"){
      const user=auth(req,db);if(!user)return json(res,401,{error:"Login required"});
      return json(res,200,{leads:db.leads.filter(x=>x.ownerId===user.id).map(x=>({...x,customerData:undefined}))});
    }
    if(req.method==="POST" && u.pathname==="/api/leads"){
      const user=auth(req,db);if(!user)return json(res,401,{error:"Login required"});
      const b=await body(req);const lead={id:id(),ownerId:user.id,channel:b.channel||"manual",category:b.category||"Fresh Ticket",message:b.message||"",status:"new",createdAt:new Date().toISOString()};
      db.leads.push(lead);save(db);return json(res,201,{lead});
    }
    if(req.method==="GET"){
      const file=u.pathname==="/"?"index.html":u.pathname.slice(1);
      const safe=path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
      const full=path.join(__dirname,"public",safe);
      if(full.startsWith(path.join(__dirname,"public")) && fs.existsSync(full)){
        const ext=path.extname(full), types={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".png":"image/png",".svg":"image/svg+xml",".json":"application/json"};
        res.writeHead(200,{"content-type":types[ext]||"application/octet-stream","x-content-type-options":"nosniff"});return res.end(fs.readFileSync(full));
      }
    }
    json(res,404,{error:"Not found"});
  }catch(e){console.error(e);json(res,500,{error:"Internal server error"});}
});
server.listen(PORT,()=>console.log(`Fly Next Social Hub listening on ${PORT}`));
