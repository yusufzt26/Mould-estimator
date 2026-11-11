/* Netlify backend for the Mould Estimator: gives the app the same window.claude.use('db'|'user'|'downloads'|'sample')
   it uses inside claude.ai, backed by /api (Netlify Functions + Blobs). Other people's changes arrive by polling every 8 s. */
(function(){
  const TK='mould.token';let token=null,me=null,owner=false,ready;
  const authed=new Promise(r=>ready=r);
  const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
  const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  async function api(path,body,method){
    const r=await fetch('/api/'+path,{method:method||(body?'POST':'GET'),headers:Object.assign({'content-type':'application/json'},token?{authorization:'Bearer '+token}:{}),body:body?JSON.stringify(body):undefined});
    const j=await r.json().catch(()=>({}));
    if(r.status===401&&token&&path!=='login'){signOut();}
    if(!r.ok){const e=new Error(j.error||('Error '+r.status));e.status=r.status;e.code=j.code;throw e}
    return j}

  /* ---------- sign-in screen ---------- */
  const css=`#authBox{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg,#f4f2ee);font:15px system-ui,sans-serif;padding:16px}
  #authBox form{width:100%;max-width:360px;background:var(--surface,#fff);color:var(--ink,#222);border:1px solid var(--line,#ddd);border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:12px}
  #authBox h1{margin:0 0 4px;font-size:20px}#authBox p{margin:0;color:var(--muted,#666);font-size:13.5px}
  #authBox input{font:inherit;padding:10px 12px;border:1px solid var(--line,#ccc);border-radius:8px;background:transparent;color:inherit}
  #authBox button{font:inherit;padding:10px 12px;border-radius:8px;border:0;background:var(--accent,#c4581b);color:#fff;cursor:pointer}
  #authBox .lnk{background:none;color:var(--accent,#c4581b);padding:0;text-align:left}#authBox .err{color:#b3261e}`;
  function loginScreen(){
    if(!document.getElementById('authCss')){const st=document.createElement('style');st.id='authCss';st.textContent=css;document.head.appendChild(st)}
    let box=document.getElementById('authBox');if(!box){box=document.createElement('div');box.id='authBox';document.body.appendChild(box)}
    const setup=box.dataset.mode==='setup';
    box.innerHTML=`<form><h1>Mould Estimator</h1><p>${setup?'Owner only: create the first login. Everyone else is added by an admin in Masters → Users &amp; rights.':'Sign in with the email and password your admin gave you.'}</p>
      ${setup?'<input name="name" placeholder="Your name" autocomplete="name">':''}
      <input name="email" type="email" placeholder="Email" autocomplete="email" required>
      <input name="pw" type="password" placeholder="Password (8+ characters)" minlength="8" autocomplete="${setup?'new-password':'current-password'}" required>
      <button type="submit">${setup?'Create owner login':'Sign in'}</button><p class="msg"></p>
      <button type="button" class="lnk">${setup?'Back to sign in':'First time? Owner setup'}</button>
      ${setup?'':'<p>Forgot your password? Ask your admin to set a new one.</p>'}</form>`;
    box.querySelector('.lnk').onclick=()=>{box.dataset.mode=setup?'':'setup';loginScreen()};
    box.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),m=box.querySelector('.msg');m.className='msg';m.textContent='Please wait…';
      try{const j=await api(setup?'setup':'login',{email:f.get('email'),password:f.get('pw'),name:f.get('name')});token=j.token;ls.set(TK,token);await start()}
      catch(err){m.className='msg err';m.textContent=err.message}};
  }
  async function start(){
    try{const j=await api('me');me=j.user;owner=j.owner}catch(e){token=null;ls.set(TK,null);return loginScreen()}
    const box=document.getElementById('authBox');if(box)box.remove();
    api('doc',{col:'people',id:me.id,data:{at:Date.now(),name:me.name,email:me.email}}).catch(()=>{});
    ready()}
  function signOut(){ls.set(TK,null);location.reload()}
  async function setPassword(){const old=prompt('Your current password:');if(!old)return;const pw=prompt('New password (8+ characters):');if(!pw)return;
    try{const j=await api('password',{old,password:pw});token=j.token;ls.set(TK,token);alert('Password changed.')}catch(e){alert(e.message)}}
  token=ls.get(TK);
  const boot=()=>token?start():loginScreen();
  if(document.body)boot();else document.addEventListener('DOMContentLoaded',boot);

  /* ---------- db: polling sync per collection ---------- */
  const cols={};let timer=null,polling=false;
  function colState(c){return cols[c]||(cols[c]={known:{},data:{},listeners:[],loaded:false})}
  async function syncCol(c){const st=colState(c);
    const j=await api('sync',{col:c,known:st.known});const chs=[];
    for(const d of j.changed){const had=d.id in st.known;st.known[d.id]=d.etag;st.data[d.id]=d.data;chs.push({type:had?'modified':'added',id:d.id,data:d.data})}
    for(const id of j.removed){delete st.known[id];delete st.data[id];chs.push({type:'removed',id,data:null})}
    const first=!st.loaded;st.loaded=true;
    if(chs.length||first)for(const l of st.listeners.slice())l(chs,first)}
  async function pollAll(){if(polling||document.hidden)return;polling=true;try{for(const c of Object.keys(cols))await syncCol(c).catch(()=>{})}finally{polling=false}}
  function ensureTimer(){if(!timer){timer=setInterval(pollAll,8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollAll()})}}
  const snapDoc=(id,data)=>({id,exists:data!=null,data:()=>clone(data)});
  function docRef(c,id){return {id,
    async get(){const st=colState(c);if(!st.loaded)await syncCol(c);return snapDoc(id,st.data[id])},
    async set(v){const j=await api('doc',{col:c,id,data:clone(v)});const st=colState(c);st.known[id]=j.etag;st.data[id]=clone(v)},
    async update(v){const cur=await this.get();await this.set(Object.assign({},cur.exists?cur.data():{},v))},
    async delete(){await api('doc',{col:c,id,delete:true});const st=colState(c);delete st.known[id];delete st.data[id]},
    onSnapshot(fn,err){const st=colState(c);const l=(chs,first)=>{if(first||chs.some(x=>x.id===id))fn(snapDoc(id,st.data[id]))};st.listeners.push(l);ensureTimer();
      if(st.loaded)fn(snapDoc(id,st.data[id]));else syncCol(c).catch(e=>err&&err(e));
      return ()=>{const i=st.listeners.indexOf(l);if(i>=0)st.listeners.splice(i,1)}}}}
  function colRef(c){return {doc:id=>docRef(c,id),
    async get(){const st=colState(c);await syncCol(c);return {docs:Object.keys(st.data).map(id=>snapDoc(id,st.data[id]))}},
    onSnapshot(fn,err){const st=colState(c);
      const l=(chs,first)=>{const list=(first?Object.keys(st.data).map(id=>({type:'added',id,data:st.data[id]})):chs).map(x=>({type:x.type,doc:snapDoc(x.id,x.data)}));if(list.length||first)fn({docChanges:()=>list,docs:list.filter(x=>x.type!=='removed').map(x=>x.doc)})};
      st.listeners.push(l);ensureTimer();
      if(st.loaded)l([],true);else syncCol(c).catch(e=>err&&err(e));
      return ()=>{const i=st.listeners.indexOf(l);if(i>=0)st.listeners.splice(i,1)}}}}
  const db={doc:p=>{const s=String(p).split('/');return docRef(s[0],s[1])},collection:c=>colRef(c)};

  /* ---------- user ---------- */
  let uCache=null,uAt=0;
  async function allUsers(){if(!uCache||Date.now()-uAt>30000){uCache=(await api('users')).users;uAt=Date.now()}return uCache}
  const user={
    async id(){return me&&me.id},async me(){return Object.assign({},me)},async isOwner(){return owner},async canEdit(){return true},
    async profiles(ids){const out={};(await allUsers()).forEach(u=>{if(ids.includes(u.id))out[u.id]={id:u.id,name:u.name||u.email,email:u.email}});return out},
    async search(q){q=String(q||'').toLowerCase();return (await allUsers()).filter(u=>!q||(u.name+' '+u.email).toLowerCase().includes(q)).map(u=>({id:u.id,name:u.name||u.email,email:u.email}))}};

  /* ---------- downloads: a normal browser download ---------- */
  const downloads={async save({filename,data}){const b=data instanceof Blob?data:new Blob([data]);const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);return {status:'saved'}}};

  /* ---------- sample: AI reading through /api/ai ---------- */
  const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)});
  async function sample(input,opts={}){const images=await Promise.all((opts.images||[]).map(async b=>({type:b.type||'image/png',data:await b64(b)})));
    try{const j=await api('ai',{input,images});return {text:j.text,truncated:!!j.truncated}}
    catch(e){e.code=e.status===501?'sampling_disabled':e.status===429?'rate_limited':e.code||'error';throw e}}
  sample.json=async(input,opts)=>{const {text}=await sample(typeof input==='string'?input+'\n\nReply with only valid JSON, no other text.':input,opts);const m=text.match(/[\[{][\s\S]*[\]}]/);return JSON.parse(m?m[0]:text)};
  let lim=null;sample.limits=async()=>{if(lim)return lim;try{await api('ai',{ping:true});lim={images:{maxCount:8}}}catch(e){lim={images:false}}return lim};

  /* ---------- admin helpers used by the Netlify-only parts of the page ---------- */
  window.mouldAuth={signOut,setPassword,isOwner:()=>owner,
    addLogin:(email,name,password)=>api('users',{email,name,password}).then(r=>{uCache=null;return r}),
    removeLogin:email=>api('users',{email,remove:true}).then(r=>{uCache=null;return r}),
    importBackup:docs=>api('import',{docs}),
    refresh:()=>pollAll()};
  const NS={db,user,downloads,sample};
  window.claude={use:async name=>{await authed;return NS[name]||null}};
})();
