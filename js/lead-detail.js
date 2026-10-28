import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api,ApiError} from './api.js';

/* Mirrors server/src/models/Lead.js VALID_TRANSITIONS so the UI only offers
   transitions the server will actually accept — the server remains the
   final authority and re-validates independently. */
const VALID_TRANSITIONS={
  new:['contacted','cancelled','spam'],
  contacted:['booked','cancelled','spam'],
  booked:['completed','cancelled'],
  completed:[],
  cancelled:['new'],
  spam:['new'],
};

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function fmtDate(d){return d?new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—'}
function fmtPaise(paise,currency){
  if(paise==null)return'—';
  const rupees=paise/100;
  const amount=Number.isInteger(rupees)?String(rupees):rupees.toFixed(2);
  return(currency==='INR'?'₹':(currency||'')+' ')+amount;
}
const PAYMENT_PILL_CLASS={
  unpaid:'status-pill--payment-unpaid',
  created:'status-pill--payment-pending',
  pending:'status-pill--payment-pending',
  paid:'status-pill--payment-paid',
  failed:'status-pill--payment-failed',
  cancelled:'status-pill--payment-failed',
  expired:'status-pill--payment-failed',
};
function paymentPill(status){
  const s=status||'unpaid';
  return `<span class="status-pill ${PAYMENT_PILL_CLASS[s]||'status-pill--payment-unpaid'}">${s}</span>`;
}
/** Renders the payment summary + attempt-history card. `payment` is the
 * { overallStatus, attempts, paidAttempt, latestAttempt } shape returned by
 * GET /admin/leads/:id (see services/paymentsService.js). Never presents an
 * older failed attempt as the lead's final outcome if a later one paid —
 * overallStatus already encodes that (paid wins if any attempt paid). */
function renderPaymentCard(payment){
  const attempts=payment?.attempts||[];
  const overallStatus=payment?.overallStatus||'unpaid';
  const paid=payment?.paidAttempt||null;

  const summaryRows=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:10px">
      <div><div style="font-size:.78rem;color:var(--text-soft)">Overall status</div><div>${paymentPill(overallStatus)}</div></div>
      <div><div style="font-size:.78rem;color:var(--text-soft)">Confirmed paid amount</div><div>${paid?fmtPaise(paid.capturedAmountPaise??paid.amountPaise,paid.currency):'—'}</div></div>
      <div><div style="font-size:.78rem;color:var(--text-soft)">Razorpay order ID</div><div style="word-break:break-all">${paid?escapeHtml(paid.razorpayOrderId||'—'):'—'}</div></div>
      <div><div style="font-size:.78rem;color:var(--text-soft)">Razorpay payment ID</div><div style="word-break:break-all">${paid?escapeHtml(paid.razorpayPaymentId||'—'):'—'}</div></div>
      <div><div style="font-size:.78rem;color:var(--text-soft)">Paid / verified at</div><div>${paid?fmtDate(paid.paidAt):'—'}</div></div>
    </div>`;

  if(!attempts.length){
    return `<div class="card"><h2 class="card__title">Payment</h2>${summaryRows}<p style="color:var(--text-soft)">No payment attempts yet.</p></div>`;
  }

  const historyRows=attempts.map((a,i)=>`
    <tr>
      <td>Attempt ${attempts.length-i}</td>
      <td>${paymentPill(a.status)}</td>
      <td>${fmtPaise(a.amountPaise,a.currency)}</td>
      <td style="word-break:break-all">${escapeHtml(a.razorpayOrderId||'—')}</td>
      <td style="word-break:break-all">${escapeHtml(a.razorpayPaymentId||'—')}</td>
      <td>${fmtDate(a.createdAt)}</td>
      <td>${fmtDate(a.paidAt)}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <h2 class="card__title">Payment</h2>
      ${summaryRows}
      ${attempts.length>1?`<p style="font-size:.85rem;color:var(--text-soft);margin-bottom:10px">This lead has ${attempts.length} payment attempts. Most recent first.</p>`:''}
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Attempt</th><th>Status</th><th>Amount</th><th>Order ID</th><th>Payment ID</th><th>Created</th><th>Paid at</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
    </div>`;
}

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'leads.html',title:'Lead Detail',admin});
  /* Some dev servers (e.g. `serve`) redirect lead-detail.html?id=… to /lead-detail and drop the
     query string, so fall back to the id remembered when the "View" link was clicked. */
  let id=new URLSearchParams(location.search).get('id');
  if(id){try{sessionStorage.setItem('lastLeadId',id)}catch(e){}}
  else{
    try{id=sessionStorage.getItem('lastLeadId')}catch(e){id=null}
    if(id)history.replaceState(null,'','?id='+encodeURIComponent(id));
  }

  if(!id){
    content.innerHTML='<div class="banner banner--error">No lead id was provided.</div>';
  }else{
    content.innerHTML='<div class="empty-state">Loading…</div>';
    await render();
  }

  async function render(){
    let lead;
    try{
      lead=await api.get('/admin/leads/'+encodeURIComponent(id));
    }catch(err){
      const msg=err instanceof ApiError&&err.status===404?'This lead could not be found.':err.message;
      content.innerHTML=`<div class="banner banner--error">${escapeHtml(msg)}</div><a href="leads.html">&larr; Back to leads</a>`;
      return;
    }

    const nextStatuses=VALID_TRANSITIONS[lead.status]||[];

    content.innerHTML=`
      <a href="leads.html" style="display:inline-block;margin-bottom:16px;font-size:.9rem">&larr; Back to leads</a>
      <div class="card">
        <h2 class="card__title">${escapeHtml(lead.name)} <span class="status-pill status-pill--${lead.status}">${lead.status}</span></h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:10px">
          <div><div style="font-size:.78rem;color:var(--text-soft)">Age</div><div>${lead.age}</div></div>
          <div><div style="font-size:.78rem;color:var(--text-soft)">State</div><div>${escapeHtml(lead.state)}</div></div>
          <div><div style="font-size:.78rem;color:var(--text-soft)">Phone</div><div>${escapeHtml(lead.phone)}</div></div>
          ${lead.email?`<div><div style="font-size:.78rem;color:var(--text-soft)">Email</div><div>${escapeHtml(lead.email)}</div></div>`:''}
          <div><div style="font-size:.78rem;color:var(--text-soft)">Submitted</div><div>${fmtDate(lead.createdAt)}</div></div>
        </div>
        ${lead.reason?`<div style="margin-top:10px">
          <div style="font-size:.78rem;color:var(--text-soft);margin-bottom:4px">Reason</div>
          <p style="white-space:pre-wrap">${escapeHtml(lead.reason)}</p>
        </div>`:''}
      </div>

      ${renderPaymentCard(lead.payment)}

      <div class="card">
        <h2 class="card__title">Update status</h2>
        <div id="statusBanner"></div>
        ${nextStatuses.length?`
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${nextStatuses.map(s=>`<button class="btn btn--ghost" data-status="${s}">Mark as ${s}</button>`).join('')}
          </div>`:'<p style="color:var(--text-soft)">This lead has no further status changes available.</p>'}
      </div>

      <div class="card">
        <h2 class="card__title">Internal notes</h2>
        <div id="notesBanner"></div>
        ${lead.internalNotes?.length?`
          <ul style="list-style:none;padding:0;margin:0 0 16px">
            ${lead.internalNotes.map(n=>`<li style="padding:10px 0;border-bottom:1px solid var(--border)">
              <div>${escapeHtml(n.text)}</div>
              <div style="font-size:.78rem;color:var(--text-soft);margin-top:4px">${fmtDate(n.addedAt)}</div>
            </li>`).join('')}
          </ul>`:'<p style="color:var(--text-soft)">No notes yet.</p>'}
        <form id="noteForm">
          <div class="field">
            <label for="noteText">Add a note</label>
            <textarea id="noteText" rows="3" maxlength="2000" required></textarea>
          </div>
          <button class="btn btn--primary" type="submit">Add note</button>
        </form>
      </div>`;

    content.querySelectorAll('[data-status]').forEach((btn)=>{
      btn.addEventListener('click',async()=>{
        const banner=document.getElementById('statusBanner');
        banner.innerHTML='';
        btn.disabled=true;
        try{
          await api.patch('/admin/leads/'+encodeURIComponent(id)+'/status',{status:btn.dataset.status});
          await render();
        }catch(err){
          banner.innerHTML=`<div class="banner banner--error">${escapeHtml(err.message)}</div>`;
          btn.disabled=false;
        }
      });
    });

    document.getElementById('noteForm').addEventListener('submit',async(e)=>{
      e.preventDefault();
      const banner=document.getElementById('notesBanner');
      const text=document.getElementById('noteText').value.trim();
      banner.innerHTML='';
      if(!text)return;
      try{
        await api.post('/admin/leads/'+encodeURIComponent(id)+'/notes',{text});
        await render();
      }catch(err){
        banner.innerHTML=`<div class="banner banner--error">${escapeHtml(err.message)}</div>`;
      }
    });
  }
}