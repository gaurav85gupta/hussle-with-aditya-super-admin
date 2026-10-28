/* Thin fetch wrapper for the Super Admin SPA.
   - Always sends credentials (cookie-based session).
   - Reads the CSRF token from the non-HttpOnly csrf cookie and attaches it
     to every state-changing request, matching server/src/middleware/csrf.js.
   - Never assumes success: always checks response.ok and the `success` flag. */
export const API_BASE_URL='https://hussle-with-aditya.onrender.com/api';

/* The API lives on a different site than this SPA, so the browser will not let
   this page read the API's csrf cookie. The server returns the same token in the
   login / me response body instead; we keep it here for the tab's lifetime. */
const CSRF_STORAGE_KEY='hwa_csrf_token';
function getCsrfToken(){
  try{return sessionStorage.getItem(CSRF_STORAGE_KEY)||readCookie('hwa_csrf')}catch{return readCookie('hwa_csrf')}
}
function setCsrfToken(token){
  try{token?sessionStorage.setItem(CSRF_STORAGE_KEY,token):sessionStorage.removeItem(CSRF_STORAGE_KEY)}catch{/* storage unavailable */}
}

function readCookie(name){
  const match=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));
  return match?decodeURIComponent(match[1]):null;
}

export class ApiError extends Error{
  constructor(message,status,code){super(message);this.status=status;this.code=code}
}

async function request(path,{method='GET',body}={}){
  const headers={'Content-Type':'application/json'};
  if(method!=='GET'){
    const csrf=getCsrfToken();
    if(csrf)headers['X-CSRF-Token']=csrf;
  }
  let res;
  try{
    res=await fetch(API_BASE_URL+path,{method,headers,credentials:'include',body:body?JSON.stringify(body):undefined});
  }catch{
    throw new ApiError('Could not reach the server. Check your connection and try again.',0,'NETWORK_ERROR');
  }
  let payload=null;
  try{payload=await res.json()}catch{/* no body */}
  if(!res.ok||!payload?.success){
    const message=payload?.error?.message||('Request failed with status '+res.status);
    throw new ApiError(message,res.status,payload?.error?.code);
  }
  if(payload.data&&typeof payload.data.csrfToken==='string')setCsrfToken(payload.data.csrfToken);
  if(path==='/admin/auth/logout')setCsrfToken(null);
  return payload.data;
}

export const api={
  get:(path)=>request(path),
  post:(path,body)=>request(path,{method:'POST',body}),
  put:(path,body)=>request(path,{method:'PUT',body}),
  patch:(path,body)=>request(path,{method:'PATCH',body}),
  del:(path)=>request(path,{method:'DELETE'}),
};
