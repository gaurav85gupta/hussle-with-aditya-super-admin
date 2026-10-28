import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api,API_BASE_URL,ApiError} from './api.js';
import {lineChart,barChart,distributionBars} from './charts.js';

const PRESETS=[
  {value:'today',label:'Today'},
  {value:'last7days',label:'Last 7 days'},
  {value:'last30days',label:'Last 30 days'},
  {value:'thisMonth',label:'This month'},
  {value:'previousMonth',label:'Previous month'},
  {value:'custom',label:'Custom range'},
];

const STATUS_COLOR={
  paid:'var(--success)',pending:'var(--warn)',created:'var(--warn)',
  failed:'var(--danger)',cancelled:'var(--danger)',expired:'var(--danger)',
};

function formatPaise(paise,currency='INR'){
  const rupees=(paise||0)/100;
  if(currency!=='INR')return `${currency} ${rupees.toLocaleString('en-IN',{maximumFractionDigits:2})}`;
  return rupees.toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
}
function formatInt(n){return (n||0).toLocaleString('en-IN')}
function formatPct(n){return `${n}%`}
function formatDateTime(d){return new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}

function changeBadge(change){
  if(!change||change.value===null){
    if(change&&change.basis==='no_prior_data')return `<span class="kpi-card__change kpi-card__change--flat">No prior-period data</span>`;
    return '';
  }
  if(change.basis==='no_change'||change.value===0)return `<span class="kpi-card__change kpi-card__change--flat">No change vs. previous period</span>`;
  const up=change.value>0;
  return `<span class="kpi-card__change ${up?'kpi-card__change--up':'kpi-card__change--down'}">${up?'▲':'▼'} ${Math.abs(change.value)}% vs. previous period</span>`;
}

function kpiCard({title,value,change,hint}){
  return `<div class="kpi-card">
    <div class="kpi-card__title">${title}</div>
    <div class="kpi-card__value">${value}</div>
    ${change?changeBadge(change):''}
    ${hint?`<div class="kpi-card__hint">${hint}</div>`:''}
  </div>`;
}

