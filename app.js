(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = window.POCKETCAM_CONFIG || {};
  const DEVICE_KEY = 'pocketcam.device.id.v3';
  const HISTORY_KEY = 'pocketcam.history.v3';
  const PAGES = ['home','studio','pairing','messages','admin','history','about','contact','signin','signup','reset-password'];
  const state = {
    db:null, user:null, channel:null, channelReady:false, channelUserId:null,
    deviceId:loadDeviceId(), device:'phone', role:'sender', ready:false,
    localStream:null, peerConnections:new Map(), pendingIce:new Map(),
    requestedTargets:new Set(), offerTargets:new Set(), connectedTo:null,
    remoteStream:null, previewMuted:true, previousStats:null, statsTimer:null,
    recorder:null, recordChunks:[], history:[], currentPage:'home', authBusy:false, conversations:[], activeConversation:null, messageChannel:null, messageSubscription:null, isAdmin:false
  };

  function loadDeviceId(){
    try { let value=localStorage.getItem(DEVICE_KEY); if(!value){value=crypto.randomUUID();localStorage.setItem(DEVICE_KEY,value);} return value; }
    catch { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(16).slice(2)); }
  }
  function esc(value){return String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function toast(message){const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3400);}
  function setPage(page){if(!PAGES.includes(page))page='home';state.currentPage=page;document.querySelectorAll('[data-pageview]').forEach(el=>el.classList.toggle('active',el.dataset.pageview===page));document.querySelectorAll('.nav-btn[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});if(page==='history')renderHistory();if(page==='studio')renderDevices();if(page==='pairing')loadPairLinks();if(page==='messages')loadConversations();if(page==='admin')loadAdmin();}
  function setStatus(message,kind=''){const el=$('status');if(!el)return;el.textContent=message;el.className='status'+(kind?' '+kind:'');}
  function setTop(text,live=false){const el=$('topState');if(el){el.textContent=text;el.classList.toggle('live',live);}}
  function setStreamState(text,live=false){const el=$('streamState');if(el){el.textContent=text;el.classList.toggle('live',live);}}
  function configReady(){return !!(window.supabase&&cfg.supabaseUrl&&cfg.supabaseKey&&!String(cfg.supabaseUrl).includes('YOUR_PROJECT')&&!String(cfg.supabaseKey).includes('YOUR_SUPABASE'))}
  function updateAuthUI(){
    const signed=!!state.user;const nav=$('authNav');
    if(nav){nav.textContent=signed?'Sign out':'Sign in';nav.dataset.action=signed?'signout':'';nav.dataset.page=signed?'studio':'signin';nav.title=signed?'Sign out of PocketCam':'Sign in to PocketCam';}
    const n=$('accountName'),e=$('accountEmail'),action=$('studioAuthAction');
    if(n)n.textContent=signed?(state.user.user_metadata?.display_name||state.user.email?.split('@')[0]||'PocketCam account'):'Not signed in';
    if(e)e.textContent=signed?state.user.email:'Sign in to discover your devices.';
    if(action){action.textContent=signed?'Account ready':'Sign in';action.disabled=signed;action.classList.toggle('hidden',signed);}
    const warning=document.querySelector('.auth-config-warning');if(warning)warning.classList.toggle('hidden',configReady());
  }
  function showFormStatus(id,message,kind=''){const el=$(id);if(!el)return;el.textContent=message;el.className='status form-message'+(kind?' '+kind:'');el.classList.remove('hidden');}
  function getDeviceName(){const typed=$('deviceName')?.value.trim();if(typed)return typed.slice(0,48);const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);return (state.device==='phone'||mobile?'Phone':'Computer')+' · '+(navigator.userAgent.includes('Edg')?'Edge':navigator.userAgent.includes('Firefox')?'Firefox':navigator.userAgent.includes('Chrome')?'Chrome':'Browser');}
  function accountTopic(){return state.user?`pocketcam-account:${state.user.id}`:null;}
  function onlineDevices(){
    if(!state.channel)return [];
    const merged=new Map();
    try{const snapshot=state.channel.presenceState();for(const [key,metas] of Object.entries(snapshot)){for(const meta of metas||[]){const id=meta.deviceId||key;if(!id||id===state.deviceId)continue;merged.set(id,{...meta,deviceId:id});}}}catch{}
    return [...merged.values()].sort((a,b)=>Number(!!b.ready)-Number(!!a.ready));
  }
  function renderDevices(){
    const wrap=$('deviceList');if(!wrap)return;
    if(!state.user){wrap.innerHTML='<div class="device-empty">Sign in to see your other PocketCam devices. Your account channel is private.</div>';return;}
    if(!state.channelReady){wrap.innerHTML='<div class="device-empty">Connecting to your private device network…</div>';return;}
    const devices=onlineDevices();
    if(!devices.length){wrap.innerHTML='<div class="device-empty">No other devices online yet. Open PocketCam on your phone or computer and sign in with this same account. They will appear here automatically.</div>';return;}
    wrap.replaceChildren();
    devices.forEach((d,i)=>{
      const card=document.createElement('div');card.className='device-card';card.style.animationDelay=(Math.min(i,8)*45)+'ms';
      const avatar=document.createElement('div');avatar.className='device-avatar';avatar.textContent=d.deviceType==='phone'?'📱':'▣';
      const main=document.createElement('div');main.className='device-main';
      const strong=document.createElement('strong');strong.textContent=d.deviceName||((d.deviceType==='phone'?'Phone':'Computer')+' device');
      const small=document.createElement('small');small.textContent=(d.role==='sender'?'Camera sender':'Stream receiver')+' · '+(d.ready?(d.cameraReady?'Camera ready':'Ready to receive'):'Online, not active');
      const status=document.createElement('span');status.className='device-state'+(d.ready?' ready':'');status.textContent=d.ready?'Available':'Signed in';
      main.append(strong,small,status);
      const button=document.createElement('button');button.type='button';button.className='btn small secondary device-action';button.textContent=state.role==='receiver'?'Request stream':'Connect';
      const canCurrentSend=state.role==='sender'&&!!state.localStream&&state.ready;
      const canCurrentReceive=state.role==='receiver'&&state.ready;
      const compatible=d.ready && ((canCurrentSend&&d.role==='receiver')||(canCurrentReceive&&d.role==='sender'&&d.cameraReady));
      button.disabled=!compatible||!state.channelReady;
      if(!d.ready)button.title='This device is signed in but not ready to stream';
      if(state.peerConnections.has(d.deviceId))button.textContent='Connected';
      button.addEventListener('click',()=>connectToDevice(d.deviceId));
      card.append(avatar,main,button);wrap.append(card);
    });
  }
  async function connectToDevice(targetId){
    if(!state.user||!state.channelReady){toast('Sign in and connect to the account network first.');return;}
    if(state.role==='sender'){
      if(!state.localStream||!state.ready){toast('Start your camera first.');return;}
      await createOffer(targetId);
    }else{
      if(!state.ready){toast('Enable View stream first.');return;}
      state.requestedTargets.add(targetId);
      try{await sendSignal(targetId,{type:'connect-request',fromName:getDeviceName()});setStatus('Connection requested. Accepting the stream when the sender responds…','good');}
      catch(e){setStatus('Could not request the stream: '+e.message,'bad');}
    }
    renderDevices();
  }
  async function refreshPresence(){
    if(!state.channel||!state.channelReady||!state.user)return;
    try{
      await state.channel.track({deviceId:state.deviceId,deviceName:getDeviceName(),deviceType:state.device,role:state.role,ready:state.ready,cameraReady:!!state.localStream,userId:state.user.id,updatedAt:new Date().toISOString()});
      renderDevices();
    }catch(error){console.warn('Presence update failed',error);}
  }
  async function joinAccountChannel(session){
    if(!state.db||!session?.user)return;
    if(state.channel&&state.channelUserId===session.user.id&&state.channelReady){await refreshPresence();return;}
    await leaveAccountChannel();
    state.channelUserId=session.user.id;
    try{await state.db.realtime.setAuth(session.access_token);}catch{}
    const channel=state.db.channel(accountTopic(),{config:{private:true,presence:{key:state.deviceId},broadcast:{ack:true,self:false}}});
    state.channel=channel;state.channelReady=false;
    channel.on('presence',{event:'sync'},()=>{renderDevices();autoRequestSender();});
    channel.on('presence',{event:'join'},()=>{renderDevices();autoRequestSender();});
    channel.on('presence',{event:'leave'},({key})=>{renderDevices();if(key&&state.peerConnections.has(key))closePeer(key,'The other device went offline.');});
    channel.on('broadcast',{event:'signal'},({payload})=>{if(!payload||payload.to!==state.deviceId||payload.userId!==state.user?.id)return;handleSignal(payload).catch(error=>{console.error(error);setStatus('Connection negotiation failed: '+(error.message||'unknown issue'),'bad');});});
    channel.subscribe(status=>{
      if(state.channel!==channel)return;
      if(status==='SUBSCRIBED'){
        state.channelReady=true;setTop('Account connected',true);setStatus('Private device network connected. Select your role; no room code is needed.','good');refreshPresence();renderDevices();
      }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
        state.channelReady=false;setTop('Network issue');renderDevices();setStatus('Could not join the private account channel. Check config.js, the SQL policies, and the Supabase Realtime settings.','bad');
      }else if(status==='CLOSED'){state.channelReady=false;setTop('Offline');renderDevices();}
    });
  }
  async function leaveAccountChannel(){
    state.channelReady=false;
    if(state.channel){const ch=state.channel;state.channel=null;try{await state.db?.removeChannel(ch);}catch{}}
    state.channelUserId=null;
  }
  async function handleSession(session){
    const newUser=session?.user||null;
    if(!newUser){if(state.user){await stopSession(false);await leaveAccountChannel();}state.user=null;updateAuthUI();renderDevices();setTop('Offline');return;}
    const changed=state.user?.id!==newUser.id;state.user=newUser;updateAuthUI();
    if(changed||!state.channel)await joinAccountChannel(session);
  }
  async function sendSignal(to,payload){
    if(!state.channel||!state.channelReady||!state.user)throw new Error('Account signaling is not connected.');
    const result=await state.channel.send({type:'broadcast',event:'signal',payload:{...payload,from:state.deviceId,to,userId:state.user.id,fromName:getDeviceName(),sentAt:Date.now()}});
    if(result?.status&&result.status!=='ok')throw new Error('Signaling delivery status: '+result.status);
  }
  function iceServers(){const base=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}];return Array.isArray(cfg.iceServers)?base.concat(cfg.iceServers):base;}
  function createPeer(targetId){
    const old=state.peerConnections.get(targetId);if(old){try{old.close();}catch{}}
    const pc=new RTCPeerConnection({iceServers:iceServers()});state.peerConnections.set(targetId,pc);
    pc.onicecandidate=event=>{if(event.candidate)sendSignal(targetId,{type:'ice',candidate:event.candidate.toJSON?event.candidate.toJSON():event.candidate}).catch(()=>{});};
    pc.ontrack=event=>{if(state.role==='receiver'){const stream=event.streams?.[0]||streamFromTrack(event.track);state.remoteStream=stream;showRemoteStream(stream);}};
    pc.onconnectionstatechange=()=>{
      const connection=pc.connectionState;
      if(connection==='connected'){
        state.connectedTo=targetId;state.requestedTargets.clear();if(!state.historyLoggedTargets.has(targetId)){state.historyLoggedTargets.add(targetId);const deviceLabel=onlineDevices().find(d=>d.deviceId===targetId)?.deviceName||'account device';addHistory('Connected to '+deviceLabel,'Account device · '+state.role);}setStreamState('Live connection',true);$('connectionMetric').textContent='Connected';$('qualityMetric').textContent='Measuring…';setStatus('Connected to '+(onlineDevices().find(d=>d.deviceId===targetId)?.deviceName||'your device')+'. Media is flowing over WebRTC.','good');renderDevices();startStats();
      }else if(connection==='disconnected'){
        $('connectionMetric').textContent='Reconnecting';setStreamState('Reconnecting');setStatus('Network changed. Waiting for the media connection to recover…','warn');
      }else if(connection==='failed'||connection==='closed'){
        if(state.peerConnections.get(targetId)===pc)state.peerConnections.delete(targetId);
        state.offerTargets.delete(targetId);state.connectedTo=null;
        if(state.role==='receiver'&&state.ready)state.requestedTargets.delete(targetId);
        if(state.peerConnections.size===0){$('connectionMetric').textContent='Waiting';setStreamState('Waiting for stream');}
        renderDevices();if(state.role==='receiver'&&state.ready)setTimeout(autoRequestSender,350);
      }
    };
    return pc;
  }
  function streamFromTrack(track){const s=new MediaStream();s.addTrack(track);return s;}
  async function createOffer(targetId){
    if(state.role!=='sender'||!state.localStream||!state.ready||state.offerTargets.has(targetId)||state.peerConnections.get(targetId)?.connectionState==='connected')return;
    state.offerTargets.add(targetId);setStatus('Connecting to the selected device…');
    try{
      const pc=createPeer(targetId);state.localStream.getTracks().forEach(track=>pc.addTrack(track,state.localStream));
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal(targetId,{type:'offer',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
      $('connectionMetric').textContent='Negotiating';setStreamState('Calling');
    }catch(error){state.offerTargets.delete(targetId);closePeer(targetId,'Could not start connection.');setStatus('Could not connect to device: '+(error.message||error),'bad');}
  }
  async function addPendingIce(targetId,pc){const queue=state.pendingIce.get(targetId)||[];state.pendingIce.delete(targetId);for(const candidate of queue){try{await pc.addIceCandidate(new RTCIceCandidate(candidate));}catch(error){console.warn('Skipping ICE candidate',error);}}}
  async function handleSignal(message){
    const from=message.from;if(!from||from===state.deviceId)return;
    if(message.type==='connect-request'){
      if(state.role==='sender'&&state.ready&&state.localStream)await createOffer(from);
      return;
    }
    if(message.type==='offer'){
      if(state.role!=='receiver'||!state.ready){return;}
      const pc=createPeer(from);state.connectedTo=from;
      await pc.setRemoteDescription(new RTCSessionDescription(message.description));await addPendingIce(from,pc);
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendSignal(from,{type:'answer',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
      setStatus('Sender found. Negotiating secure media connection…','good');$('connectionMetric').textContent='Negotiating';setStreamState('Connecting');return;
    }
    if(message.type==='answer'){
      const pc=state.peerConnections.get(from);if(pc&&!pc.remoteDescription){await pc.setRemoteDescription(new RTCSessionDescription(message.description));await addPendingIce(from,pc);}return;
    }
    if(message.type==='ice'){
      const pc=state.peerConnections.get(from);if(!pc||!pc.remoteDescription){const queue=state.pendingIce.get(from)||[];queue.push(message.candidate);state.pendingIce.set(from,queue);return;}
      try{await pc.addIceCandidate(new RTCIceCandidate(message.candidate));}catch(error){console.warn('ICE candidate was not accepted',error);}return;
    }
    if(message.type==='bye'){closePeer(from,'The other device ended the stream.');}
  }
  function autoRequestSender(){
    if(!state.ready||state.role!=='receiver'||!state.channelReady||state.peerConnections.size>0)return;
    const candidate=onlineDevices().find(d=>d.role==='sender'&&d.ready&&d.cameraReady&&!state.requestedTargets.has(d.deviceId));
    if(!candidate)return;
    state.requestedTargets.add(candidate.deviceId);
    sendSignal(candidate.deviceId,{type:'connect-request',fromName:getDeviceName()}).then(()=>{setStatus('Found '+(candidate.deviceName||'your camera device')+'. Connecting automatically…','good');}).catch(error=>{state.requestedTargets.delete(candidate.deviceId);setStatus('Could not contact camera device: '+error.message,'warn');});
  }
  function closePeer(targetId,reason){
    const pc=state.peerConnections.get(targetId);if(pc){state.peerConnections.delete(targetId);try{pc.close();}catch{}}
    state.offerTargets.delete(targetId);state.pendingIce.delete(targetId);state.requestedTargets.delete(targetId);if(state.connectedTo===targetId)state.connectedTo=null;
    if(state.role==='receiver'&&state.peerConnections.size===0){state.remoteStream=null;$('previewVideo').srcObject=null;$('previewVideo').classList.add('hidden');$('previewEmpty').classList.remove('hidden');$('toggleMute').disabled=true;$('snapshot').disabled=true;$('recordClip').disabled=true;$('pip').disabled=true;setStreamState('No signal');$('videoTag').textContent='STANDBY / NO SIGNAL';$('connectionMetric').textContent='Waiting';}
    if(reason)setStatus(reason,'warn');renderDevices();
  }
  async function captureCamera(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS and a supported browser. Open the GitHub Pages HTTPS address.');
    const resolution=Number($('quality').value)||720;const shape=$('captureOrientation').value;const frameRate=Number($('frameRate').value)||30;
    let width=resolution,height=Math.round(resolution*9/16);if(shape==='portrait'){width=Math.round(resolution*9/16);height=resolution;}else if(shape==='square'){width=resolution;height=resolution;}
    const video={width:{ideal:width},height:{ideal:height},frameRate:{ideal:frameRate,max:frameRate}};
    if($('cameraDevice').value)video.deviceId={exact:$('cameraDevice').value};else if($('cameraFacing').value!=='default')video.facingMode={ideal:$('cameraFacing').value};
    const audio=$('audio').checked?{echoCancellation:true,noiseSuppression:true,autoGainControl:true}:false;
    const stream=await navigator.mediaDevices.getUserMedia({video,audio});
    const track=stream.getVideoTracks()[0];if(track?.applyConstraints&&track?.getCapabilities){try{const caps=track.getCapabilities();if(Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch{}}
    state.localStream=stream;showLocalPreview(stream);await populateCameras();return stream;
  }
  function showLocalPreview(stream){const video=$('previewVideo');video.srcObject=stream;video.muted=true;video.classList.remove('hidden');$('previewEmpty').classList.add('hidden');$('videoTag').textContent='LOCAL CAMERA PREVIEW';$('previewSub').textContent='Camera preview on this device';setStreamState('Local preview',true);video.play().catch(()=>{});updateMediaButtons(stream);updateVideoMetrics();}
  function showRemoteStream(stream){const video=$('previewVideo');video.srcObject=stream;video.muted=state.previewMuted;video.classList.remove('hidden');$('previewEmpty').classList.add('hidden');$('videoTag').textContent='LIVE / ACCOUNT LINKED';$('previewSub').textContent='Receiving live camera and microphone';setStreamState('Receiving stream',true);video.play().catch(()=>{setStatus('Stream received. Tap Unmute audio or play if the browser blocked autoplay.','warn');});updateMediaButtons(stream);updateVideoMetrics();}
  function activeStream(){return state.role==='sender'?state.localStream:state.remoteStream;}
  function updateMediaButtons(stream){const v=stream?.getVideoTracks?.().length>0,a=stream?.getAudioTracks?.().length>0;$('toggleMute').disabled=!a||state.role==='sender';$('toggleMute').textContent=state.previewMuted?'Unmute audio':'Mute audio';$('snapshot').disabled=!v;$('recordClip').disabled=!v;$('pip').disabled=!v||!document.pictureInPictureEnabled;$('audioMetric').textContent=a?'Available':'No audio track';$('cameraInfo').textContent=state.role==='sender'?'Local camera · permission-controlled':'Remote camera · peer-to-peer media';}
  function updateVideoMetrics(){const video=$('previewVideo');if(video.videoWidth&&video.videoHeight)$('resolutionMetric').textContent=video.videoWidth+'×'+video.videoHeight;else if(activeStream()?.getVideoTracks().length)$('resolutionMetric').textContent='Negotiating';else $('resolutionMetric').textContent='—';}
  async function populateCameras(){if(!navigator.mediaDevices?.enumerateDevices)return;try{const devices=await navigator.mediaDevices.enumerateDevices(),cams=devices.filter(d=>d.kind==='videoinput'),select=$('cameraDevice'),prev=select.value;select.innerHTML='<option value="">Automatic / preferred camera</option>';cams.forEach((d,i)=>{const opt=document.createElement('option');opt.value=d.deviceId;opt.textContent=d.label||`Camera ${i+1}`;select.appendChild(opt);});if(prev&&cams.some(d=>d.deviceId===prev))select.value=prev;}catch{}}
  async function startSession(){
    if(!state.user){setStatus('Please sign in first. Your account unlocks private device discovery.','warn');setPage('signin');return;}
    if(!state.channelReady){setStatus('Connecting to your account network. Check the Supabase setup if this persists.','warn');return;}
    if(state.ready)return;
    $('connect').disabled=true;setTop('Preparing');
    try{
      if(state.role==='sender'){setStatus('Requesting camera and microphone permission…');await captureCamera();}
      else {state.remoteStream=null;setStatus('Receiver enabled. Looking for a camera on your account…');}
      state.ready=true;$('connect').classList.add('hidden');$('disconnect').classList.remove('hidden');
      setTop(state.role==='sender'?'Camera ready':'Receiver ready',true);$('connectionMetric').textContent='Discovering';
      await refreshPresence();setStatus(state.role==='sender'?'Camera is live. Looking for a receiver on the same account…':'Receiver is ready. Searching for an available sender on your account…','good');
      if(state.role==='receiver')autoRequestSender();renderDevices();
    }catch(error){console.error(error);state.ready=false;if(state.localStream){state.localStream.getTracks().forEach(t=>t.stop());state.localStream=null;}setTop('Offline');setStatus('Could not start: '+(error.message||error),'bad');}
    finally{$('connect').disabled=false;}
  }
  async function stopSession(update=true){
    if(state.recorder&&state.recorder.state!=='inactive'){try{state.recorder.stop();}catch{}}
    for(const [id] of state.peerConnections){try{await sendSignal(id,{type:'bye'});}catch{}closePeer(id);}
    state.peerConnections.clear();state.pendingIce.clear();state.offerTargets.clear();state.requestedTargets.clear();state.historyLoggedTargets.clear();state.connectedTo=null;
    if(state.localStream){state.localStream.getTracks().forEach(t=>{try{t.stop();}catch{}});state.localStream=null;}
    state.remoteStream=null;state.ready=false;clearInterval(state.statsTimer);state.statsTimer=null;
    const video=$('previewVideo');video.srcObject=null;video.classList.add('hidden');$('previewEmpty').classList.remove('hidden');video.muted=true;
    $('toggleMute').disabled=true;$('toggleMute').textContent='Unmute audio';$('snapshot').disabled=true;$('recordClip').disabled=true;$('pip').disabled=true;$('resolutionMetric').textContent='—';$('audioMetric').textContent='—';$('qualityMetric').textContent='—';$('connectionMetric').textContent='Offline';setStreamState('No signal');$('videoTag').textContent='STANDBY / NO SIGNAL';$('previewSub').textContent='Waiting for camera feed';
    $('connect').classList.remove('hidden');$('connect').disabled=false;$('disconnect').classList.add('hidden');setTop(state.channelReady?'Account connected':'Offline',state.channelReady);
    if(update){setStatus('Session stopped. Your account is still connected; start again whenever you are ready.');}
    if(state.channelReady)await refreshPresence();renderDevices();
  }
  function setDevice(type){if(state.ready)return;state.device=type;document.querySelectorAll('[data-device]').forEach(b=>b.classList.toggle('active',b.dataset.device===type));refreshPresence();}
  function setRole(role){if(state.ready)return;state.role=role;document.querySelectorAll('[data-role]').forEach(b=>b.classList.toggle('active',b.dataset.role===role));$('senderOptions').classList.toggle('hidden',role!=='sender');$('receiverOptions').classList.toggle('hidden',role!=='receiver');$('connect').textContent=role==='sender'?'Go live & discover devices':'Enable receiver & auto-connect';$('cameraInfo').textContent=role==='sender'?'Local camera · permission-controlled':'Remote camera · peer-to-peer media';refreshPresence();renderDevices();}
  function setAspect(aspect){const frame=$('previewFrame');frame.classList.remove('aspect-landscape','aspect-portrait','aspect-square');frame.classList.add('aspect-'+aspect);document.querySelectorAll('[data-aspect]').forEach(b=>b.classList.toggle('active',b.dataset.aspect===aspect));}
  function setFit(fit){const frame=$('previewFrame');frame.classList.remove('fit-contain','fit-cover');frame.classList.add('fit-'+fit);document.querySelectorAll('[data-fit]').forEach(b=>b.classList.toggle('active',b.dataset.fit===fit));}
  async function toggleFullscreen(){const frame=$('previewFrame');try{if(document.fullscreenElement)await document.exitFullscreen();else if(frame.requestFullscreen)await frame.requestFullscreen();else toast('Fullscreen is unavailable in this browser.');}catch(error){toast('Fullscreen failed: '+error.message);}}
  async function takeSnapshot(){const video=$('previewVideo');if(!video.videoWidth||!video.videoHeight){toast('Wait until a video frame is available.');return;}try{const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not create image');downloadBlob(blob,`pocketcam-${new Date().toISOString().replace(/[:.]/g,'-')}.png`);toast('Snapshot saved.');}catch(error){toast('Snapshot failed: '+error.message);}}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function toggleRecording(){const stream=activeStream();if(!stream){toast('No camera stream is available.');return;}if(state.recorder&&state.recorder.state==='recording'){state.recorder.stop();return;}if(!window.MediaRecorder){toast('Video recording is not supported by this browser.');return;}try{const preferred=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));state.recordChunks=[];state.recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);state.recorder.ondataavailable=e=>{if(e.data&&e.data.size)state.recordChunks.push(e.data);};state.recorder.onstop=()=>{if(state.recordChunks.length){const blob=new Blob(state.recordChunks,{type:state.recorder?.mimeType||'video/webm'});downloadBlob(blob,`pocketcam-clip-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`);$('recordingStatus').textContent='Recording saved to your downloads.';}else $('recordingStatus').textContent='No recording data was captured.';$('recordClip').textContent='Record clip';$('recordClip').classList.remove('danger');};state.recorder.start(1000);$('recordClip').textContent='Stop recording';$('recordClip').classList.add('danger');$('recordingStatus').innerHTML='<span class="recording-indicator">RECORDING</span> This clip is recorded locally in your browser.';}catch(error){toast('Could not record this stream: '+error.message);}}
  async function togglePip(){try{const video=$('previewVideo');if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(video.requestPictureInPicture)await video.requestPictureInPicture();else toast('Picture-in-picture is unavailable.');}catch(error){toast('Picture-in-picture failed: '+error.message);}}
  function startStats(){clearInterval(state.statsTimer);state.statsTimer=setInterval(async()=>{const pcs=[...state.peerConnections.values()];const pc=pcs.find(p=>p.connectionState==='connected')||pcs[0];if(!pc?.getStats)return;try{const stats=await pc.getStats();let pair=null,report=null;for(const r of stats.values()){if(r.type==='candidate-pair'&&r.state==='succeeded'&&(r.nominated||r.selected))pair=r;if((r.type==='inbound-rtp'||r.type==='outbound-rtp')&&(r.kind==='video'||r.mediaType==='video'))report=r;}let quality='Good';if(pair?.currentRoundTripTime>.35)quality='Fair';if(pair?.currentRoundTripTime>.8)quality='Weak';if(report&&typeof report.bytesReceived==='number'&&state.previousStats){const rate=(report.bytesReceived-state.previousStats.bytesReceived)/Math.max(.001,(report.timestamp-state.previousStats.timestamp)/1000)*8/1000;if(rate<180)quality='Weak';else if(rate<550)quality='Fair';}if(report)state.previousStats={bytesReceived:report.bytesReceived||0,timestamp:report.timestamp};$('qualityMetric').textContent=quality;if(pair?.currentRoundTripTime)$('connectionMetric').textContent=Math.round(pair.currentRoundTripTime*1000)+' ms';updateVideoMetrics();}catch{}},2500);}
  function loadHistory(){try{const h=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');state.history=Array.isArray(h)?h.slice(0,30):[];}catch{state.history=[];}}
  function addHistory(label,details){state.history.unshift({label,details,at:new Date().toISOString()});state.history=state.history.slice(0,30);try{localStorage.setItem(HISTORY_KEY,JSON.stringify(state.history));}catch{}renderHistory();}
  function renderHistory(){const el=$('historyList');if(!el)return;if(!state.history.length){el.innerHTML='<div class="history-empty">No sessions recorded on this browser yet.</div>';return;}el.replaceChildren();state.history.forEach(item=>{const row=document.createElement('div');row.className='history-item';const left=document.createElement('div');const strong=document.createElement('strong');strong.textContent=item.label;const small=document.createElement('small');small.textContent=(item.details||'PocketCam session')+' · '+new Date(item.at).toLocaleString();left.append(strong,small);const status=document.createElement('span');status.className='history-status';status.textContent='Local history';row.append(left,status);el.append(row);});}
  async function signOut(){await stopSession(false);try{await state.db.auth.signOut();}catch(error){toast('Sign out error: '+error.message);}}

  function featureStatus(id,msg,kind=''){const el=$(id);if(!el)return;el.textContent=msg;el.className='status'+(kind?' '+kind:'');}
  function requireUser(){if(!state.db||!state.user){toast('Please sign in first.');setPage('signin');return false;}return true;}
  function randomPairCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';const bytes=new Uint8Array(6);crypto.getRandomValues(bytes);for(const b of bytes)s+=chars[b%chars.length];return s;}
  async function makePairCode(){if(!requireUser())return;featureStatus('pairCreateStatus','Creating one-time code…');try{let code,ok=false;for(let i=0;i<5&&!ok;i++){code=randomPairCode();const {data,error}=await state.db.from('pairing_codes').insert({code,user_id:state.user.id,expires_at:new Date(Date.now()+10*60*1000).toISOString()}).select('code').single();if(!error){ok=true;code=data.code;}else if(error.code!=='23505')throw error;}if(!ok)throw new Error('Could not generate a unique code. Try again.');$('pairCodeDisplay').textContent=code;$('copyPairCode').disabled=false;featureStatus('pairCreateStatus','Code ready. Share it only with the person you intend to pair with.','good');}catch(e){featureStatus('pairCreateStatus',e.message||'Could not create code. Apply the latest supabase/schema.sql first.','bad');}}
  async function redeemPairCode(){if(!requireUser())return;const code=$('pairCodeInput').value.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){featureStatus('pairRedeemStatus','Enter a valid 6-character code.','warn');return;}featureStatus('pairRedeemStatus','Checking code…');try{const {data,error}=await state.db.rpc('redeem_pairing_code',{p_code:code});if(error)throw error;featureStatus('pairRedeemStatus',data?.message||'Pairing complete.','good');$('pairCodeInput').value='';await loadPairLinks();}catch(e){featureStatus('pairRedeemStatus',e.message||'Could not redeem code. Check that the code has not expired or been used.','bad');}}
  async function loadPairLinks(){const wrap=$('pairLinks');if(!wrap)return;if(!state.user||!state.db){wrap.innerHTML='<div class="device-empty">Sign in to view pairings.</div>';return;}wrap.innerHTML='<div class="device-empty">Loading pairings…</div>';try{const {data,error}=await state.db.from('device_links').select('id,user_a,user_b,created_at,profile_a:user_profiles!device_links_user_a_fkey(display_name,email),profile_b:user_profiles!device_links_user_b_fkey(display_name,email)').order('created_at',{ascending:false});if(error)throw error;const rows=(data||[]).filter(x=>x.user_a===state.user.id||x.user_b===state.user.id);if(!rows.length){wrap.innerHTML='<div class="device-empty">No pairings yet. Generate or redeem a code.</div>';return;}wrap.replaceChildren();rows.forEach(x=>{const other=x.user_a===state.user.id?x.profile_b:x.profile_a;const row=document.createElement('div');row.className='device-card';const main=document.createElement('div');main.className='device-main';const strong=document.createElement('strong');strong.textContent=other?.display_name||other?.email||'PocketCam user';const small=document.createElement('small');small.textContent=other?.email||'Connected user';main.append(strong,small);const btn=document.createElement('button');btn.className='btn ghost small';btn.textContent='Remove';btn.onclick=async()=>{if(!confirm('Remove this pairing?'))return;const {error}=await state.db.from('device_links').delete().eq('id',x.id);if(error)toast(error.message);else loadPairLinks();};row.append(main,btn);wrap.append(row);});}catch(e){wrap.innerHTML='<div class="device-empty">Could not load pairings. Apply the latest schema.sql. '+esc(e.message)+'</div>';}}
  async function loadConversations(){const list=$('chatList');if(!list)return;if(!state.user||!state.db){list.innerHTML='<div class="device-empty">Sign in to load your inbox.</div>';return;}list.innerHTML='<div class="device-empty">Loading inbox…</div>';try{const {data,error}=await state.db.from('conversation_members').select('conversation_id,conversations(id,updated_at,conversation_members(user_id,user_profiles(display_name,email)))').eq('user_id',state.user.id);if(error)throw error;state.conversations=(data||[]).map(x=>x.conversations).filter(Boolean);renderConversationList();if(state.activeConversation&&state.conversations.some(c=>c.id===state.activeConversation))await openConversation(state.activeConversation);else if(state.conversations.length)await openConversation(state.conversations[0].id);}catch(e){list.innerHTML='<div class="device-empty">Inbox unavailable. Apply the latest schema.sql. '+esc(e.message)+'</div>';}}
  function renderConversationList(){const list=$('chatList');list.replaceChildren();if(!state.conversations.length){list.innerHTML='<div class="device-empty">No conversations yet. Start one by entering another user’s email.</div>';return;}state.conversations.forEach(c=>{const members=c.conversation_members||[];const other=members.find(m=>m.user_id!==state.user?.id);const profile=other?.user_profiles;const b=document.createElement('button');b.className='chat-person'+(c.id===state.activeConversation?' active':'');const name=document.createElement('strong');name.textContent=profile?.display_name||profile?.email||'Conversation';const small=document.createElement('small');small.textContent=profile?.email||'PocketCam user';b.append(name,small);b.onclick=()=>openConversation(c.id);list.append(b);});}
  async function startChat(){if(!requireUser())return;const email=$('newChatEmail').value.trim().toLowerCase();if(!email){featureStatus('chatStatus','Enter the other user’s email address.','warn');return;}featureStatus('chatStatus','Finding user…');try{const {data:profile,error}=await state.db.from('user_profiles').select('id,email').eq('email',email).maybeSingle();if(error)throw error;if(!profile)throw new Error('No PocketCam account was found for that email.');if(profile.id===state.user.id)throw new Error('You cannot start a conversation with yourself.');const {data:cid,error:rpcError}=await state.db.rpc('start_direct_conversation',{p_other_user:profile.id});if(rpcError)throw rpcError;$('newChatEmail').value='';featureStatus('chatStatus','Conversation ready.','good');await loadConversations();if(cid)await openConversation(cid);}catch(e){featureStatus('chatStatus',e.message||'Could not start conversation.','bad');}}
  async function openConversation(id){state.activeConversation=id;renderConversationList();const c=state.conversations.find(x=>x.id===id);const other=(c?.conversation_members||[]).find(m=>m.user_id!==state.user?.id)?.user_profiles;$('chatTitle').textContent=other?.display_name||other?.email||'Conversation';$('chatInput').disabled=false;$('sendMessage').disabled=false;await loadMessages();if(state.messageChannel){try{await state.db.removeChannel(state.messageChannel);}catch{}}state.messageChannel=state.db.channel('pocketcam-chat-'+id,{config:{private:false}}).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+id},payload=>{if(payload.new)renderMessagesAppend(payload.new);}).subscribe();}
  async function loadMessages(){const wrap=$('chatMessages');wrap.innerHTML='<div class="device-empty">Loading messages…</div>';try{const {data,error}=await state.db.from('messages').select('id,sender_id,body,created_at').eq('conversation_id',state.activeConversation).order('created_at',{ascending:true}).limit(200);if(error)throw error;wrap.replaceChildren();if(!data?.length){wrap.innerHTML='<div class="device-empty">Say hello to start the conversation.</div>';return;}data.forEach(renderMessagesAppend);wrap.scrollTop=wrap.scrollHeight;}catch(e){wrap.innerHTML='<div class="device-empty">Could not load messages: '+esc(e.message)+'</div>';}}
  function renderMessagesAppend(m){const wrap=$('chatMessages');if(!wrap||wrap.querySelector('[data-message-id="'+CSS.escape(m.id)+'"]'))return;const empty=wrap.querySelector('.device-empty');if(empty)empty.remove();const bubble=document.createElement('div');bubble.className='bubble'+(m.sender_id===state.user?.id?' mine':'');bubble.dataset.messageId=m.id;const body=document.createElement('div');body.textContent=m.body;const time=document.createElement('small');time.textContent=new Date(m.created_at).toLocaleString();bubble.append(body,time);wrap.append(bubble);wrap.scrollTop=wrap.scrollHeight;}
  async function sendMessage(e){e.preventDefault();if(!requireUser()||!state.activeConversation)return;const body=$('chatInput').value.trim();if(!body)return;$('sendMessage').disabled=true;try{const {error}=await state.db.from('messages').insert({conversation_id:state.activeConversation,sender_id:state.user.id,body});if(error)throw error;$('chatInput').value='';}catch(err){featureStatus('chatStatus',err.message||'Message could not be sent.','bad');}finally{$('sendMessage').disabled=false;}}
  async function loadAdmin(){if(!$('adminContent'))return;if(!state.user||!state.db){featureStatus('adminStatus','Sign in with an authorized administrator account.','warn');$('adminContent').classList.add('hidden');return;}featureStatus('adminStatus','Verifying administrator role…');$('adminContent').classList.add('hidden');try{const {data,error}=await state.db.rpc('is_pocketcam_admin');if(error)throw error;if(!data){state.isAdmin=false;$('adminNav').hidden=true;featureStatus('adminStatus','Access denied. This account has not been granted the admin role.','bad');return;}state.isAdmin=true;$('adminNav').hidden=false;featureStatus('adminStatus','Administrator access verified.','good');$('adminContent').classList.remove('hidden');await refreshAdmin();}catch(e){featureStatus('adminStatus','Admin setup unavailable. Apply schema.sql and explicitly grant an admin in Supabase SQL Editor. '+e.message,'bad');}}
  async function refreshAdmin(){if(!state.isAdmin)return;try{const [u,stats]=await Promise.all([state.db.from('user_profiles').select('id,email,display_name,created_at').order('created_at',{ascending:false}).limit(500),state.db.rpc('pocketcam_admin_stats')]);if(u.error)throw u.error;if(stats.error)throw stats.error;$('adminUsersCount').textContent=stats.data?.users??u.data.length;$('adminMessagesCount').textContent=stats.data?.messages??'—';$('adminPairsCount').textContent=stats.data?.pairings??'—';const body=$('adminUsers');body.replaceChildren();u.data.forEach(x=>{const tr=document.createElement('tr');[x.email,x.display_name||'—',x.created_at?new Date(x.created_at).toLocaleDateString():'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});body.append(tr);});}catch(e){featureStatus('adminStatus','Admin query failed: '+e.message,'bad');}}
  function wireFeatures(){ $('makePairCode').addEventListener('click',makePairCode);$('copyPairCode').addEventListener('click',()=>{const code=$('pairCodeDisplay').textContent;if(code&&code!=='— — — — — —')navigator.clipboard?.writeText(code).then(()=>toast('Pairing code copied.')).catch(()=>toast('Copy unavailable; select the code manually.'));});$('redeemPairCode').addEventListener('click',redeemPairCode);$('pairCodeInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,'').slice(0,6));$('refreshPairLinks').addEventListener('click',loadPairLinks);$('startChat').addEventListener('click',startChat);$('chatForm').addEventListener('submit',sendMessage);$('refreshAdmin').addEventListener('click',refreshAdmin);}

  function initNavigation(){document.addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(!button)return;event.preventDefault();if(button.dataset.action==='signout'){signOut();return;}setPage(button.dataset.page);});window.addEventListener('hashchange',()=>{const page=location.hash.replace('#','');if(PAGES.includes(page)&&page!==state.currentPage)setPage(page);});}
  function wireAuth(){
    $('signinForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.db){showFormStatus('signinStatus','Configure config.js with your Supabase project URL and publishable key first.','warn');return;}const email=$('signinEmail').value.trim(),password=$('signinPassword').value;const btn=$('signinForm').querySelector('button[type="submit"]');btn.disabled=true;try{const {error}=await state.db.auth.signInWithPassword({email,password});if(error)throw error;showFormStatus('signinStatus','Signed in successfully. Your account devices are syncing.','good');setPage('studio');}catch(error){showFormStatus('signinStatus',error.message||'Sign in failed.','bad');}finally{btn.disabled=false;}});
    $('signupForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.db){showFormStatus('signupStatus','Configure config.js with your Supabase project URL and publishable key first.','warn');return;}const name=$('signupName').value.trim(),email=$('signupEmail').value.trim(),password=$('signupPassword').value;const btn=$('signupForm').querySelector('button[type="submit"]');btn.disabled=true;try{const {data,error}=await state.db.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:location.href.split('#')[0]+'#studio'}});if(error)throw error;showFormStatus('signupStatus',data.session?'Account created. You are signed in and your devices can now discover one another.':'Account created. Check your email to confirm the address, then sign in.','good');if(data.session)setPage('studio');}catch(error){showFormStatus('signupStatus',error.message||'Account creation failed.','bad');}finally{btn.disabled=false;}});
    $('resetPassword').addEventListener('click',async()=>{if(!state.db){showFormStatus('signinStatus','Configure config.js with your Supabase project URL and publishable key first.','warn');return;}const email=$('signinEmail').value.trim();if(!email){showFormStatus('signinStatus','Enter your email address first, then choose password reset.','warn');return;}try{const {error}=await state.db.auth.resetPasswordForEmail(email,{redirectTo:location.href.split('#')[0].split('?')[0]+'?auth=reset'});if(error)throw error;showFormStatus('signinStatus','If an account exists for this address, a password-reset email will be sent.','good');}catch(error){showFormStatus('signinStatus',error.message||'Could not send reset email.','bad');}});
    $('resetPasswordForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.db){showFormStatus('resetStatus','Supabase is not configured.','warn');return;}const password=$('newPassword').value,confirmation=$('confirmPassword').value;if(password!==confirmation){showFormStatus('resetStatus','The passwords do not match.','bad');return;}if(password.length<8){showFormStatus('resetStatus','Use at least 8 characters.','bad');return;}const btn=$('resetPasswordForm').querySelector('button[type=submit]');btn.disabled=true;try{const {data:{session}}=await state.db.auth.getSession();if(!session){throw new Error('This reset link is invalid or expired. Request a new password-reset email and open its link in this browser.');}const {error}=await state.db.auth.updateUser({password});if(error)throw error;showFormStatus('resetStatus','Password updated successfully. Your account is ready to use.','good');const url=new URL(location.href);url.searchParams.delete('auth');history.replaceState(null,'',url.pathname+url.search+'#studio');setPage('studio');}catch(error){showFormStatus('resetStatus',error.message||'Could not update the password.','bad');}finally{btn.disabled=false;}});
  }
  function wireStudio(){
    document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>setDevice(b.dataset.device)));
    document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>setRole(b.dataset.role)));
    $('connect').addEventListener('click',startSession);$('disconnect').addEventListener('click',()=>stopSession(true));$('refreshDevices').addEventListener('click',()=>{renderDevices();autoRequestSender();toast('Device list refreshed.');});
    $('deviceName').addEventListener('change',refreshPresence);$('deviceName').addEventListener('blur',refreshPresence);$('toggleMute').addEventListener('click',()=>{state.previewMuted=!state.previewMuted;$('previewVideo').muted=state.role==='sender'?true:state.previewMuted;$('toggleMute').textContent=state.previewMuted?'Unmute audio':'Mute audio';});
    $('fullscreen').addEventListener('click',toggleFullscreen);$('snapshot').addEventListener('click',takeSnapshot);$('recordClip').addEventListener('click',toggleRecording);$('pip').addEventListener('click',togglePip);
    document.querySelectorAll('[data-aspect]').forEach(b=>b.addEventListener('click',()=>setAspect(b.dataset.aspect)));document.querySelectorAll('[data-fit]').forEach(b=>b.addEventListener('click',()=>setFit(b.dataset.fit)));$('mirrorPreview').addEventListener('click',()=>{$('previewFrame').classList.toggle('mirror');$('mirrorPreview').classList.toggle('active');});
    $('studioAuthAction').addEventListener('click',()=>setPage('signin'));$('cameraFacing').addEventListener('change',()=>{});navigator.mediaDevices?.addEventListener?.('devicechange',populateCameras);
  }
  function wireOther(){
    $('contactForm').addEventListener('submit',e=>{e.preventDefault();$('contactStatus').textContent='A contact delivery endpoint is not included, so this message has not been sent.';$('contactStatus').className='status warn';$('contactStatus').classList.remove('hidden');});
    $('clearHistory').addEventListener('click',()=>{state.history=[];localStorage.removeItem(HISTORY_KEY);renderHistory();});
  }
  async function init(){
    $('year').textContent=new Date().getFullYear();
    const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);state.device=mobile?'phone':'pc';document.querySelectorAll('[data-device]').forEach(b=>b.classList.toggle('active',b.dataset.device===state.device));
    $('deviceName').value=mobile?'My phone':'My computer';
    loadHistory();renderHistory();initNavigation();wireAuth();wireStudio();wireOther();wireFeatures();setAspect('landscape');setFit('contain');await populateCameras();
    if(location.hash){const page=location.hash.slice(1);if(PAGES.includes(page))setPage(page);}
    if(!configReady()){
      const warning=document.createElement('div');warning.className='auth-config-warning';warning.innerHTML='<strong>Setup required:</strong> sign-in and automatic pairing need your own Supabase project. Set the public Project URL and publishable key in <code>config.js</code>, then run <code>supabase/schema.sql</code> in the SQL Editor. This frontend never needs a service-role secret.';
      const signinPanel=document.querySelector('#page-signin .form-panel');signinPanel?.prepend(warning.cloneNode(true));
      const signupPanel=document.querySelector('#page-signup .form-panel');signupPanel?.prepend(warning.cloneNode(true));
      setStatus('Supabase is not configured yet. Follow README.md to enable real sign-in and device discovery.','warn');
    }else{
      state.db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},realtime:{params:{eventsPerSecond:20}}});
      state.db.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(session?.access_token)Promise.resolve(state.db.realtime.setAuth(session.access_token)).catch(()=>{});handleSession(session).catch(err=>{console.error(err);setTop('Auth issue');setStatus('Account setup error: '+(err.message||err),'bad');});},0);});
      const {data,error}=await state.db.auth.getSession();if(error)console.warn(error);await handleSession(data?.session||null);
      if(new URLSearchParams(location.search).get('auth')==='reset')setPage('reset-password');
    }
    updateAuthUI();renderDevices();
    window.addEventListener('beforeunload',()=>{try{for(const pc of state.peerConnections.values())pc.close();if(state.localStream)state.localStream.getTracks().forEach(t=>t.stop());}catch{}});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.channelReady){refreshPresence();renderDevices();}});
    $('previewVideo').addEventListener('loadedmetadata',updateVideoMetrics);
  }
  init().catch(error=>{console.error(error);setStatus('PocketCam could not initialize: '+(error.message||error),'bad');});
})();
