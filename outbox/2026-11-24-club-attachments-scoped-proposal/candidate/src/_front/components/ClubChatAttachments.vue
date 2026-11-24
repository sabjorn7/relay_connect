<template>
    <div v-if="enabled" class="club-attachments">
        <input ref="picker" type="file" :accept="ACCEPT_ATTR" hidden @change="pick" />
        <button type="button" :disabled="busy || recording || requesting || !!pending" @click="picker.click()">Прикрепить файл</button>
        <button v-if="audioSupported && !recording" type="button" :disabled="busy || requesting || !!pending" @click="start">Записать голосовое</button>
        <template v-if="recording"><span role="status">Идёт запись</span><button type="button" @click="stop(false)">Стоп</button><button type="button" @click="stop(true)">Отмена</button></template>
        <div v-if="pending">
            <VoiceMessagePlayer v-if="preview" :src="preview" />
            <span v-else>{{ pending.file.name }} · {{ formatBytes(pending.file.size) }}</span>
            <button type="button" :disabled="busy" @click="send">{{ busy ? 'Отправка…' : 'Отправить вложение' }}</button>
            <button type="button" :disabled="busy" @click="clear">Убрать</button>
        </div>
        <p v-if="error" role="alert">{{ error }}</p>
    </div>
</template>
<script setup>
// Add-on to the existing club composer, not a new chat or a replacement send workflow.
import {computed,inject,ref,onMounted,onBeforeUnmount,watch} from 'vue';
import {getSupabase,readStoredSession} from '../chrome/headerAccount.js';
import {ACCEPT_ATTR,formatBytes,pickAudioFormat,audioRecordingSupported} from '../helpers/chatAttachments.js';
import {encodeBlobToMp3} from '../helpers/mp3Encode.js';
import {clubAttachmentsEnabled,prepareClubAttachment,sendClubAttachment} from '../helpers/clubAttachments.js';
import VoiceMessagePlayer from './VoiceMessagePlayer.vue';
const ctx=inject('_wwLibraryComponentContext',null);
const club=computed(()=>ctx?.component?.variables?.['14d34912-0442-4607-9311-5c9590247a28']?.club?.id);
const picker=ref(null),enabled=ref(false),pending=ref(null),preview=ref(''),busy=ref(false),recording=ref(false),requesting=ref(false),error=ref('');
const audioSupported=audioRecordingSupported();let recorder,stream,timeout,rev=0,dead=false,cancelled=false;
const current=uid=>!dead&&readStoredSession()?.user?.id===uid;
function clear(){if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';pending.value=null;error.value=''}
function select(file){clear();const uid=readStoredSession()?.user?.id;try{pending.value=prepareClubAttachment(file,club.value,uid);if(pending.value.kind==='audio')preview.value=URL.createObjectURL(file)}catch(e){error.value=e.message}}
function pick(e){const file=e.target.files?.[0];e.target.value='';if(file)select(file)}
function cleanup(){clearTimeout(timeout);stream?.getTracks().forEach(t=>t.stop());stream=null;recording.value=false}
function stop(cancel){cancelled=cancel;if(recorder?.state==='recording')recorder.stop();else cleanup()}
async function start(){if(busy.value||recording.value||requesting.value||pending.value)return;const generation=++rev,uid=readStoredSession()?.user?.id;const fmt=pickAudioFormat();if(!uid||!fmt)return;error.value='';requesting.value=true;
 try{const captured=await navigator.mediaDevices.getUserMedia({audio:true});if(dead||generation!==rev||!current(uid)){captured.getTracks().forEach(t=>t.stop());return}stream=captured;const chunks=[];cancelled=false;recorder=new MediaRecorder(stream,{mimeType:fmt.mimeType});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 recorder.onstop=async()=>{cleanup();if(cancelled||dead||generation!==rev||!current(uid))return;if(!chunks.length){error.value='Запись пуста. Попробуйте записать ещё раз.';return}busy.value=true;const blob=new Blob(chunks,{type:fmt.mimeType});let file;try{file=new File([await encodeBlobToMp3(blob)],'voice-message.mp3',{type:'audio/mpeg'})}catch{file=new File([blob],`voice-message.${fmt.ext}`,{type:fmt.mimeType})}finally{busy.value=false}if(!dead&&generation===rev&&current(uid))select(file)};
 recorder.start();recording.value=true;timeout=setTimeout(()=>stop(false),300000);
 }catch{cleanup();error.value='Не удалось начать запись. Проверьте микрофон и разрешение браузера.'}finally{requesting.value=false}}
async function send(){const item=pending.value;if(!item||busy.value)return;busy.value=true;error.value='';try{await sendClubAttachment(getSupabase(),item,current);if(current(item.uid)&&club.value===item.club){clear();await ctx?.component?.methods?.executeWorkflow('b9817663-75ec-436b-b985-ac4399e3fd9f')}}catch{if(!dead)error.value='Не удалось отправить. Вложение сохранено для повторной попытки.'}finally{busy.value=false}}
async function capability(){enabled.value=false;const generation=++rev;const result=await clubAttachmentsEnabled(getSupabase(),club.value);if(!dead&&generation===rev)enabled.value=result}
watch(()=>readStoredSession()?.user?.id,()=>{rev++;stop(true);clear();enabled.value=false;if(readStoredSession()?.user?.id)capability()});
watch(club,()=>{rev++;stop(true);clear();capability()});onMounted(capability);onBeforeUnmount(()=>{dead=true;rev++;stop(true);cleanup();clear()});
</script>
<style scoped>.club-attachments{padding:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff;border-top:1px solid #e4e9f1;font-family:inherit}.club-attachments button{font:inherit;color:#1f5fc9;background:#f1f6fd;border:1px solid #e4e9f1;border-radius:12px;padding:9px 12px;cursor:pointer}.club-attachments button:disabled{opacity:.5;cursor:default}.club-attachments>div{width:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.club-attachments p{color:#a82b38;margin:0}</style>