function skeletonKpis(n){return Array.from({length:n}).map(()=>'<div class="skeleton skeleton--kpi"></div>').join('')}

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'analytics.html',title:'Business Analytics',admin});

  const state={preset:'last30days',startDate:'',endDate:'',interval:'day'};

  content.innerHTML=`
    <div class="analytics-header">
      <div>
        <h2 class="card__title" style="margin-bottom:2px">Business Analytics</h2>
        <p class="analytics-header__sub">An accurate, real-data view of leads, payments, revenue and conversion.</p>
      </div>
      <div class="analytics-header__meta">
        <span id="lastUpdated">—</span>
        <button class="btn btn--ghost btn--sm" id="refreshBtn" type="button">↻ Refresh</button>
      </div>
    </div>

    <div class="filter-bar">
      <select id="presetFilter">
        ${PRESETS.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
      </select>
      <div class="custom-range" id="customRange">
        <input type="date" id="startDateInput">
        <span style="color:var(--text-soft)">to</span>
        <input type="date" id="endDateInput">
        <button class="btn btn--primary btn--sm" id="applyCustomBtn" type="button">Apply</button>
      </div>
      <div id="rangeError" class="field__err"></div>
    </div>

    <div id="kpiArea" class="kpi-grid">${skeletonKpis(4)}</div>
    <div id="kpiAreaSecondary" class="kpi-grid" style="margin-top:-6px">${skeletonKpis(3)}</div>

    <div class="chart-grid">
      <div class="card">
        <div class="chart-toolbar">
          <h2 class="card__title" style="margin:0">Revenue</h2>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="interval-toggle" id="revenueIntervalToggle">
              <button data-interval="day" class="is-active" type="button">Day</button>
              <button data-interval="week" type="button">Week</button>
              <button data-interval="month" type="button">Month</button>
            </div>
            <button class="btn btn--ghost btn--sm btn--export" id="exportRevenueBtn" type="button">⤓ CSV</button>
          </div>
        </div>
        <div id="revenueChartArea"><div class="skeleton skeleton--chart"></div></div>
      </div>
      <div class="card">
        <div class="chart-toolbar">
          <h2 class="card__title" style="margin:0">Payment status</h2>
          <button class="btn btn--ghost btn--sm btn--export" id="exportPaymentsBtn" type="button">⤓ CSV</button>
        </div>
        <span class="section-label" id="paymentCountLabel"></span>
        <div id="paymentStatusArea"><div class="skeleton skeleton--chart"></div></div>
      </div>
    </div>

    <div class="chart-grid" style="margin-top:18px">
      <div class="card">
        <div class="chart-toolbar">
          <h2 class="card__title" style="margin:0">Leads</h2>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="interval-toggle" id="leadsIntervalToggle">
              <button data-interval="day" class="is-active" type="button">Day</button>
              <button data-interval="week" type="button">Week</button>
              <button data-interval="month" type="button">Month</button>
            </div>
            <button class="btn btn--ghost btn--sm btn--export" id="exportLeadsBtn" type="button">⤓ CSV</button>
          </div>
        </div>
        <div id="leadsChartArea"><div class="skeleton skeleton--chart"></div></div>
      </div>
      <div class="card">
        <h2 class="card__title">Conversion</h2>
        <div id="conversionArea"><div class="skeleton skeleton--chart"></div></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <h2 class="card__title">Recent activity</h2>
      <div class="activity-grid">
        <div>
          <span class="section-label">Recent leads</span>
          <div id="recentLeadsArea"><div class="empty-state">Loading…</div></div>
        </div>
        <div>
          <span class="section-label">Recent confirmed payments</span>
          <div id="recentPaymentsArea"><div class="empty-state">Loading…</div></div>
        </div>
      </div>
    </div>`;

  const els={
    presetFilter:document.getElementById('presetFilter'),
    customRange:document.getElementById('customRange'),
    startDateInput:document.getElementById('startDateInput'),
    endDateInput:document.getElementById('endDateInput'),
    applyCustomBtn:document.getElementById('applyCustomBtn'),
    rangeError:document.getElementById('rangeError'),
    lastUpdated:document.getElementById('lastUpdated'),
    refreshBtn:document.getElementById('refreshBtn'),
    kpiArea:document.getElementById('kpiArea'),
    kpiAreaSecondary:document.getElementById('kpiAreaSecondary'),
    revenueChartArea:document.getElementById('revenueChartArea'),
    leadsChartArea:document.getElementById('leadsChartArea'),
    paymentStatusArea:document.getElementById('paymentStatusArea'),
    paymentCountLabel:document.getElementById('paymentCountLabel'),
    conversionArea:document.getElementById('conversionArea'),
    recentLeadsArea:document.getElementById('recentLeadsArea'),
    recentPaymentsArea:document.getElementById('recentPaymentsArea'),
    revenueIntervalToggle:document.getElementById('revenueIntervalToggle'),
    leadsIntervalToggle:document.getElementById('leadsIntervalToggle'),
    exportRevenueBtn:document.getElementById('exportRevenueBtn'),
    exportLeadsBtn:document.getElementById('exportLeadsBtn'),
    exportPaymentsBtn:document.getElementById('exportPaymentsBtn'),
  };

  function rangeQueryParams(extra={}){
    const params=new URLSearchParams({preset:state.preset,...extra});
    if(state.preset==='custom'){
      if(state.startDate)params.set('startDate',state.startDate);
      if(state.endDate)params.set('endDate',state.endDate);
    }
    return params;
  }

  function errorBanner(err){
    const msg=err instanceof ApiError?err.message:'Something went wrong.';
    return `<div class="banner banner--error">Could not load this data (${msg}). <button class="btn btn--ghost btn--sm" data-retry type="button">Retry</button></div>`;
  }

  async function loadOverview(){
    els.kpiArea.innerHTML=skeletonKpis(4);
    els.kpiAreaSecondary.innerHTML=skeletonKpis(3);
    try{
      const data=await api.get('/admin/analytics/overview?'+rangeQueryParams().toString());
      els.lastUpdated.textContent='Updated '+formatDateTime(data.generatedAt);

      els.kpiArea.innerHTML=[
        kpiCard({title:'Total leads',value:formatInt(data.totalLeads),change:data.totalLeadsChange}),
        kpiCard({title:'Paid customers',value:formatInt(data.paidCustomers),change:data.paidCustomersChange,hint:'Distinct leads with a confirmed payment'}),
        kpiCard({title:'Confirmed revenue',value:formatPaise(data.confirmedRevenuePaise,data.confirmedRevenueCurrency),hint:`${formatInt(data.confirmedPaymentsCount)} confirmed payments`}),
        kpiCard({title:'Conversion rate',value:formatPct(data.conversionRate),change:data.conversionRateChange,hint:'Converted eligible leads ÷ eligible leads'}),
      ].join('');

      els.kpiAreaSecondary.innerHTML=[
        kpiCard({title:'Unpaid leads',value:formatInt(data.unpaidLeads)}),
        kpiCard({title:'Pending payment attempts',value:formatInt(data.pendingPaymentAttempts),hint:'Attempt count, not leads'}),
        kpiCard({title:'Failed payment attempts',value:formatInt(data.failedPaymentAttempts),hint:'Attempt count, not leads'}),
      ].join('');

      if(data.otherCurrencyRevenue&&data.otherCurrencyRevenue.length){
        els.kpiAreaSecondary.innerHTML+=`<div class="banner banner--info" style="grid-column:1/-1">Additional confirmed revenue in other currencies (not summed into the figure above): ${data.otherCurrencyRevenue.map(r=>`${formatPaise(r.totalPaise,r.currency)} (${r.count})`).join(', ')}</div>`;
      }
    }catch(err){
      const msg=errorBanner(err);
      els.kpiArea.innerHTML=msg;
      els.kpiAreaSecondary.innerHTML='';
      wireRetry(els.kpiArea,loadOverview);
    }
  }

  async function loadRevenue(){
    els.revenueChartArea.innerHTML='<div class="skeleton skeleton--chart"></div>';
    try{
      const data=await api.get('/admin/analytics/revenue?'+rangeQueryParams({interval:state.interval}).toString());
      els.revenueChartArea.innerHTML=lineChart({
        points:data.series.map(p=>({label:p.date,value:(p.revenuePaise||0)/100})),
        formatValue:(v)=>formatPaise(Math.round(v*100)),
      })+`<p style="color:var(--text-soft);font-size:.82rem;margin:10px 0 0">Total for period: ${formatPaise(data.totalPaise)} across ${formatInt(data.totalCount)} confirmed payments. Only verified, captured ('paid') payments are counted — pending, failed, cancelled and duplicate attempts are excluded.</p>`;
    }catch(err){
      els.revenueChartArea.innerHTML=errorBanner(err);
      wireRetry(els.revenueChartArea,loadRevenue);
    }
  }

  async function loadLeads(){
    els.leadsChartArea.innerHTML='<div class="skeleton skeleton--chart"></div>';
    try{
      const data=await api.get('/admin/analytics/leads?'+rangeQueryParams({interval:state.interval}).toString());
      els.leadsChartArea.innerHTML=barChart({
        bars:data.series.map(p=>({label:p.date,value:p.count})),
      })+`<p style="color:var(--text-soft);font-size:.82rem;margin:10px 0 0">${formatInt(data.total)} leads created this period${data.change&&data.change.value!==null?` (${data.change.value>0?'+':''}${data.change.value}% vs. previous period)`:''}.</p>`;
    }catch(err){
      els.leadsChartArea.innerHTML=errorBanner(err);
      wireRetry(els.leadsChartArea,loadLeads);
    }
  }

  async function loadPaymentStatus(){
    els.paymentStatusArea.innerHTML='<div class="skeleton skeleton--chart"></div>';
    try{
      const data=await api.get('/admin/analytics/payments?'+rangeQueryParams().toString());
      els.paymentCountLabel.textContent=`${formatInt(data.totalAttempts)} payment attempts · ${formatInt(data.uniqueConvertedLeads)} unique leads converted`;
      els.paymentStatusArea.innerHTML=distributionBars({rows:data.breakdown,colorFor:(s)=>STATUS_COLOR[s]||'var(--purple)'});
    }catch(err){
      els.paymentStatusArea.innerHTML=errorBanner(err);
      wireRetry(els.paymentStatusArea,loadPaymentStatus);
    }
  }

  async function loadConversion(){
    els.conversionArea.innerHTML='<div class="skeleton skeleton--chart"></div>';
    try{
      const data=await api.get('/admin/analytics/conversion?'+rangeQueryParams().toString());
      els.conversionArea.innerHTML=`
        <div style="text-align:center;padding:10px 0 18px">
          <div style="font-size:2.4rem;font-weight:700;color:var(--purple-dark)">${formatPct(data.conversionRate)}</div>
          <div style="color:var(--text-soft);font-size:.85rem">of ${formatInt(data.eligibleLeads)} eligible leads converted</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:.88rem">
          <div style="display:flex;justify-content:space-between"><span>Converted leads</span><strong>${formatInt(data.convertedLeads)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span>No confirmed payment</span><strong>${formatInt(data.leadsWithoutConfirmedPayment)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span>Pending attempt, unconverted</span><strong>${formatInt(data.leadsWithPendingAttempt)}</strong></div>
        </div>`;
    }catch(err){
      els.conversionArea.innerHTML=errorBanner(err);
      wireRetry(els.conversionArea,loadConversion);
    }
  }

  async function loadRecentActivity(){
    els.recentLeadsArea.innerHTML='<div class="empty-state">Loading…</div>';
    els.recentPaymentsArea.innerHTML='<div class="empty-state">Loading…</div>';
    try{
      const data=await api.get('/admin/analytics/recent?limit=8');
      els.recentLeadsArea.innerHTML=data.recentLeads.length
        ?data.recentLeads.map(l=>`<div class="activity-item"><span>${escapeHtml(l.name)} <span class="activity-item__sub">· ${escapeHtml(l.state)} · ${escapeHtml(l.status)}</span></span><span class="activity-item__sub">${formatDateTime(l.createdAt)}</span></div>`).join('')
        :'<div class="empty-state">No leads yet.</div>';
      els.recentPaymentsArea.innerHTML=data.recentPayments.length
        ?data.recentPayments.map(p=>`<div class="activity-item"><span>${escapeHtml(p.leadName)}</span><span>${formatPaise(p.amountPaise,p.currency)} <span class="activity-item__sub">${formatDateTime(p.paidAt)}</span></span></div>`).join('')
        :'<div class="empty-state">No confirmed payments yet.</div>';
    }catch(err){
      els.recentLeadsArea.innerHTML=errorBanner(err);
      els.recentPaymentsArea.innerHTML='';
      wireRetry(els.recentLeadsArea,loadRecentActivity);
    }
  }

  function escapeHtml(s){return String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  function wireRetry(container,fn){
    const btn=container.querySelector('[data-retry]');
    if(btn)btn.addEventListener('click',fn);
  }

  function loadAll(){
    loadOverview();
    loadRevenue();
    loadLeads();
    loadPaymentStatus();
    loadConversion();
    loadRecentActivity();
  }

  // --- Filter wiring ---
  els.presetFilter.value=state.preset;
  els.presetFilter.addEventListener('change',()=>{
    state.preset=els.presetFilter.value;
    els.rangeError.textContent='';
    els.customRange.classList.toggle('is-visible',state.preset==='custom');
    if(state.preset!=='custom')loadAll();
  });

  els.applyCustomBtn.addEventListener('click',()=>{
    const start=els.startDateInput.value;
    const end=els.endDateInput.value;
    if(!start||!end){els.rangeError.textContent='Pick both a start and an end date.';return}
    if(end<start){els.rangeError.textContent='End date must be after start date.';return}
    els.rangeError.textContent='';
    state.startDate=start;
    state.endDate=end;
    loadAll();
  });

  els.refreshBtn.addEventListener('click',loadAll);

  function wireIntervalToggle(toggleEl,onChange){
    toggleEl.addEventListener('click',(e)=>{
      const btn=e.target.closest('button[data-interval]');
      if(!btn)return;
      toggleEl.querySelectorAll('button').forEach(b=>b.classList.toggle('is-active',b===btn));
      state.interval=btn.dataset.interval;
      onChange();
    });
  }
  wireIntervalToggle(els.revenueIntervalToggle,loadRevenue);
  wireIntervalToggle(els.leadsIntervalToggle,loadLeads);

  function exportUrl(type){
    const params=rangeQueryParams({interval:state.interval,type});
    return `${API_BASE_URL}/admin/analytics/export?${params.toString()}`;
  }
  els.exportRevenueBtn.addEventListener('click',()=>{window.open(exportUrl('revenue'),'_blank')});
  els.exportLeadsBtn.addEventListener('click',()=>{window.open(exportUrl('leads'),'_blank')});
  els.exportPaymentsBtn.addEventListener('click',()=>{window.open(exportUrl('payments'),'_blank')});

  loadAll();
}
