import {requireSession} from './authGuard.js';
import {renderShell} from './shell.js';
import {api} from './api.js';

function formatPaise(paise,currency){
  const rupees=(paise||0)/100;
  const amount=Number.isInteger(rupees)?String(rupees):rupees.toFixed(2);
  const symbol=currency==='INR'?'₹':(currency||'')+' ';
  return symbol+amount;
}

function stat(label,value,accent){
  return `<div class="stat-card"${accent?` style="--stat-accent:var(${accent})"`:''}>
    <div class="stat-card__label">${label}</div>
    <div class="stat-card__value">${value}</div>
  </div>`;
}

const admin=await requireSession();
if(admin){
  const content=renderShell({activeHref:'dashboard.html',title:'Dashboard',admin});

  content.innerHTML=`
    <div class="card">
      <h2 class="card__title">Overview</h2>
      <div id="statsArea"><div class="empty-state">Loading…</div></div>
    </div>
    <div class="card">
      <h2 class="card__title">Payments</h2>
      <div id="paymentStatsArea"><div class="empty-state">Loading…</div></div>
    </div>`;

  const statsArea=document.getElementById('statsArea');
  const paymentStatsArea=document.getElementById('paymentStatsArea');

  try{
    const metrics=await api.get('/admin/dashboard/stats');

    statsArea.innerHTML=`
      <div class="stat-grid">
        ${stat('Total leads',metrics.totalLeads)}
        ${stat('Paid leads',metrics.paidLeads,'--success')}
        ${stat('Unpaid leads',metrics.unpaidLeads)}
      </div>`;

    paymentStatsArea.innerHTML=`
      <div class="dashboard-section-gap">
        <div class="stat-grid">
          ${stat('Confirmed revenue',formatPaise(metrics.confirmedRevenuePaise,metrics.confirmedRevenueCurrency),'--success')}
          ${stat('Confirmed payments',metrics.confirmedPaymentsCount)}
          ${stat('Pending payments',metrics.pendingPayments,'--warn')}
          ${stat('Failed attempts',metrics.failedPaymentAttempts,'--danger')}
        </div>
      </div>
      <p class="stat-note">Revenue counts only confirmed, captured payments — created, pending, failed, cancelled and duplicate attempts are never included.</p>
      <a class="dashboard-link" href="analytics.html">View full Business Analytics →</a>`;
  }catch(err){
    const msg=`<div class="banner banner--error">Could not load dashboard stats right now (${err.message}).</div>`;
    statsArea.innerHTML=msg;
    paymentStatsArea.innerHTML=msg;
  }
}