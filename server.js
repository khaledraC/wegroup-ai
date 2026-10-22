const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;const PORT=Number(process.env.PORT||3000);
const mime={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.css':'text/css','.js':'text/javascript'};
const limits=new Map();
const instruction=`أنت مساعد استقبال WE GROUP بإدارة خالد ريان في كابول. خدمات المكتب: التأمين العام، تأمين الحياة والصحة، المحاسبة والضرائب، العقارات في جورجيا ومنها مشروع ORIGAMI في باتومي، التمويل العقاري، القروض، وسحب أموال التقاعد. أجب بالعربية أو العبرية حسب العميل، بأسلوب مهني موجز. اسأل سؤال متابعة واحدًا في كل مرة، وحدد الخدمة المطلوبة واجمع الاسم وطريقة التواصل فقط إذا رغب العميل. لا تخترع أسعارًا أو عروضًا أو مشاريع أو موافقات أو ضمانات، ولا تطلب أرقام هوية أو بيانات طبية أو كلمات مرور أو حسابات بنكية. لا تقدم نصيحة ضريبية أو طبية أو تأمينية أو ائتمانية نهائية؛ أحلها لمختص. الرقم الحالي للمكتب 053-8206174. لا تدّع أنك متصل بواتساب أو حفظت بيانات العملاء أو أرسلت رسائل. وضح أنك مساعد آلي.`;
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
http.createServer(async(req,res)=>{
if(req.url==='/api/chat'&&req.method==='POST'){
const ip=req.socket.remoteAddress||'unknown',now=Date.now(),entry=limits.get(ip)||[];const recent=entry.filter(t=>now-t<60000);if(recent.length>=15)return send(res,429,{error:'عدد طلبات كبير. حاول بعد دقيقة.'});recent.push(now);limits.set(ip,recent);
let raw='';for await(const c of req){raw+=c;if(raw.length>18000)return send(res,413,{error:'الرسالة كبيرة جدًا'});}let body;try{body=JSON.parse(raw)}catch{return send(res,400,{error:'طلب غير صالح'})}
const message=typeof body.message==='string'?body.message.trim():'';if(!message||message.length>1000)return send(res,400,{error:'الرسالة يجب أن تكون أقل من 1000 حرف'});
if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'لم يتم تفعيل مفتاح API على الخادم بعد'});
const history=Array.isArray(body.history)?body.history.slice(-10).filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1000)})):[];
try{const upstream=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:[{role:'system',content:instruction},...history,{role:'user',content:message}],max_tokens:500,temperature:0.3})});const data=await upstream.json();if(!upstream.ok){console.error('AI upstream status',upstream.status);return send(res,502,{error:'خدمة الذكاء الاصطناعي غير متاحة الآن. راجع إعدادات المفتاح والفوترة.'})}return send(res,200,{reply:data.choices?.[0]?.message?.content||'يرجى التواصل مع المكتب.'})}catch(e){console.error(e);return send(res,502,{error:'تعذر الاتصال بخدمة AI'})}}
if(req.method!=='GET')return send(res,405,{error:'طريقة غير مدعومة'});
let target;try{target=decodeURIComponent((req.url||'/').split('?')[0])}catch{return send(res,400,{error:'عنوان غير صالح'})}
if(target==='/')target='/index.html';const file=path.resolve(root,'.'+target);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'غير موجود'});
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res)
}).listen(PORT,()=>console.log('WE GROUP AI at http://localhost:'+PORT));
