import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api,API_BASE_URL,ApiError} from './api.js';

/* Export Center (PHASE 8). Three categories — Leads, Payments, Business
   Report — each with its own filter set and supported formats. Downloads
   go through plain navigation (window.open), the same pattern the existing
   analytics CSV export already uses: auth here is cookie-based (see
   api.js), so the browser attaches the session cookie automatically on a
   cross-site GET navigation. No bearer token, no query-string token, and
   nothing for a CSRF check to apply to (exports are GET-only). */

const PRESETS=[
  {value:'today',label:'Today'},
  {value:'last7days',label:'Last 7 days'},
  {value:'last30days',label:'Last 30 days'},
  {value:'thisMonth',label:'This month'},
  {value:'previousMonth',label:'Previous month'},
  {value:'custom',label:'Custom range'},
];

const LEAD_STATUSES=['new','contacted','booked','completed','cancelled','spam'];
const LEAD_PAYMENT_STATUSES=[
  {value:'',label:'All payments'},
  {value:'unpaid',label:'Unpaid'},
  {value:'pending',label:'Pending'},
  {value:'paid',label:'Paid'},
  {value:'failed',label:'Failed'},
];
const PAYMENT_STATUSES=[
  {value:'',label:'All statuses'},
  {value:'created',label:'Created'},
  {value:'pending',label:'Pending'},
  {value:'paid',label:'Paid'},
  {value:'failed',label:'Failed'},
  {value:'cancelled',label:'Cancelled'},
  {value:'expired',label:'Expired'},
];

const CATEGORIES=[
  {
    key:'leads',
    label:'Lead Export',
    icon:'📋',
    formats:[
      {value:'csv',label:'CSV'},
      {value:'xlsx',label:'Excel (.xlsx)'},
      {value:'pdf',label:'PDF'},
    ],
  },
  {
    key:'payments',
    label:'Payment Export',
    icon:'💳',
    formats:[
      {value:'csv',label:'CSV'},
      {value:'xlsx',label:'Excel (.xlsx)'},
      {value:'pdf',label:'PDF'},
    ],
  },
  {
    key:'business-report',
    label:'Business Report',
    icon:'📈',
    formats:[
      {value:'pdf',label:'PDF Report'},
      {value:'xlsx',label:'Excel Workbook'},
    ],
  },
];

function escapeHtml(s){
  const d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML;
}

