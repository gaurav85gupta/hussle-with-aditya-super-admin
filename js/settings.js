import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api,ApiError} from './api.js';

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'settings.html',title:'Membership Settings',admin});

  content.innerHTML=`
    <div class="card">
      <h2 class="card__title">Current membership price</h2>
      <div id="loadArea"><div class="empty-state">Loading…</div></div>
    </div>

    <div class="card">
      <h2 class="card__title">Hero / introduction video</h2>
      <p class="cell-sub" style="margin:0 0 16px">The video visitors see at the top of the homepage, before paying. Uploads go straight to your Bunny.net Stream library.</p>
      <div id="heroLoadArea"><div class="empty-state">Loading…</div></div>
    </div>`;

  const loadArea=document.getElementById('loadArea');

  function rupeesFromPaise(p){return (p/100).toLocaleString('en-IN',{maximumFractionDigits:2})}

  /** Converts a rupee amount string (e.g. "99", "99.5", "1.005") to integer
   * paise without binary floating-point rounding errors. Returns null for
   * anything that isn't a valid, finite, positive, at-most-2-decimal amount
   * (a third decimal place is a fraction of a paisa, which cannot be
   * represented, so it's rejected rather than silently truncated). */
  function rupeesStringToPaise(raw){
    const s=String(raw).trim();
    if(!/^\d+(\.\d{1,2})?$/.test(s))return null;
    const [whole,frac='']=s.split('.');
    const paise=Number(whole)*100+Number(frac.padEnd(2,'0'));
    return paise>0?paise:null;
  }

  async function renderForm(){
    let setting;
    try{
      setting=await api.get('/admin/settings/price');
    }catch(err){
      loadArea.innerHTML=`<div class="banner banner--error">Could not load the current price (${err.message}).</div>`;
      return;
    }

    loadArea.innerHTML=`
      <div class="banner banner--info" style="margin-bottom:20px">
        Live price shown on the public site: <strong>₹${rupeesFromPaise(setting.valuePaise)}</strong>
        ${setting.comparePricePaise?`, shown against a struck-through <strong>₹${rupeesFromPaise(setting.comparePricePaise)}</strong> (${Math.round((1-setting.valuePaise/setting.comparePricePaise)*100)}% off)`:', no comparison price set'}
        (${setting.offerEnabled?'offer enabled':'offer disabled'}) — last updated ${new Date(setting.updatedAt).toLocaleString('en-IN')}
      </div>
      <div id="banner"></div>
      <form id="priceForm" novalidate>
        <div class="field">
          <label for="priceRupees">New price (₹, whole rupees or paise fraction e.g. 99 or 99.50)</label>
          <input id="priceRupees" type="number" min="0.01" step="0.01" required value="${setting.valuePaise/100}">
          <p class="field__err" id="e-price"></p>
        </div>
        <div class="field">
          <label for="comparePriceRupees">Comparison price (₹) — the original price shown struck-through, e.g. 1999</label>
          <input id="comparePriceRupees" type="number" min="0.01" step="0.01" placeholder="Leave empty to hide the struck-through price and the % OFF badge" value="${setting.comparePricePaise?setting.comparePricePaise/100:''}">
          <p class="cell-sub" style="margin:4px 0 0">Display only — customers are always charged the price above. Must be higher than the price. The "% OFF" and "You save" text are calculated automatically.</p>
          <p class="field__err" id="e-compare"></p>
        </div>
        <div class="field" style="flex-direction:row;align-items:center;gap:10px">
          <input id="offerEnabled" type="checkbox" style="width:18px;height:18px" ${setting.offerEnabled?'checked':''}>
          <label for="offerEnabled" style="margin:0">Offer enabled (shown as active on the public site)</label>
        </div>
        <button class="btn btn--primary" type="submit" id="saveBtn">Save price</button>
      </form>`;

    const form=document.getElementById('priceForm');
    const banner=document.getElementById('banner');
    const saveBtn=document.getElementById('saveBtn');

    form.addEventListener('submit',async(e)=>{
      e.preventDefault();
      banner.innerHTML='';
      document.getElementById('e-price').textContent='';
      document.getElementById('e-compare').textContent='';

      // Convert to integer paise client-side for display convenience only —
      // the server independently validates this is a safe positive integer
      // and is the final authority on what gets stored. Parsed from the
      // input's own string (not via Number()*100) to sidestep binary
      // floating-point representation errors (e.g. Math.round(1.005*100)
      // === 100, not 101).
      const valuePaise=rupeesStringToPaise(document.getElementById('priceRupees').value);
      if(valuePaise===null){
        document.getElementById('e-price').textContent='Enter a valid positive amount (up to 2 decimal places).';
        return;
      }
      const compareRaw=document.getElementById('comparePriceRupees').value.trim();
      let comparePricePaise=null; // empty = clear the comparison price
      if(compareRaw!==''){
        comparePricePaise=rupeesStringToPaise(compareRaw);
        if(comparePricePaise===null){
          document.getElementById('e-compare').textContent='Enter a valid positive amount (up to 2 decimal places), or leave empty.';
          return;
        }
        if(comparePricePaise<=valuePaise){
          document.getElementById('e-compare').textContent='The comparison price must be higher than the selling price.';
          return;
        }
      }
      const offerEnabled=document.getElementById('offerEnabled').checked;

      saveBtn.disabled=true;saveBtn.textContent='Saving…';
      try{
        const updated=await api.put('/admin/settings/price',{valuePaise,offerEnabled,comparePricePaise});
        banner.innerHTML=`<div class="banner banner--success">Price updated to ₹${rupeesFromPaise(updated.valuePaise)}.</div>`;
        await renderForm();
      }catch(err){
        const msg=err instanceof ApiError?err.message:'Something went wrong. Please try again.';
        banner.innerHTML=`<div class="banner banner--error">${msg}</div>`;
        saveBtn.disabled=false;saveBtn.textContent='Save price';
      }
    });
  }

  renderForm();

  /* ------------------------------ hero video ------------------------------ */
  // Same direct-to-Bunny TUS upload pattern as the Testimonials page: the
  // file streams straight from this browser to Bunny.net; the API key never
  // leaves the server, and only a short-lived, single-video signature does.
  const heroArea=document.getElementById('heroLoadArea');
  let heroBunny={configured:true};
  let heroUpload=null; // active tus.Upload instance, if any
  let heroUploadedVideoId=null;

  function heroHumanSize(bytes){
    if(!Number.isFinite(bytes))return '';
    const units=['B','KB','MB','GB'];let v=bytes,i=0;
    while(v>=1024&&i<units.length-1){v/=1024;i++}
    return `${v.toFixed(v<10&&i>0?1:0)} ${units[i]}`;
  }

  async function renderHero(){
    let hero;
    try{
      [hero,heroBunny]=await Promise.all([api.get('/admin/hero-video'),api.get('/admin/hero-video/bunny-status')]);
    }catch(err){
      heroArea.innerHTML=`<div class="banner banner--error">Could not load the hero video (${err instanceof ApiError?err.message:'please try again'}).</div>`;
      return;
    }

    const hasVideo=Boolean(hero.bunnyVideoId);
    const ready=hero.videoStatus===4;

    heroArea.innerHTML=`
      ${!heroBunny.configured?'<div class="banner banner--warn" style="margin-bottom:16px">Bunny.net is not configured on the server (BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_API_KEY), so a hero video cannot be uploaded or verified.</div>':''}
      ${hasVideo?`
        <div class="banner banner--${ready?'success':'warn'}" style="margin-bottom:16px">
          Current hero video: <code>${hero.bunnyVideoId}</code> — ${ready?'ready (finished processing) and live on the homepage.':'still processing on Bunny.net — the homepage keeps showing the previous video until this one finishes.'}
        </div>`:'<div class="banner banner--warn" style="margin-bottom:16px">No hero video set yet. Until one is uploaded, the homepage shows a "coming soon" placeholder.</div>'}
      <div id="heroBanner"></div>
      <label class="dropzone" id="heroDropzone" for="hero-file" style="margin-bottom:18px">
        <span id="heroDzLabel">${hasVideo?'Click to choose a new file to replace it, or drag it here':'Click to choose a video file, or drag it here'}</span>
        <div class="dropzone__hint">MP4, MOV, WebM — large files are fine.</div>
        <input id="hero-file" type="file" accept="video/*" ${heroBunny.configured?'':'disabled'}>
      </label>
      <div id="heroProgressArea" hidden style="margin-bottom:18px">
        <div class="upload-file"><span id="heroUpFileName"></span><span id="heroUpPct">0%</span></div>
        <div class="upload-bar"><div class="upload-bar__fill" id="heroUpBar"></div></div>
        <p class="upload-status" id="heroUpStatus">Uploading…</p>
        <button class="btn btn--ghost btn--sm" type="button" id="heroUpCancel" style="margin-top:10px">Cancel upload</button>
      </div>
      <p class="field__err" id="e-hero-file"></p>
      <div class="modal__foot" style="padding:0;border:0;justify-content:flex-start;gap:12px;margin-top:4px">
        <button class="btn btn--primary" type="button" id="heroSaveBtn" ${heroUploadedVideoId?'':'disabled'}>Save as hero video</button>
        ${hasVideo?'<button class="btn btn--danger" type="button" id="heroClearBtn">Remove hero video</button>':''}
      </div>`;

    const banner=document.getElementById('heroBanner');
    const saveBtn=document.getElementById('heroSaveBtn');
    const dropzone=document.getElementById('heroDropzone');

    async function startHeroUpload(file){
      if(typeof window.tus==='undefined'){
        document.getElementById('e-hero-file').textContent='Upload library failed to load. Check your connection and reload the page.';
        return;
      }
      heroUploadedVideoId=null;saveBtn.disabled=true;
      document.getElementById('e-hero-file').textContent='';banner.innerHTML='';
      document.getElementById('heroDzLabel').textContent=file.name;
      document.getElementById('heroProgressArea').hidden=false;
      document.getElementById('heroUpFileName').textContent=`${file.name} (${heroHumanSize(file.size)})`;
      document.getElementById('heroUpStatus').textContent='Preparing upload…';
      document.getElementById('heroUpBar').style.width='0%';document.getElementById('heroUpPct').textContent='0%';

      let init;
      try{
        init=await api.post('/admin/hero-video/bunny-upload-init',{title:'Hero introduction video'});
      }catch(err){
        document.getElementById('heroProgressArea').hidden=true;
        document.getElementById('e-hero-file').textContent=err instanceof ApiError?err.message:'Could not start the upload. Please try again.';
        return;
      }

      const {videoId,upload}=init;
      heroUpload=new window.tus.Upload(file,{
        endpoint:upload.endpoint,
        retryDelays:[0,1000,3000,5000,10000],
        headers:{
          AuthorizationSignature:upload.signature,
          AuthorizationExpire:String(upload.expiration),
          VideoId:videoId,
          LibraryId:String(upload.libraryId),
        },
        metadata:{filetype:file.type||'video/mp4',title:'Hero introduction video'},
        onError:(error)=>{
          heroUpload=null;
          document.getElementById('heroUpStatus').textContent='Upload failed.';
          document.getElementById('e-hero-file').textContent='Upload failed: '+(error?.message||'please try again.');
        },
        onProgress:(sent,total)=>{
          const pct=total?Math.round((sent/total)*100):0;
          document.getElementById('heroUpBar').style.width=pct+'%';document.getElementById('heroUpPct').textContent=pct+'%';
          document.getElementById('heroUpStatus').textContent=`Uploading… ${heroHumanSize(sent)} of ${heroHumanSize(total)}`;
        },
        onSuccess:()=>{
          heroUpload=null;heroUploadedVideoId=videoId;
          document.getElementById('heroUpBar').style.width='100%';document.getElementById('heroUpPct').textContent='100%';
          document.getElementById('heroUpStatus').textContent='Upload complete — Bunny.net is now processing it. Click "Save as hero video" to use it.';
          saveBtn.disabled=false;
        },
      });
      heroUpload.start();
    }

    document.getElementById('hero-file').addEventListener('change',(e)=>{
      const file=e.target.files&&e.target.files[0];
      if(file)startHeroUpload(file);
    });
    ['dragover','dragenter'].forEach(ev=>dropzone.addEventListener(ev,(e)=>{e.preventDefault();dropzone.classList.add('is-drag')}));
    ['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev,(e)=>{e.preventDefault();dropzone.classList.remove('is-drag')}));
    dropzone.addEventListener('drop',(e)=>{
      if(!heroBunny.configured)return;
      const file=e.dataTransfer?.files&&e.dataTransfer.files[0];
      if(file){document.getElementById('hero-file').files=e.dataTransfer.files;startHeroUpload(file)}
    });
    document.getElementById('heroUpCancel')?.addEventListener('click',()=>{
      if(heroUpload){try{heroUpload.abort()}catch{}heroUpload=null}
      heroUploadedVideoId=null;
      document.getElementById('heroProgressArea').hidden=true;
      saveBtn.disabled=true;
    });

    saveBtn.addEventListener('click',async()=>{
      if(!heroUploadedVideoId)return;
      saveBtn.disabled=true;saveBtn.textContent='Verifying & saving…';banner.innerHTML='';
      try{
        await api.put('/admin/hero-video',{bunnyVideoId:heroUploadedVideoId});
        banner.innerHTML='<div class="banner banner--success">Hero video updated.</div>';
        heroUploadedVideoId=null;
        await renderHero();
      }catch(err){
        banner.innerHTML=`<div class="banner banner--error">${err instanceof ApiError?err.message:'Something went wrong. Please try again.'}</div>`;
        saveBtn.disabled=false;saveBtn.textContent='Save as hero video';
      }
    });

    document.getElementById('heroClearBtn')?.addEventListener('click',async()=>{
      const ok=window.confirm('Remove the hero video from the homepage?\n\nThe video itself is NOT deleted from Bunny.net — only the homepage will stop showing it, falling back to the "coming soon" placeholder.');
      if(!ok)return;
      const btn=document.getElementById('heroClearBtn');
      btn.disabled=true;banner.innerHTML='';
      try{
        await api.del('/admin/hero-video');
        banner.innerHTML='<div class="banner banner--success">Hero video removed.</div>';
        await renderHero();
      }catch(err){
        banner.innerHTML=`<div class="banner banner--error">${err instanceof ApiError?err.message:'Something went wrong. Please try again.'}</div>`;
        btn.disabled=false;
      }
    });
  }

  renderHero();
}