import {api,ApiError} from './api.js';

const form=document.getElementById('loginForm');
const banner=document.getElementById('banner');
const btn=document.getElementById('loginBtn');

function showBanner(message,type='error'){
  banner.innerHTML=`<div class="banner banner--${type}">${message}</div>`;
}

// If already logged in, skip straight past the login screen.
api.get('/admin/auth/me').then(()=>{location.href='dashboard.html'}).catch(()=>{/* not logged in, stay here */});

form.addEventListener('submit',async(e)=>{
  e.preventDefault();
  banner.innerHTML='';
  const username=form.username.value.trim();
  const password=form.password.value;
  if(!username||!password){showBanner('Enter both your username and password.');return}

  btn.disabled=true;btn.textContent='Signing in…';
  try{
    await api.post('/admin/auth/login',{username,password});
    const redirectTo=sessionStorage.getItem('hwa_redirect_after_login')||'dashboard.html';
    sessionStorage.removeItem('hwa_redirect_after_login');
    location.href=redirectTo;
  }catch(err){
    if(err instanceof ApiError&&err.code==='ACCOUNT_LOCKED'){
      showBanner('This account is temporarily locked after repeated failed attempts. Try again later.');
    }else if(err instanceof ApiError&&err.code==='INVALID_CREDENTIALS'){
      showBanner('Incorrect username or password.');
    }else{
      showBanner(err.message||'Something went wrong. Please try again.');
    }
    btn.disabled=false;btn.textContent='Log in';
  }
});
