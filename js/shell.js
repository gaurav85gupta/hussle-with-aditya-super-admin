import {logout} from './authGuard.js';

const NAV=[
  {href:'dashboard.html',label:'Dashboard',icon:'📊'},
  {href:'analytics.html',label:'Analytics',icon:'📈'},
  {href:'settings.html',label:'Membership Settings',icon:'💳'},
  {href:'leads.html',label:'Leads',icon:'📋'},
  {href:'testimonials.html',label:'Testimonials',icon:'🎬'},
  {href:'export-center.html',label:'Export Center',icon:'⤓'},
];

export function renderShell({activeHref,title,admin}){
  const root=document.getElementById('app');
  const navHtml=NAV.map(n=>`<a class="sidebar__link${n.href===activeHref?' is-active':''}" href="${n.href}"><span aria-hidden="true">${n.icon}</span> ${n.label}</a>`).join('');
  root.innerHTML=`
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar__brand">HUSSLE ADMIN</div>
      <nav class="sidebar__nav">${navHtml}</nav>
      <div class="sidebar__footer">${admin?admin.email:''}</div>
    </aside>
    <main class="main">
      <div class="topbar">
        <h1>${title}</h1>
        <button class="btn-logout" id="logoutBtn" type="button">Log out</button>
      </div>
      <div id="pageContent"></div>
    </main>
  </div>`;
  document.getElementById('logoutBtn').addEventListener('click',logout);
  return document.getElementById('pageContent');
}
