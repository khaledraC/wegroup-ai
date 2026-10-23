'use strict';
// WE GROUP AI — website chat + Meta WhatsApp Cloud API webhook
// Node.js 18+; no extra npm packages required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const PORT = Number(process.env.PORT || 3000);
const mime = {'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
const limits = new Map();
const seen = new Map();
const chats = new Map();
const instruction = `أنت مساعد استقبال آلي لـ WE GROUP بإدارة خالد ريان في كابول. خدمات المكتب: التأمين العام، تأمين الحياة والصحة، المحاسبة والضرائب، العقارات في جورجيا ومنها مشروع ORIGAMI في باتومي، التمويل العقاري، القروض، وسحب أموال التقاعد. أجب بالعربية أو العبرية حسب العميل، بأسلوب مهني موجز. اسأل سؤال متابعة واحدًا في كل مرة، وحدد الخدمة المطلوبة واجمع الاسم وطريقة التواصل فقط إذا رغب العميل. لا تخترع أسعارًا أو عروضًا أو مشاريع أو موافقات أو ضمانات، ولا تطلب أرقام هوية أو بيانات طبية أو كلمات مرور أو حسابات بنكية. لا تقدم نصيحة ضريبية أو طبية أو تأمينية أو ائتمانية نهائية؛ أحلها لمختص. رقم التواصل العام للمكتب 053-8206174. وضح أنك مساعد آلي. لا تدّع أنك حفظت بيانات العملاء أو أرسلت رسائل ما لم يحدث ذلك بالفعل.`;
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function plain(res,status,data){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(data);}
async function readBody(req,max=65536){const parts=[];let len=0;for await(const chunk of req){len+=chunk.length;if(len>max)throw new Error('BODY_TOO_LARGE');parts.push(chunk);}return Buffer.concat(parts);}
async function answerAI(message,history=[]){
  if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY missing');
  const upstream=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},
    body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:[{role:'system',content:instruction},...history,{role:'user',content:message}],max_tokens:500,temperature:0.3}),
    signal:AbortSignal.timeout(25000)
  });
  if(!upstream.ok){console.error('OpenAI HTTP status:',upstream.status);throw new Error('AI unavailable');}
  const data=await upstream.json();return data.choices?.[0]?.message?.content?.trim()||'يرجى التواصل مع المكتب لمساعدتك.';
}
async function sendWhatsApp(to,text){
  const token=process.env.WHATSAPP_ACCESS_TOKEN, id=process.env.WHATSAPP_PHONE_NUMBER_ID;
  if(!token||!id)throw new Error('WhatsApp configuration missing');
  const version=process.env.WHATSAPP_GRAPH_VERSION||'v25.0';
  const response=await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(id)}/messages`,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{preview_url:false,body:text.slice(0,4096)}}),
    signal:AbortSignal.timeout(20000)
  });
  if(!response.ok){console.error('WhatsApp send HTTP status:',response.status);throw new Error('WhatsApp send failed');}
}
function validMetaSignature(raw,header){
  const secret=process.env.META_APP_SECRET;
  if(!secret||!header)return false;
  const expected='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');
  const a=Buffer.from(header,'utf8'),b=Buffer.from(expected,'utf8');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function handleWhatsApp(event){
  for(const entry of event.entry||[]){for(const change of entry.changes||[]){
    for(const msg of change.value?.messages||[]){
      if(msg.type!=='text'||!msg.text?.body||!msg.from||!msg.id)continue;
      if(seen.has(msg.id))continue;
      seen.set(msg.id,Date.now());
      const from=msg.from;
      const recent=chats.get(from)||[];
      try{
        const reply=await answerAI(msg.text.body.slice(0,1000),recent);
        await sendWhatsApp(from,reply);
        chats.set(from,[...recent,{role:'user',content:msg.text.body.slice(0,1000)},{role:'assistant',content:reply}].slice(-10));
      }catch(err){console.error('WhatsApp message processing:',err.message);}
    }
  }}
  // In-memory caches: reset on deploy/restart; use durable queue/storage for larger-scale production.
  const cutoff=Date.now()-24*60*60*1000;
  for(const [k,t] of seen){if(t<cutoff)seen.delete(k);}
  if(chats.size>1000)chats.clear();
}
http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  if(url.pathname==='/webhook'&&req.method==='GET'){
    const configured=process.env.WHATSAPP_VERIFY_TOKEN;
    if(configured&&url.searchParams.get('hub.mode')==='subscribe'&&url.searchParams.get('hub.verify_token')===configured){
      return plain(res,200,url.searchParams.get('hub.challenge')||'');
    }
    return plain(res,403,'Forbidden');
  }
  if(url.pathname==='/webhook'&&req.method==='POST'){
    let raw;try{raw=await readBody(req);}catch{return plain(res,413,'Too large');}
    if(!validMetaSignature(raw,req.headers['x-hub-signature-256']))return plain(res,401,'Invalid signature');
    let event;try{event=JSON.parse(raw.toString('utf8'));}catch{return plain(res,400,'Invalid JSON');}
    if(event.object!=='whatsapp_business_account')return plain(res,404,'Unknown event');
    plain(res,200,'EVENT_RECEIVED');
    void handleWhatsApp(event).catch(e=>console.error('Webhook error:',e.message));
    return;
  }
  if(url.pathname==='/api/chat'&&req.method==='POST'){
    const ip=req.socket.remoteAddress||'unknown',now=Date.now();
    const recent=(limits.get(ip)||[]).filter(t=>now-t<60000);
    if(recent.length>=15)return json(res,429,{error:'عدد طلبات كبير. حاول بعد دقيقة.'});
    recent.push(now);limits.set(ip,recent);
    let body;try{body=JSON.parse((await readBody(req,18000)).toString('utf8'));}catch{return json(res,400,{error:'طلب غير صالح أو كبير جدًا'});}
    const message=typeof body.message==='string'?body.message.trim():'';
    if(!message||message.length>1000)return json(res,400,{error:'الرسالة يجب ألا تتجاوز 1000 حرف'});
    if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'لم يتم تفعيل مفتاح API على الخادم بعد'});
    const history=Array.isArray(body.history)?body.history.slice(-10).filter(m=>['user','assistant'].includes(m?.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1000)})):[];
    try{return json(res,200,{reply:await answerAI(message,history)});}catch(e){console.error('Website AI:',e.message);return json(res,502,{error:'خدمة الذكاء الاصطناعي غير متاحة الآن.'});}
  }
  if(req.method!=='GET')return json(res,405,{error:'طريقة غير مدعومة'});
  let target;try{target=decodeURIComponent(url.pathname);}catch{return json(res,400,{error:'عنوان غير صالح'});}
  if(target==='/')target='/index.html';
  const file=path.resolve(root,'.'+target);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'غير موجود'});
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(file).pipe(res);
}).listen(PORT,()=>console.log('WE GROUP AI running on port '+PORT));
