import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api,ApiError} from './api.js';

/* Testimonial management. All data shown here comes from the authenticated
   admin API; every value is HTML-escaped before it is placed in markup. The
   Bunny.net API key never reaches this code — the server verifies video ids. */

const EMBED_PREFIX='https://player.mediadelivery.net/embed/';
const VIDEO_ID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtDate(d){return d?new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—'}
function errMsg(err){return err instanceof ApiError?err.message:'Something went wrong. Please try again.'}
function safeHttps(u){return typeof u==='string'&&u.startsWith('https://')?u:''}

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'testimonials.html',title:'Testimonials',admin});
  let items=[];
  let bunny={configured:true,thumbnailsEnabled:false,libraryId:null};
  let editing=null; // testimonial being edited, or null when adding

  content.innerHTML=`
    <div id="banner"></div>
    <div class="card">
      <div class="toolbar">
        <p class="cell-sub" style="margin:0">Videos live in Bunny.net Stream. Here you control which ones appear on the public site, and in what order.</p>
        <button class="btn btn--primary" id="addBtn" type="button">+ Add testimonial</button>
      </div>
      <div id="listArea"><div class="empty-state">Loading…</div></div>
    </div>

    <dialog class="modal" id="formDialog" aria-labelledby="formTitle"><div class="modal__body">
      <div class="modal__head"><h2 id="formTitle">Add testimonial</h2><button class="modal__close" type="button" data-close aria-label="Close">&times;</button></div>
      <div id="formBanner"></div>
      <form id="tForm" novalidate>
        <div class="field"><label for="f-title">Title *</label><input id="f-title" maxlength="120" required><p class="field__err" id="e-title"></p></div>

        <div class="field" id="srcField">
          <label>Video *</label>
          <div class="src-tabs" id="srcTabs" role="tablist">
            <button type="button" data-src="upload" class="is-active">Upload video file</button>
            <button type="button" data-src="existing">Use existing Bunny video ID</button>
          </div>

          <div id="srcUpload">
            <label class="dropzone" id="dropzone" for="f-file">
              <span id="dzLabel">Click to choose a video file, or drag it here</span>
              <div class="dropzone__hint">Uploads straight to your Bunny.net Stream library. MP4, MOV, WebM — large files are fine.</div>
              <input id="f-file" type="file" accept="video/*">
            </label>
            <div id="uploadProgressArea" hidden>
              <div class="upload-file"><span id="upFileName"></span><span id="upPct">0%</span></div>
              <div class="upload-bar"><div class="upload-bar__fill" id="upBar"></div></div>
              <p class="upload-status" id="upStatus">Uploading…</p>
              <button class="btn btn--ghost btn--sm" type="button" id="upCancel" style="margin-top:8px">Cancel upload</button>
            </div>
            <p class="field__err" id="e-file"></p>
          </div>

          <div id="srcExisting" hidden>
            <input id="f-video" maxlength="36" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false">
            <p class="field__hint">Bunny dashboard → Stream → your library → the video’s GUID. It is checked against your library when you save.</p>
          </div>
          <p class="field__err" id="e-video"></p>
        </div>

        <div class="field"><label for="f-name">Display name (optional)</label><input id="f-name" maxlength="80"><p class="field__err" id="e-name"></p></div>
        <div class="field"><label for="f-desc">Description (optional)</label><textarea id="f-desc" rows="3" maxlength="1000"></textarea><p class="field__err" id="e-desc"></p></div>
        <div class="field"><label for="f-order">Display order (lower numbers appear first)</label><input id="f-order" type="number" min="0" step="1" placeholder="Leave empty to add at the end"><p class="field__err" id="e-order"></p></div>
        <div class="field field--inline" id="publishField"><input id="f-pub" type="checkbox"><label for="f-pub" style="margin:0">Publish on the public website now</label></div>
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-close>Cancel</button><button class="btn btn--primary" type="submit" id="saveBtn">Save</button></div>
      </form>
    </div></dialog>

    <dialog class="modal" id="previewDialog" aria-labelledby="pvTitle"><div class="modal__body">
      <div class="modal__head"><h2 id="pvTitle">Preview</h2><button class="modal__close" type="button" data-close aria-label="Close">&times;</button></div>
      <div id="pvBody"></div>
    </div></dialog>`;

  const $=id=>document.getElementById(id);
  const banner=$('banner'),listArea=$('listArea'),formDialog=$('formDialog'),previewDialog=$('previewDialog');
  const form=$('tForm'),formBanner=$('formBanner'),saveBtn=$('saveBtn');

  /* --------------------------- upload (direct to Bunny) --------------------------- */
  // Uploaded bytes go straight from this browser to Bunny.net over TUS using a
  // short-lived, single-video signature minted by our server — the file (and
  // the Bunny API key) never pass through our own backend.
  let srcMode='upload'; // 'upload' | 'existing'
  let uploadedVideoId=null; // set once a direct upload has finished successfully
  let currentUpload=null; // active tus.Upload instance, if any

  function setSrcMode(mode){
    srcMode=mode;
    document.querySelectorAll('#srcTabs button').forEach(b=>b.classList.toggle('is-active',b.dataset.src===mode));
    $('srcUpload').hidden=mode!=='upload';
    $('srcExisting').hidden=mode!=='existing';
    $('e-video').textContent='';$('e-file').textContent='';
  }
  $('srcTabs').addEventListener('click',(e)=>{
    const b=e.target.closest('button[data-src]');
    if(b)setSrcMode(b.dataset.src);
  });

  function resetUploadUI(){
    uploadedVideoId=null;
    if(currentUpload){try{currentUpload.abort()}catch{}currentUpload=null}
    $('f-file').value='';
    $('dzLabel').textContent='Click to choose a video file, or drag it here';
    $('uploadProgressArea').hidden=true;
    $('upBar').style.width='0%';$('upPct').textContent='0%';$('upStatus').textContent='Uploading…';
    $('e-file').textContent='';
  }

  function humanSize(bytes){
    if(!Number.isFinite(bytes))return '';
    const units=['B','KB','MB','GB'];let v=bytes,i=0;
    while(v>=1024&&i<units.length-1){v/=1024;i++}
    return `${v.toFixed(v<10&&i>0?1:0)} ${units[i]}`;
  }

  async function startUpload(file){
    if(typeof window.tus==='undefined'){
      $('e-file').textContent='Upload library failed to load. Check your connection and reload the page.';
      return;
    }
    uploadedVideoId=null;
    $('e-file').textContent='';formBanner.innerHTML='';
    $('dzLabel').textContent=file.name;
    $('uploadProgressArea').hidden=false;
    $('upFileName').textContent=`${file.name} (${humanSize(file.size)})`;
    $('upStatus').textContent='Preparing upload…';
    $('upBar').style.width='0%';$('upPct').textContent='0%';
    saveBtn.disabled=true;

    let init;
    try{
      const titleForBunny=$('f-title').value.trim()||file.name.slice(0,120)||'Testimonial';
      init=await api.post('/admin/testimonials/bunny-upload-init',{title:titleForBunny});
    }catch(err){
      $('uploadProgressArea').hidden=true;
      $('e-file').textContent=errMsg(err);
      saveBtn.disabled=false;
      return;
    }

    const {videoId,upload}=init;
    currentUpload=new window.tus.Upload(file,{
      endpoint:upload.endpoint,
      retryDelays:[0,1000,3000,5000,10000],
      headers:{
        AuthorizationSignature:upload.signature,
        AuthorizationExpire:String(upload.expiration),
        VideoId:videoId,
        LibraryId:String(upload.libraryId),
      },
      metadata:{filetype:file.type||'video/mp4',title:$('f-title').value.trim()||file.name},
      onError:(error)=>{
        currentUpload=null;
        $('upStatus').textContent='Upload failed.';
        $('e-file').textContent='Upload failed: '+(error?.message||'please try again.');
        saveBtn.disabled=false;
      },
      onProgress:(sent,total)=>{
        const pct=total?Math.round((sent/total)*100):0;
        $('upBar').style.width=pct+'%';$('upPct').textContent=pct+'%';
        $('upStatus').textContent=`Uploading… ${humanSize(sent)} of ${humanSize(total)}`;
      },
      onSuccess:()=>{
        currentUpload=null;
        uploadedVideoId=videoId;
        $('upBar').style.width='100%';$('upPct').textContent='100%';
        $('upStatus').textContent='Upload complete — Bunny.net is now processing the video. You can save the testimonial now.';
        // Bunny needs some time to finish processing a freshly-uploaded file,
        // so publishing immediately would usually fail — save unpublished and
        // use the Publish button once it has finished (see Preview > Video status).
        if($('f-pub')&&!$('publishField').hidden)$('f-pub').checked=false;
        saveBtn.disabled=false;
      },
    });
    currentUpload.start();
  }

  const dropzone=$('dropzone');
  $('f-file').addEventListener('change',(e)=>{
    const file=e.target.files&&e.target.files[0];
    if(file)startUpload(file);
  });
  ['dragover','dragenter'].forEach(ev=>dropzone.addEventListener(ev,(e)=>{e.preventDefault();dropzone.classList.add('is-drag')}));
  ['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev,(e)=>{e.preventDefault();dropzone.classList.remove('is-drag')}));
  dropzone.addEventListener('drop',(e)=>{
    const file=e.dataTransfer?.files&&e.dataTransfer.files[0];
    if(file){$('f-file').files=e.dataTransfer.files;startUpload(file)}
  });
  $('upCancel').addEventListener('click',()=>{
    if(currentUpload){try{currentUpload.abort()}catch{}}
    resetUploadUI();
    saveBtn.disabled=false;
  });

  function showBanner(kind,msg){banner.innerHTML=`<div class="banner banner--${kind}" role="status">${esc(msg)}</div>`;if(kind==='success')setTimeout(()=>{banner.innerHTML=''},5000)}

  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  previewDialog.addEventListener('close',()=>{$('pvBody').innerHTML=''}); // stops any playing video
  formDialog.addEventListener('close',()=>{if(currentUpload){try{currentUpload.abort()}catch{}currentUpload=null}}); // cancel any in-flight upload if the dialog is dismissed

  /* ------------------------------- list ------------------------------- */
  async function load(){
    listArea.innerHTML='<div class="empty-state">Loading…</div>';
    try{
      const [list,status]=await Promise.all([api.get('/admin/testimonials'),api.get('/admin/testimonials/bunny-status')]);
      items=list.items;bunny=status;
    }catch(err){
      listArea.innerHTML=`<div class="banner banner--error">Could not load testimonials (${esc(errMsg(err))}). <button class="btn btn--ghost btn--sm" id="retryBtn" type="button">Retry</button></div>`;
      $('retryBtn').addEventListener('click',load);
      return;
    }
    if(!bunny.configured){
      showBanner('warn','Bunny.net is not configured on the server (BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_API_KEY). You can view existing testimonials but cannot add or publish videos until it is.');
    }
    render();
  }

  function thumb(t){
    const url=safeHttps(t.thumbnailUrl);
    return url?`<img class="thumb" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;thumb thumb--empty&quot;>No thumbnail</div>'">`
              :'<div class="thumb thumb--empty">No thumbnail</div>';
  }

  function render(){
    if(!items.length){
      listArea.innerHTML='<div class="empty-state">No testimonials yet. Click “Add testimonial” to link a video from your Bunny.net library.</div>';
      return;
    }
    listArea.innerHTML=`<div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Video</th><th>Title</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
      <tbody>${items.map((t,i)=>`
        <tr data-id="${esc(t.id)}">
          <td>${esc(t.displayOrder)}</td>
          <td>${thumb(t)}</td>
          <td><div class="cell-title">${esc(t.title)}</div><div class="cell-sub">${t.displayName?esc(t.displayName):'<em>No display name</em>'}</div></td>
          <td><span class="status-pill status-pill--${t.isPublished?'published':'draft'}">${t.isPublished?'Published':'Unpublished'}</span></td>
          <td>${esc(fmtDate(t.updatedAt))}</td>
          <td><div class="row-actions">
            <button class="btn btn--ghost btn--sm" data-act="up" type="button" aria-label="Move up" ${i===0?'disabled':''}>↑</button>
            <button class="btn btn--ghost btn--sm" data-act="down" type="button" aria-label="Move down" ${i===items.length-1?'disabled':''}>↓</button>
            <button class="btn btn--ghost btn--sm" data-act="preview" type="button">Preview</button>
            <button class="btn btn--ghost btn--sm" data-act="edit" type="button">Edit</button>
            <button class="btn btn--ghost btn--sm" data-act="toggle" type="button">${t.isPublished?'Unpublish':'Publish'}</button>
            <button class="btn btn--danger btn--sm" data-act="delete" type="button">Delete</button>
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  listArea.addEventListener('click',async(e)=>{
    const btn=e.target.closest('button[data-act]');
    if(!btn)return;
    const id=btn.closest('tr').dataset.id;
    const t=items.find(x=>x.id===id);
    if(!t)return;
    const act=btn.dataset.act;
    if(act==='preview')return openPreview(t);
    if(act==='edit')return openForm(t);
    if(act==='up'||act==='down')return move(id,act==='up'?-1:1,btn);
    if(act==='toggle')return togglePublish(t,btn);
    if(act==='delete')return remove(t,btn);
  });

  async function togglePublish(t,btn){
    btn.disabled=true;banner.innerHTML='';
    try{
      await api.patch(`/admin/testimonials/${encodeURIComponent(t.id)}/publish`,{isPublished:!t.isPublished});
      showBanner('success',t.isPublished?'Testimonial unpublished — it is no longer on the public website.':'Testimonial published — it now appears on the public website.');
      await load();
    }catch(err){showBanner('error',errMsg(err));btn.disabled=false}
  }

  async function move(id,delta,btn){
    const idx=items.findIndex(x=>x.id===id),to=idx+delta;
    if(to<0||to>=items.length)return;
    const ids=items.map(x=>x.id);
    [ids[idx],ids[to]]=[ids[to],ids[idx]];
    btn.disabled=true;banner.innerHTML='';
    try{
      const data=await api.put('/admin/testimonials/order',{ids});
      items=data.items;render();
    }catch(err){
      showBanner('error',errMsg(err));
      if(err instanceof ApiError&&(err.code==='REORDER_STALE'||err.status===404))await load();else btn.disabled=false;
    }
  }

  async function remove(t,btn){
    const ok=window.confirm(`Delete the testimonial “${t.title}”?\n\nThis removes it from this admin and from the public website. The video itself is NOT deleted from Bunny.net.`);
    if(!ok)return;
    btn.disabled=true;banner.innerHTML='';
    try{
      await api.del(`/admin/testimonials/${encodeURIComponent(t.id)}`);
      showBanner('success','Testimonial deleted. The video is still in your Bunny.net library.');
      await load();
    }catch(err){showBanner('error',errMsg(err));btn.disabled=false}
  }

  /* ------------------------------ add / edit ------------------------------ */
  function clearErrors(){['title','video','name','desc','order','file'].forEach(k=>{$('e-'+k).textContent=''});formBanner.innerHTML=''}

  function openForm(t){
    editing=t||null;clearErrors();resetUploadUI();
    $('formTitle').textContent=editing?'Edit testimonial':'Add testimonial';
    $('f-title').value=editing?editing.title:'';
    $('f-video').value=editing?editing.bunnyVideoId:'';
    $('f-name').value=editing?editing.displayName:'';
    $('f-desc').value=editing?editing.description:'';
    $('f-order').value=editing?editing.displayOrder:'';
    $('f-pub').checked=false;
    $('publishField').hidden=!!editing; // publication of existing items is changed with the Publish button
    // Editing an existing testimonial keeps the simple "video ID" field (its
    // video already lives in Bunny); adding a new one defaults to uploading.
    $('srcField').hidden=!!editing;
    setSrcMode(editing?'existing':'upload');
    saveBtn.disabled=!bunny.configured&&!editing?true:false;
    if(!bunny.configured&&!editing)formBanner.innerHTML='<div class="banner banner--warn">Bunny.net is not configured on the server, so videos cannot be verified or uploaded.</div>';
    formDialog.showModal();
    $('f-title').focus();
  }
  $('addBtn').addEventListener('click',()=>openForm(null));

  function validate(){
    clearErrors();
    let ok=true;const fail=(k,m)=>{$('e-'+k).textContent=m;ok=false};
    const title=$('f-title').value.trim(),name=$('f-name').value.trim(),desc=$('f-desc').value.trim(),order=$('f-order').value.trim();
    if(title.length<2)fail('title','Title must be at least 2 characters.');
    if(title.length>120)fail('title','Title is too long (max 120).');

    let video='';
    if(!editing&&srcMode==='upload'){
      if(currentUpload)fail('file','Please wait for the upload to finish (or cancel it) before saving.');
      else if(!uploadedVideoId)fail('file','Choose a video file and wait for the upload to finish.');
      else video=uploadedVideoId;
    }else{
      video=$('f-video').value.trim().toLowerCase();
      if(!VIDEO_ID_RE.test(video))fail('video','Enter the video ID exactly as shown in Bunny.net (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).');
    }

    if(name.length>80)fail('name','Display name is too long (max 80).');
    if(desc.length>1000)fail('desc','Description is too long (max 1000).');
    if(order!==''&&!/^\d{1,6}$/.test(order))fail('order','Use a whole number, 0 or higher.');
    return ok?{title,video,name,desc,order}:null;
  }

  form.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const v=validate();if(!v)return;
    saveBtn.disabled=true;
    saveBtn.textContent=(!editing&&srcMode==='upload')?'Saving…':'Verifying & saving…';
    formBanner.innerHTML='';
    try{
      if(editing){
        const body={title:v.title,bunnyVideoId:v.video,displayName:v.name,description:v.desc};
        if(v.order!=='')body.displayOrder=Number(v.order);
        await api.patch(`/admin/testimonials/${encodeURIComponent(editing.id)}`,body);
      }else{
        const body={title:v.title,bunnyVideoId:v.video,displayName:v.name,description:v.desc,isPublished:$('f-pub').checked};
        if(v.order!=='')body.displayOrder=Number(v.order);
        await api.post('/admin/testimonials',body);
      }
      formDialog.close();
      showBanner('success',editing?'Testimonial updated.':'Testimonial added. If it was just uploaded, Bunny.net may take a little while to finish processing it before it plays smoothly.');
      await load();
    }catch(err){
      formBanner.innerHTML=`<div class="banner banner--error" role="alert">${esc(errMsg(err))}</div>`;
    }finally{
      saveBtn.disabled=false;saveBtn.textContent='Save';
    }
  });

  /* -------------------------------- preview -------------------------------- */
  function openPreview(t){
    const thumbUrl=safeHttps(t.thumbnailUrl);
    $('pvTitle').textContent=t.title;
    $('pvBody').innerHTML=`
      <div class="preview-frame" id="pvFrame">
        ${thumbUrl?`<img src="${esc(thumbUrl)}" alt="" referrerpolicy="no-referrer">`:''}
        <button class="btn btn--primary" id="pvPlay" type="button">▶ Load player</button>
      </div>
      <dl class="kv">
        <dt>Status</dt><dd>${t.isPublished?'Published (visible on the public website)':'Unpublished (hidden from the public website)'}</dd>
        <dt>Display name</dt><dd>${t.displayName?esc(t.displayName):'—'}</dd>
        <dt>Description</dt><dd>${t.description?esc(t.description):'—'}</dd>
        <dt>Display order</dt><dd>${esc(t.displayOrder)}</dd>
        <dt>Bunny video ID</dt><dd><code>${esc(t.bunnyVideoId)}</code></dd>
        <dt>Bunny library</dt><dd>${esc(t.bunnyLibraryId)}</dd>
        <dt>Video status</dt><dd>${t.videoStatus===4?'Ready (finished processing)':'Not confirmed ready (code '+esc(t.videoStatus)+')'} — last checked ${esc(fmtDate(t.videoVerifiedAt))}</dd>
        <dt>Last updated</dt><dd>${esc(fmtDate(t.updatedAt))}</dd>
      </dl>`;
    $('pvPlay').addEventListener('click',()=>{
      if(!t.embedUrl||!t.embedUrl.startsWith(EMBED_PREFIX)){$('pvFrame').innerHTML='<p style="color:#fff">No valid player URL for this video.</p>';return}
      const f=document.createElement('iframe');
      f.src=t.embedUrl;f.title='Video preview: '+t.title;f.allowFullscreen=true;
      f.allow='accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture';
      f.referrerPolicy='strict-origin-when-cross-origin';
      $('pvFrame').replaceChildren(f);
    });
    previewDialog.showModal();
  }

  load();
}
