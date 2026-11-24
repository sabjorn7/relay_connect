import { validateFile } from './chatAttachments.js';
export const CLUB_ATTACHMENT_BUCKET = 'club-chat-private';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function attachmentPath(club,uid,id,ext){
    if(![club,uid,id].every(x=>UUID.test(x||''))||!/^\w{2,5}$/.test(ext))throw Error('invalid_attachment');
    return `${club}/${uid}/${id}.${ext}`;
}
export async function clubAttachmentsEnabled(sb,club){
    if(!UUID.test(club||''))return false;
    try{const {data,error}=await sb.rpc('club_chat_capabilities',{p_club:club});return !error&&data?.attachments===true;}catch{return false}
}
export function prepareClubAttachment(file,club,uid){
    const v=validateFile(file);if(!v.ok)throw Error(v.error);
    const id=crypto.randomUUID();return {file,club,uid,id,path:attachmentPath(club,uid,id,v.ext),kind:v.kind,mime:v.mime,uploaded:false};
}
export async function sendClubAttachment(sb,item,current){
    if(!current(item.uid))throw Error('session_changed');
    if(!await clubAttachmentsEnabled(sb,item.club))throw Error('attachments_disabled');
    if(!current(item.uid))throw Error('session_changed');
    if(!item.uploaded){
        const {error}=await sb.storage.from(CLUB_ATTACHMENT_BUCKET).upload(item.path,item.file,{upsert:false,contentType:item.mime});
        // UUID remains stable across a retry whose first HTTP response was lost.
        if(error&&String(error.statusCode||error.status)!=='409')throw Error('upload_failed');
        item.uploaded=true;
    }
    if(!current(item.uid))throw Error('session_changed');
    const {data,error}=await sb.rpc('club_chat_send_attachment',{p_club:item.club,p_request_id:item.id,p_path:item.path,p_kind:item.kind,p_name:item.file.name.slice(0,240),p_size:item.file.size});
    if(error)throw Error('send_failed');return data;
}
export async function clubAttachmentUrl(sb,path){
    if(typeof path!=='string'||!/^([0-9a-f-]{36}\/){2}[0-9a-f-]{36}\.\w{2,5}$/i.test(path))throw Error('invalid_path');
    const {data,error}=await sb.storage.from(CLUB_ATTACHMENT_BUCKET).createSignedUrl(path,60);
    if(error||!data?.signedUrl)throw Error('attachment_unavailable');
    const url=new URL(data.signedUrl,location.origin);if(!['https:','http:'].includes(url.protocol))throw Error('invalid_url');
    return url.href;
}
