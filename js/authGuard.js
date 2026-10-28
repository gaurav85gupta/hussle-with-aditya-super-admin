import {api,ApiError} from './api.js';

/* Server-side authorization is what actually protects admin endpoints —
   this guard only improves the experience by redirecting an unauthenticated
   visitor to the login page before they see an empty/broken screen. The API
   itself re-checks the session on every request regardless. */
export async function requireSession(){
  try{
    const data=await api.get('/admin/auth/me');
    return data.admin;
  }catch(err){
    if(err instanceof ApiError&&(err.status===401||err.status===0)){
      sessionStorage.setItem('hwa_redirect_after_login',location.pathname);
      location.href='login.html';
      return null;
    }
    throw err;
  }
}

export async function logout(){
  try{await api.post('/admin/auth/logout')}catch{/* best-effort */}
  location.href='login.html';
}
