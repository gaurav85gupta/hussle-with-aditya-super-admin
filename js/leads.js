import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api} from './api.js';

const STATUSES=['new','contacted','booked','completed','cancelled','spam'];
const PAYMENT_STATUSES=[
  {value:'',label:'All payments'},
  {value:'unpaid',label:'Unpaid'},
  {value:'pending',label:'Pending'},
  {value:'paid',label:'Paid'},
  {value:'failed',label:'Failed'},
];
/* Payment overall status comes from the API as one of: unpaid, created,
   pending, paid, failed, cancelled, expired (see paymentsService.js
   buildSummaryFromAttempts). Map every value to a pill style without
   inventing new statuses. */
const PAYMENT_PILL_CLASS={
  unpaid:'status-pill--payment-unpaid',
  created:'status-pill--payment-pending',
  pending:'status-pill--payment-pending',
  paid:'status-pill--payment-paid',
  failed:'status-pill--payment-failed',
  cancelled:'status-pill--payment-failed',
  expired:'status-pill--payment-failed',
};

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'leads.html',title:'Leads',admin});

  const state={page:1,limit:20,search:'',status:'',paymentStatus:''};

  content.innerHTML=`
    <div class="card">
      <div class="filter-bar">
        <input id="searchInput" class="filter-bar__search" type="search" placeholder="Search by name or phone…">
        <select id="statusFilter">
          <option value="">All statuses</option>
          ${STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
        <select id="paymentFilter">
          ${PAYMENT_STATUSES.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><div id="tableArea"><div class="empty-state">Loading…</div></div></div>
      <div class="pagination" id="pagination"></div>
    </div>`;

  const tableArea=document.getElementById('tableArea');
  const pagination=document.getElementById('pagination');
  const searchInput=document.getElementById('searchInput');
  const statusFilter=document.getElementById('statusFilter');
  const paymentFilter=document.getElementById('paymentFilter');

  function fmtDate(d){return new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}
  function fmtPaise(paise,currency){
    if(paise==null)return'—';
    const rupees=paise/100;
    const amount=Number.isInteger(rupees)?String(rupees):rupees.toFixed(2);
    return(currency==='INR'?'₹':(currency||'')+' ')+amount;
  }
  function paymentPill(payment){
    const s=payment?.status||'unpaid';
    const cls=PAYMENT_PILL_CLASS[s]||'status-pill--payment-unpaid';
    return `<span class="status-pill ${cls}">${s}</span>`;
  }

  async function load(){
    tableArea.innerHTML='<div class="empty-state">Loading…</div>';
    pagination.innerHTML='';
    const params=new URLSearchParams({page:state.page,limit:state.limit});
    if(state.search)params.set('search',state.search);
    if(state.status)params.set('status',state.status);
    if(state.paymentStatus)params.set('paymentStatus',state.paymentStatus);

    try{
      const data=await api.get('/admin/leads?'+params.toString());
      if(!data.items.length){
        tableArea.innerHTML='<div class="empty-state">No leads match your filters yet.</div>';
        return;
      }
      tableArea.innerHTML=`
        <table>
          <thead><tr><th>Name</th><th>State</th><th>Phone</th><th>Status</th><th>Payment</th><th>Amount</th><th>Submitted</th><th></th></tr></thead>
          <tbody>
            ${data.items.map(l=>`
              <tr>
                <td>${escapeHtml(l.name)}</td>
                <td>${escapeHtml(l.state)}</td>
                <td>${escapeHtml(l.phone)}</td>
                <td><span class="status-pill status-pill--${l.status}">${l.status}</span></td>
                <td>${paymentPill(l.payment)}</td>
                <td>${fmtPaise(l.payment?.amountPaise,l.payment?.currency)}</td>
                <td>${fmtDate(l.createdAt)}</td>
                <td><a href="lead-detail.html?id=${l._id}" data-lead-id="${l._id}" class="btn btn--ghost table-action-btn">View</a></td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      tableArea.querySelectorAll('[data-lead-id]').forEach(a=>a.addEventListener('click',()=>{
        try{sessionStorage.setItem('lastLeadId',a.dataset.leadId)}catch(e){}
      }));

      pagination.innerHTML=`
        <button id="prevPage" ${data.page<=1?'disabled':''}>Prev</button>
        <span>Page ${data.page} of ${data.totalPages} (${data.total} total)</span>
        <button id="nextPage" ${data.page>=data.totalPages?'disabled':''}>Next</button>`;
      document.getElementById('prevPage')?.addEventListener('click',()=>{state.page--;load()});
      document.getElementById('nextPage')?.addEventListener('click',()=>{state.page++;load()});
    }catch(err){
      tableArea.innerHTML=`<div class="banner banner--error">Could not load leads (${err.message}).</div>`;
    }
  }

  function escapeHtml(s){
    const d=document.createElement('div');d.textContent=s;return d.innerHTML;
  }

  let searchTimer;
  searchInput.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{state.search=searchInput.value.trim();state.page=1;load()},350);
  });
  statusFilter.addEventListener('change',()=>{state.status=statusFilter.value;state.page=1;load()});
  paymentFilter.addEventListener('change',()=>{state.paymentStatus=paymentFilter.value;state.page=1;load()});

  load();
}