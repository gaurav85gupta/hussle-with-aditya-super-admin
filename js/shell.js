import {logout} from './authGuard.js';

const NAV=[
  {href:'dashboard.html',label:'Dashboard',icon:'📊'},
  {href:'analytics.html',label:'Analytics',icon:'📈'},
  {href:'settings.html',label:'Membership Settings',icon:'💳'},
  {href:'leads.html',label:'Leads',icon:'📋'},
  {href:'testimonials.html',label:'Testimonials',icon:'🎬'},
  {href:'export-center.html',label:'Export Center',icon:'⤓'},
];

const MENU_ICON='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

export function renderShell({activeHref,title,admin}){
  const root=document.getElementById('app');
  const navHtml=NAV.map(n=>`<a class="sidebar__link${n.href===activeHref?' is-active':''}" href="${n.href}"><span aria-hidden="true">${n.icon}</span> ${n.label}</a>`).join('');
  root.innerHTML=`
  <div class="app-shell">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <button class="sidebar__close" id="navClose" type="button" aria-label="Close menu">&times;</button>
      <div class="sidebar__brand">HUSTLE ADMIN</div>
      <nav class="sidebar__nav">${navHtml}</nav>
      <div class="sidebar__footer">${admin?(admin.username||admin.email||''):''}</div>
    </aside>
    <div class="nav-backdrop" id="navBackdrop"></div>
    <main class="main">
      <div class="topbar">
        <div class="topbar__left">
          <button class="nav-toggle" id="navToggle" type="button" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${MENU_ICON}</button>
          <h1>${title}</h1>
        </div>
        <button class="btn-logout" id="logoutBtn" type="button">Log out</button>
      </div>
      <div id="pageContent"></div>
    </main>
  </div>`;
  document.getElementById('logoutBtn').addEventListener('click',logout);
  setupMobileNav(root);
  return document.getElementById('pageContent');
}

/* On phones/tablets (<=820px) the sidebar becomes a slide-in drawer opened by
   the menu button. On wider screens it is a normal fixed side column. */
function setupMobileNav(root){
  const toggle=root.querySelector('#navToggle');
  const closeBtn=root.querySelector('#navClose');
  const backdrop=root.querySelector('#navBackdrop');
  const sidebar=root.querySelector('#sidebar');
  const main=root.querySelector('.main');
  const mobile=window.matchMedia('(max-width: 820px)');

  function setOpen(open,{restoreFocus=true}={}){
    if(open&&!mobile.matches)return;
    document.body.classList.toggle('nav-open',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close menu':'Open menu');
    main.inert=open; // keep keyboard focus inside the drawer while it is open (ignored by very old browsers)
    if(open)closeBtn.focus({preventScroll:true});
    else if(restoreFocus)toggle.focus({preventScroll:true});
  }

  toggle.addEventListener('click',()=>setOpen(!document.body.classList.contains('nav-open')));
  closeBtn.addEventListener('click',()=>setOpen(false));
  backdrop.addEventListener('click',()=>setOpen(false,{restoreFocus:false}));
  sidebar.addEventListener('click',e=>{if(e.target.closest('.sidebar__link'))setOpen(false,{restoreFocus:false})});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('nav-open'))setOpen(false)});

  const onChange=()=>{if(!mobile.matches)setOpen(false,{restoreFocus:false})};
  if(mobile.addEventListener)mobile.addEventListener('change',onChange);
  else if(mobile.addListener)mobile.addListener(onChange);
}