function debounce(fn,ms){
  let t;
  return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms)};
}

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'export-center.html',title:'Export Center',admin});

  const state={
    category:'leads',
    format:'csv',
    preset:'last30days',
    startDate:'',
    endDate:'',
    status:'',
    paymentStatus:'',
    search:'',
    includeNotes:false,
  };

  content.innerHTML=`
    <div class="export-header">
      <h2 class="card__title" style="margin-bottom:2px">Export Center</h2>
      <p class="export-header__sub">Export real lead, payment, and business-report data as PDF, Excel, or CSV.</p>
    </div>

    <div class="export-tabs" id="categoryTabs">
      ${CATEGORIES.map(c=>`<button type="button" class="export-tab${c.key===state.category?' is-active':''}" data-category="${c.key}">${c.icon} ${c.label}</button>`).join('')}
    </div>

    <div class="export-grid">
      <div class="card">
        <h3 class="card__title" style="margin-bottom:16px" id="formTitle"></h3>

        <div class="export-form__row">
          <label>File format</label>
          <div class="format-group" id="formatGroup"></div>
        </div>

        <div class="export-form__row">
          <label>Date range</label>
          <select id="presetFilter">
            ${PRESETS.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="export-form__row" id="customRangeRow" style="display:none">
          <label>Custom range</label>
          <div class="export-form__two-col">
            <input type="date" id="startDateInput">
            <input type="date" id="endDateInput">
          </div>
        </div>

        <div id="leadFilters">
          <div class="export-form__row">
            <label>Lead status</label>
            <select id="leadStatusFilter">
              <option value="">All statuses</option>
              ${LEAD_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div class="export-form__row">
            <label>Payment status</label>
            <select id="leadPaymentStatusFilter">
              ${LEAD_PAYMENT_STATUSES.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="export-form__row">
            <label>Search (name or phone)</label>
            <input type="search" id="leadSearchInput" placeholder="Optional…">
          </div>
          <div class="export-form__row">
            <div class="checkbox-row">
              <input type="checkbox" id="includeNotesCheckbox">
              <label for="includeNotesCheckbox" style="font-weight:500">Include internal admin notes</label>
            </div>
            <div class="export-form__hint">Off by default — notes are internal and only included when explicitly selected.</div>
          </div>
        </div>

        <div id="paymentFilters" style="display:none">
          <div class="export-form__row">
            <label>Payment status</label>
            <select id="paymentStatusFilter">
              ${PAYMENT_STATUSES.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="export-form__row">
            <label>Search (lead name or phone)</label>
            <input type="search" id="paymentSearchInput" placeholder="Optional…">
          </div>
        </div>

        <div id="reportFilters" style="display:none">
          <p class="export-form__hint">The business report summarizes leads, payments, revenue, and conversion for the selected date range — the same figures shown on the Analytics dashboard.</p>
        </div>

        <div class="export-actions">
          <button class="btn btn--primary" id="downloadBtn" type="button">⤓ Download export</button>
        </div>
        <div class="export-status" id="exportStatus"></div>
      </div>

      <div class="card preview-card">
        <div class="preview-card__title">Preview &amp; confirmation</div>
        <div id="previewArea">
          <div class="preview-count" id="previewCount">—</div>
          <div class="preview-count__label" id="previewCountLabel">matching records</div>
          <div class="preview-row"><span class="preview-row__label">Export type</span><span class="preview-row__value" id="previewType">—</span></div>
          <div class="preview-row"><span class="preview-row__label">Format</span><span class="preview-row__value" id="previewFormat">—</span></div>
          <div class="preview-row"><span class="preview-row__label">Date range</span><span class="preview-row__value" id="previewRange">—</span></div>
          <div class="preview-row"><span class="preview-row__label">Filters</span><span class="preview-row__value" id="previewFilters">—</span></div>
        </div>
      </div>
    </div>`;

  const els={
    categoryTabs:document.getElementById('categoryTabs'),
    formTitle:document.getElementById('formTitle'),
    formatGroup:document.getElementById('formatGroup'),
    presetFilter:document.getElementById('presetFilter'),
    customRangeRow:document.getElementById('customRangeRow'),
    startDateInput:document.getElementById('startDateInput'),
    endDateInput:document.getElementById('endDateInput'),
    leadFilters:document.getElementById('leadFilters'),
    paymentFilters:document.getElementById('paymentFilters'),
    reportFilters:document.getElementById('reportFilters'),
    leadStatusFilter:document.getElementById('leadStatusFilter'),
    leadPaymentStatusFilter:document.getElementById('leadPaymentStatusFilter'),
    leadSearchInput:document.getElementById('leadSearchInput'),
    includeNotesCheckbox:document.getElementById('includeNotesCheckbox'),
    paymentStatusFilter:document.getElementById('paymentStatusFilter'),
    paymentSearchInput:document.getElementById('paymentSearchInput'),
    downloadBtn:document.getElementById('downloadBtn'),
    exportStatus:document.getElementById('exportStatus'),
    previewCount:document.getElementById('previewCount'),
    previewCountLabel:document.getElementById('previewCountLabel'),
    previewType:document.getElementById('previewType'),
    previewFormat:document.getElementById('previewFormat'),
    previewRange:document.getElementById('previewRange'),
    previewFilters:document.getElementById('previewFilters'),
  };

  function currentCategoryDef(){
    return CATEGORIES.find(c=>c.key===state.category);
  }

  function renderFormatGroup(){
    const def=currentCategoryDef();
    if(!def.formats.find(f=>f.value===state.format)) state.format=def.formats[0].value;
    els.formatGroup.innerHTML=def.formats.map(f=>`
      <label class="format-option${f.value===state.format?' is-active':''}">
        <input type="radio" name="format" value="${f.value}" ${f.value===state.format?'checked':''}>
        ${f.label}
      </label>`).join('');
    els.formatGroup.querySelectorAll('input[name="format"]').forEach(input=>{
      input.addEventListener('change',()=>{
        state.format=input.value;
        renderFormatGroup();
        updatePreview();
      });
    });
  }

  function renderCategoryVisibility(){
    els.formTitle.textContent=currentCategoryDef().label;
    els.leadFilters.style.display=state.category==='leads'?'':'none';
    els.paymentFilters.style.display=state.category==='payments'?'':'none';
    els.reportFilters.style.display=state.category==='business-report'?'':'none';
  }

  function rangeParams(){
    const params=new URLSearchParams({preset:state.preset});
    if(state.preset==='custom'){
      if(state.startDate)params.set('startDate',state.startDate);
      if(state.endDate)params.set('endDate',state.endDate);
    }
    return params;
  }

  function filtersSummaryText(){
    if(state.category==='leads'){
      const parts=[];
      if(state.status)parts.push(`status: ${state.status}`);
      if(state.paymentStatus)parts.push(`payment: ${state.paymentStatus}`);
      if(state.search)parts.push(`search: "${state.search}"`);
      if(state.includeNotes)parts.push('includes notes');
      return parts.length?parts.join(', '):'None';
    }
    if(state.category==='payments'){
      const parts=[];
      if(state.status)parts.push(`status: ${state.status}`);
      if(state.search)parts.push(`search: "${state.search}"`);
      return parts.length?parts.join(', '):'None';
    }
    return 'None';
  }

  function exportQueryParams(){
    const params=rangeParams();
    if(state.category==='leads'){
      if(state.status)params.set('status',state.status);
      if(state.paymentStatus)params.set('paymentStatus',state.paymentStatus);
      if(state.search)params.set('search',state.search);
      if(state.includeNotes)params.set('includeNotes','true');
    }else if(state.category==='payments'){
      if(state.status)params.set('status',state.status);
      if(state.search)params.set('search',state.search);
    }
    return params;
  }

  function exportUrl(){
    return `${API_BASE_URL}/admin/exports/${state.category}.${state.format}?${exportQueryParams().toString()}`;
  }

  function rangeLabel(){
    const preset=PRESETS.find(p=>p.value===state.preset);
    if(state.preset!=='custom')return preset.label;
    if(state.startDate&&state.endDate)return `${state.startDate} to ${state.endDate}`;
    return 'Custom range (select dates)';
  }

  function updatePreviewStatic(){
    els.previewType.textContent=currentCategoryDef().label;
    els.previewFormat.textContent=state.format.toUpperCase();
    els.previewRange.textContent=rangeLabel();
    els.previewFilters.textContent=filtersSummaryText();
  }

  let previewRequestId=0;
  const updatePreview=debounce(async ()=>{
    updatePreviewStatic();
    if(state.category==='business-report'){
      els.previewCount.textContent='—';
      els.previewCountLabel.textContent='summary report (no row count)';
      return;
    }
    if(state.preset==='custom'&&(!state.startDate||!state.endDate)){
      els.previewCount.textContent='—';
      els.previewCountLabel.textContent='select a custom date range';
      return;
    }
    const myRequestId=++previewRequestId;
    els.previewCount.textContent='…';
    els.previewCountLabel.textContent='counting matching records…';
    try{
      const params=rangeParams();
      if(state.category==='leads'){
        if(state.status)params.set('status',state.status);
        if(state.paymentStatus)params.set('paymentStatus',state.paymentStatus);
        if(state.search)params.set('search',state.search);
      }else{
        if(state.status)params.set('status',state.status);
        if(state.search)params.set('search',state.search);
      }
      const data=await api.get(`/admin/exports/${state.category}/count?${params.toString()}`);
      if(myRequestId!==previewRequestId)return; // a newer request superseded this one
      els.previewCount.textContent=data.count.toLocaleString('en-IN');
      els.previewCountLabel.textContent='matching records';
    }catch(err){
      if(myRequestId!==previewRequestId)return;
      els.previewCount.textContent='—';
      els.previewCountLabel.textContent='could not load count';
    }
  },300);

  function showStatus(message,variant){
    els.exportStatus.innerHTML=message?`<div class="banner banner--${variant}">${escapeHtml(message)}</div>`:'';
  }

  function validateBeforeDownload(){
    if(state.preset==='custom'){
      if(!state.startDate||!state.endDate){
        showStatus('Select both a start and end date for a custom range.','error');
        return false;
      }
      if(state.startDate>state.endDate){
        showStatus('The start date must be before the end date.','error');
        return false;
      }
    }
    return true;
  }

  let downloadInFlight=false;
  async function handleDownload(){
    if(downloadInFlight)return; // prevent duplicate requests from repeated clicks
    if(!validateBeforeDownload())return;
    showStatus('','');

    downloadInFlight=true;
    els.downloadBtn.disabled=true;
    const originalLabel=els.downloadBtn.textContent;
    els.downloadBtn.textContent='Preparing export…';

    try{
      const url=exportUrl();
      // A HEAD-style readiness check isn't supported by every export route the
      // same way (PDF returns 400 for zero matching records rather than an
      // empty file — see exportController.js), so we do a real fetch first to
      // confirm the response will actually be a successful file before handing
      // the browser a navigation to it. This also lets us show a clear error
      // instead of downloading a JSON error body as if it were a PDF/Excel/CSV
      // file (spec section 12).
      const res=await fetch(url,{credentials:'include'});
      if(!res.ok){
        let message=`Export failed (status ${res.status}).`;
        try{
          const body=await res.json();
          if(body?.error?.message)message=body.error.message;
        }catch{/* response wasn't JSON — keep the generic message */}
        if(res.status===401){
          showStatus('Your session has expired. Please log in again.','error');
        }else if(res.status===429){
          showStatus('Too many export requests — please wait a moment and try again.','error');
        }else{
          showStatus(message,'error');
        }
        return;
      }

      const truncatedHeader=res.headers.get('X-Export-Truncated');
      const blob=await res.blob();
      const disposition=res.headers.get('Content-Disposition')||'';
      const match=disposition.match(/filename="([^"]+)"/);
      const filename=match?match[1]:`export.${state.format}`;

      const blobUrl=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=blobUrl;
      a.download=filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);

      if(truncatedHeader){
        showStatus('Export downloaded, but the result was larger than the export limit and was truncated to the most recent matching records. Narrow your filters or date range to export the rest.','warn');
      }else{
        showStatus('Export downloaded successfully.','success');
      }
    }catch(err){
      showStatus('Could not reach the server. Check your connection and try again.','error');
    }finally{
      downloadInFlight=false;
      els.downloadBtn.disabled=false;
      els.downloadBtn.textContent=originalLabel;
    }
  }

  function resetFiltersForCategorySwitch(){
    state.status='';
    state.paymentStatus='';
    state.search='';
    state.includeNotes=false;
    els.leadStatusFilter.value='';
    els.leadPaymentStatusFilter.value='';
    els.leadSearchInput.value='';
    els.includeNotesCheckbox.checked=false;
    els.paymentStatusFilter.value='';
    els.paymentSearchInput.value='';
  }

  els.categoryTabs.addEventListener('click',(e)=>{
    const btn=e.target.closest('button[data-category]');
    if(!btn)return;
    state.category=btn.dataset.category;
    els.categoryTabs.querySelectorAll('.export-tab').forEach(t=>t.classList.toggle('is-active',t===btn));
    resetFiltersForCategorySwitch();
    renderCategoryVisibility();
    renderFormatGroup();
    showStatus('','');
    updatePreview();
  });

  els.presetFilter.addEventListener('change',()=>{
    state.preset=els.presetFilter.value;
    els.customRangeRow.style.display=state.preset==='custom'?'':'none';
    updatePreview();
  });
  els.startDateInput.addEventListener('change',()=>{state.startDate=els.startDateInput.value;updatePreview()});
  els.endDateInput.addEventListener('change',()=>{state.endDate=els.endDateInput.value;updatePreview()});

  els.leadStatusFilter.addEventListener('change',()=>{state.status=els.leadStatusFilter.value;updatePreview()});
  els.leadPaymentStatusFilter.addEventListener('change',()=>{state.paymentStatus=els.leadPaymentStatusFilter.value;updatePreview()});
  els.leadSearchInput.addEventListener('input',debounce(()=>{state.search=els.leadSearchInput.value.trim();updatePreview()},350));
  els.includeNotesCheckbox.addEventListener('change',()=>{state.includeNotes=els.includeNotesCheckbox.checked;updatePreview()});

  els.paymentStatusFilter.addEventListener('change',()=>{state.status=els.paymentStatusFilter.value;updatePreview()});
  els.paymentSearchInput.addEventListener('input',debounce(()=>{state.search=els.paymentSearchInput.value.trim();updatePreview()},350));

  els.downloadBtn.addEventListener('click',handleDownload);

  renderCategoryVisibility();
  renderFormatGroup();
  updatePreview();
}
