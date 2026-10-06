require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits
} = require('discord.js');
const store = require('./store');
const ui = require('./ui');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const splitList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const truncate = (s, n=1000) => String(s || '').slice(0,n);
const mentionList = ids => ids.map(id => `<@${id}>`).join(' ');

function isManageGuild(i) { return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild); }
function memberHasRole(i, roleId) { return !!roleId && i.member?.roles?.cache?.has(roleId); }
function isAdmin(i, g) { return isManageGuild(i) || memberHasRole(i, g.config.roles.admin); }
function isSupervisor(i, g) { return isAdmin(i,g) || memberHasRole(i, g.config.roles.supervisor); }
function isStaff(i, g) { return isSupervisor(i,g) || memberHasRole(i, g.config.roles.controller); }
function isDriver(i, g) {
  if (!g.config.roles.driver) return true;
  return isStaff(i,g) || memberHasRole(i, g.config.roles.driver);
}

async function deny(i, text='You do not have permission to use this.') {
  const p = { content:`⛔ ${text}`, ephemeral:true };
  if (i.replied || i.deferred) return i.followUp(p);
  return i.reply(p);
}
async function respond(i, payload) {
  if (i.replied || i.deferred) return i.followUp(payload);
  return i.reply(payload);
}
async function fetchChannel(guildId, channelId) {
  if (!channelId) return null;
  try {
    const guild = await client.guilds.fetch(guildId);
    const ch = await guild.channels.fetch(channelId);
    return ch?.isTextBased() ? ch : null;
  } catch { return null; }
}
async function postConfigured(guildId, channelKey, payload) {
  const g = store.getGuild(guildId);
  const ch = await fetchChannel(guildId, g.config.channels[channelKey]);
  if (ch) return ch.send(payload).catch(()=>null);
  return null;
}
async function audit(guildId, type, actorId, data, humanText) {
  await store.mutateGuild(guildId, g => store.audit(g, type, actorId, data));
  if (humanText) await postConfigured(guildId, 'audit', { content:`📝 ${humanText}` });
}
function currentAllocation(g, dutyId) {
  return [...g.allocations].reverse().find(a => a.dutyId === dutyId && !a.toAt) || null;
}
function activeFleetVehicle(g, vehicle) {
  const v=g.fleet[vehicle]; return v && !v.removedAt ? v : null;
}
function allocationBoardEmbed(g) {
  const live=Object.values(g.duties).filter(d=>['available','claimed','on_duty'].includes(d.status)).sort((a,b)=>String(a.allocationNumber||'ZZZ').localeCompare(String(b.allocationNumber||'ZZZ'))||a.number.localeCompare(b.number));
  const lines=live.map(d=>{
    const a=currentAllocation(g,d.id), c=Object.values(g.claims).find(c=>c.dutyId===d.id&&['claimed','on_duty'].includes(c.status));
    return `**${d.allocationNumber||'—'}** | **${a?.vehicle||'—'}** | Duty **${d.number}** | ${(d.routes||[]).join(' + ')||'—'} | ${c?`<@${c.userId}>`:'—'}`;
  });
  return ui.baseEmbed(g,'LIVE ALLOCATIONS').setDescription(truncate(lines.join('\n')||'No live duties/allocations.',4000)).setFooter({text:`Live board • Updated ${new Date().toLocaleString('en-GB')}`});
}
async function refreshAllocationsBoard(guildId) {
  const g=store.getGuild(guildId), channelId=g.config.channels.allocations; if(!channelId)return;
  const ch=await fetchChannel(guildId,channelId); if(!ch)return;
  const payload={embeds:[allocationBoardEmbed(g)]};
  let msg=null;
  if(g.config.liveAllocationsMessageId){try{msg=await ch.messages.fetch(g.config.liveAllocationsMessageId);}catch{}}
  if(msg){await msg.edit(payload).catch(()=>null);return;}
  const sent=await ch.send(payload).catch(()=>null);
  if(sent)await store.mutateGuild(guildId,g=>{g.config.liveAllocationsMessageId=sent.id;store.audit(g,'allocations_board_create',client.user?.id||'system',{channelId,messageId:sent.id});});
}
function profileName(g, userId) { return g.profiles[userId]?.fullName || `<@${userId}>`; }
function latestClaims(g, userId, limit=10) {
  return Object.values(g.claims).filter(c=>c.userId===userId).sort((a,b)=>new Date(b.claimedAt)-new Date(a.claimedAt)).slice(0,limit);
}

function profileModal(mode, profile={}) {
  const modal = new ModalBuilder().setCustomId(`profile:${mode}`).setTitle(mode === 'create' ? 'Create Driver Profile' : 'Edit Driver Profile');
  const fields = [
    ['fullName','Full Name (this can be fictional) *',TextInputStyle.Short,true,profile.fullName||'',100],
    ['driverNumber','Driver Number / Callsign',TextInputStyle.Short,false,profile.driverNumber||'',40],
    ['favouriteMap','Favourite Map',TextInputStyle.Short,false,profile.favouriteMap||'',100],
    ['favouriteRoute','Favourite Route',TextInputStyle.Short,false,profile.favouriteRoute||'',100],
    ['bio','Bio',TextInputStyle.Paragraph,false,profile.bio||'',500]
  ];
  for (const [id,label,style,required,value,max] of fields) {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) input.setValue(String(value).slice(0,max));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function handleSetup(i) {
  const values = {
    companyName: i.options.getString('company'),
    roles: {
      driver: i.options.getRole('driver_role')?.id || null,
      controller: i.options.getRole('controller_role')?.id || null,
      supervisor: i.options.getRole('supervisor_role')?.id || null,
      admin: i.options.getRole('admin_role')?.id || null
    },
    channels: {
      controlMessages: i.options.getChannel('control_messages')?.id || null,
      defects: i.options.getChannel('defects')?.id || null,
      requests: i.options.getChannel('requests')?.id || null,
      shiftActivity: i.options.getChannel('shift_activity')?.id || null,
      audit: i.options.getChannel('audit')?.id || null,
      allocations: i.options.getChannel('allocations')?.id || null
    }
  };
  await store.mutateGuild(i.guildId, g => {
    g.config.companyName = values.companyName;
    Object.assign(g.config.roles, values.roles);
    Object.assign(g.config.channels, values.channels);
    store.audit(g,'setup',i.user.id,values);
  });
  await refreshAllocationsBoard(i.guildId); return i.reply({content:`✅ **${values.companyName}** configured. SouthOps will now use these roles/channels.`,ephemeral:true});
}

async function handleConfig(i) {
  const g = store.getGuild(i.guildId);
  if (!isAdmin(i,g)) return deny(i,'Only SouthOps Admins / server managers can change configuration.');
  const sub=i.options.getSubcommand();
  if (sub==='view') {
    const e=ui.baseEmbed(g,'CONFIGURATION').addFields(
      {name:'Depots',value:g.config.depots.join(', ')||'None configured'},
      {name:'Roles',value:`Driver: ${g.config.roles.driver?`<@&${g.config.roles.driver}>`:'Not set'}\nController: ${g.config.roles.controller?`<@&${g.config.roles.controller}>`:'Not set'}\nSupervisor: ${g.config.roles.supervisor?`<@&${g.config.roles.supervisor}>`:'Not set'}\nAdmin: ${g.config.roles.admin?`<@&${g.config.roles.admin}>`:'Not set'}`},
      {name:'Channels',value:Object.entries(g.config.channels).map(([k,v])=>`${k}: ${v?`<#${v}>`:'Not set'}`).join('\n')}
    );
    return i.reply({embeds:[e],ephemeral:true});
  }
  const name=i.options.getString('name').trim();
  if (sub==='depot-add') {
    await store.mutateGuild(i.guildId,g=>{ if(!g.config.depots.some(d=>d.toLowerCase()===name.toLowerCase())) g.config.depots.push(name); store.audit(g,'depot_add',i.user.id,{name}); });
    return i.reply({content:`✅ Depot **${name}** added.`,ephemeral:true});
  }
  await store.mutateGuild(i.guildId,g=>{ g.config.depots=g.config.depots.filter(d=>d.toLowerCase()!==name.toLowerCase()); store.audit(g,'depot_remove',i.user.id,{name}); });
  return i.reply({content:`✅ Depot **${name}** removed from configuration. Existing historical records are untouched.`,ephemeral:true});
}

async function handleProfile(i) {
  const g=store.getGuild(i.guildId), sub=i.options.getSubcommand();
  if (sub==='create') {
    if (g.profiles[i.user.id]) return i.reply({content:'⚠️ You already have a profile. Use `/profile edit`.',ephemeral:true});
    return i.showModal(profileModal('create'));
  }
  if (sub==='edit') {
    const p=g.profiles[i.user.id];
    if(!p) return i.reply({content:'⚠️ Create a profile first with `/profile create`.',ephemeral:true});
    return i.showModal(profileModal('edit',p));
  }
  const user=i.options.getUser('user')||i.user, p=g.profiles[user.id];
  if(!p) return i.reply({content:`⚠️ ${user} has not created a SouthOps driver profile.`,ephemeral:true});
  const s=store.driverStats(g,user.id);
  const topRoutes=Object.entries(s.routeCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([r,n])=>`${r} (${n})`).join(', ')||'None yet';
  const e=ui.baseEmbed(g,'DRIVER PROFILE').setDescription(`**${p.fullName}**\n${user}`)
    .addFields(
      {name:'Driver Number / Callsign',value:p.driverNumber||'—',inline:true},
      {name:'Favourite Map',value:p.favouriteMap||'—',inline:true},
      {name:'Favourite Route',value:p.favouriteRoute||'—',inline:true},
      {name:'Completed Duties',value:String(s.completed),inline:true},
      {name:'Working Time',value:ui.fmtMs(s.workMs),inline:true},
      {name:'Vehicles Driven',value:String(Object.keys(s.vehicleCounts).length),inline:true},
      {name:'Top Routes',value:topRoutes},
      {name:'Bio',value:truncate(p.bio||'No bio set.',1024)}
    );
  return i.reply({embeds:[e]});
}

async function handleProfileModal(i) {
  const mode=i.customId.split(':')[1];
  const values={
    fullName:i.fields.getTextInputValue('fullName').trim(),
    driverNumber:i.fields.getTextInputValue('driverNumber').trim(),
    favouriteMap:i.fields.getTextInputValue('favouriteMap').trim(),
    favouriteRoute:i.fields.getTextInputValue('favouriteRoute').trim(),
    bio:i.fields.getTextInputValue('bio').trim()
  };
  await store.mutateGuild(i.guildId,g=>{
    const existing=g.profiles[i.user.id];
    if(mode==='create' && existing) throw new Error('Profile already exists.');
    g.profiles[i.user.id]={...(existing||{}),...values,userId:i.user.id,createdAt:existing?.createdAt||store.now(),updatedAt:store.now(),lastActive:store.now()};
    store.audit(g,mode==='create'?'profile_create':'profile_edit',i.user.id,{});
  });
  return i.reply({content:`✅ Driver profile ${mode==='create'?'created':'updated'}.`,ephemeral:true});
}

async function handleDuty(i) {
  const g=store.getGuild(i.guildId);
  if(!isStaff(i,g)) return deny(i,'Only Controllers/Supervisors can manage duties.');
  const sub=i.options.getSubcommand();
  if(sub==='create') {
    const number=i.options.getString('number').trim();
    const existing=Object.values(g.duties).find(d=>d.number.toLowerCase()===number.toLowerCase() && ['available','claimed','on_duty'].includes(d.status));
    if(existing) return i.reply({content:`⚠️ There is already a live **${number}** duty. Complete/cancel it before creating another instance.`,ephemeral:true});
    const duty={id:store.id('duty'),number,routes:splitList(i.options.getString('routes')),startTime:i.options.getString('start')||null,endTime:i.options.getString('finish')||null,depot:i.options.getString('depot')||null,notes:i.options.getString('notes')||null,allocationNumber:(i.options.getString('allocation')||'').trim()||null,status:'available',createdAt:store.now(),createdBy:i.user.id,completedAt:null,cancelledAt:null};
    await store.mutateGuild(i.guildId,g=>{g.duties[duty.id]=duty;store.audit(g,'duty_create',i.user.id,{dutyId:duty.id,number});});
    await refreshAllocationsBoard(i.guildId); return i.reply({embeds:[ui.dutyEmbed(store.getGuild(i.guildId),duty)]});
  }
  const ref=i.options.getString('number');
  const duty=store.findDuty(g,ref);
  if(!duty) return i.reply({content:`⚠️ Duty **${ref}** not found.`,ephemeral:true});
  if(!['available','claimed','on_duty'].includes(duty.status)) return i.reply({content:`⚠️ Duty **${duty.number}** is historical and cannot be cancelled.`,ephemeral:true});
  const reason=i.options.getString('reason')||'No reason supplied';
  await store.mutateGuild(i.guildId,g=>{
    const d=g.duties[duty.id];
    const c=Object.values(g.claims).find(c=>c.dutyId===d.id&&['claimed','on_duty'].includes(c.status));
    if(c){const wasOnDuty=c.status==='on_duty';c.status='cancelled';c.cancelledAt=store.now();c.cancelledBy=i.user.id;c.cancelReason=reason;if(wasOnDuty&&!c.signedOffAt)c.signedOffAt=store.now();const open=c.breaks?.find(b=>!b.endAt);if(open)open.endAt=store.now();}
    const a=currentAllocation(g,d.id); if(a){a.toAt=store.now(); const v=g.fleet[a.vehicle]; if(v&&['allocated','in_service'].includes(v.status))v.status='available';}
    d.status='cancelled';d.cancelledAt=store.now();d.cancelReason=reason;store.audit(g,'duty_cancel',i.user.id,{dutyId:d.id,number:d.number,reason});
  });
  await refreshAllocationsBoard(i.guildId); return i.reply({content:`❌ Duty **${duty.number}** cancelled. History has been retained.`});
}

async function handleDuties(i) {
  const g=store.getGuild(i.guildId);
  if(!isDriver(i,g)) return deny(i,'You need the configured Driver role.');
  const duties=Object.values(g.duties).filter(d=>['available','claimed','on_duty'].includes(d.status)).sort((a,b)=>a.number.localeCompare(b.number));
  if(!duties.length) return i.reply({content:'No live duties are currently available/claimed.',ephemeral:true});
  const e=ui.baseEmbed(g,'LIVE DUTIES');
  e.setDescription(duties.slice(0,25).map(d=>{
    const c=Object.values(g.claims).find(c=>c.dutyId===d.id&&['claimed','on_duty'].includes(c.status));
    const who=c?` • <@${c.userId}>`:'';
    return `${ui.dutyStatusLabel(d.status)} **${d.number}** • ${(d.routes||[]).join('/')||'No route'}${who}`;
  }).join('\n'));
  const available=duties.filter(d=>d.status==='available').slice(0,25);
  const rows=[];
  for(let x=0;x<available.length;x+=5){
    rows.push(new ActionRowBuilder().addComponents(...available.slice(x,x+5).map(d=>new ButtonBuilder().setCustomId(`claim:${d.id}`).setLabel(`Claim ${d.number}`).setStyle(ButtonStyle.Primary))));
  }
  return i.reply({embeds:[e],components:rows,ephemeral:true});
}

async function handleClaimButton(i) {
  const dutyId=i.customId.slice('claim:'.length);
  const g=store.getGuild(i.guildId);
  if(!isDriver(i,g)) return deny(i,'You need the configured Driver role.');
  if(!g.profiles[i.user.id]) return i.reply({content:'⚠️ Create your driver profile first with `/profile create`.',ephemeral:true});
  if(store.activeClaimForUser(g,i.user.id)) return i.reply({content:'⚠️ You already have an active/claimed duty.',ephemeral:true});
  const duty=g.duties[dutyId];
  if(!duty||duty.status!=='available') return i.reply({content:'⚠️ That duty is no longer available.',ephemeral:true});
  const claim={id:store.id('claim'),dutyId:duty.id,dutyNumber:duty.number,userId:i.user.id,status:'claimed',claimedAt:store.now(),signedOnAt:null,signedOffAt:null,releasedAt:null,cancelledAt:null,breaks:[]};
  await store.mutateGuild(i.guildId,g=>{g.claims[claim.id]=claim;g.duties[duty.id].status='claimed';g.profiles[i.user.id].lastActive=store.now();store.audit(g,'claim',i.user.id,{claimId:claim.id,dutyId:duty.id,dutyNumber:duty.number});});
  await postConfigured(i.guildId,'shiftActivity',{content:`🔵 **SHIFT CLAIMED** • Duty **${duty.number}** • ${i.user} • ${ui.shortTime(claim.claimedAt)}`});
  await refreshAllocationsBoard(i.guildId);
  return i.reply({content:`🔵 You claimed **${duty.number}**. Working time does **not** start until you Sign On.`,ephemeral:true});
}

async function handleMyDuty(i) {
  const g=store.getGuild(i.guildId), c=store.activeClaimForUser(g,i.user.id);
  if(!c) return i.reply({content:'You do not currently have a claimed/active duty.',ephemeral:true});
  const d=g.duties[c.dutyId], a=currentAllocation(g,c.dutyId);
  const e=ui.dutyEmbed(g,d,c).addFields(
    {name:'Signed On',value:c.signedOnAt?ui.fmtTime(c.signedOnAt):'Not signed on',inline:true},
    {name:'Vehicle',value:a?.vehicle||'Not allocated',inline:true},
    {name:'Live Working Time',value:c.signedOnAt?ui.fmtMs(store.claimWorkMs(c)):'0h 00m',inline:true}
  );
  return i.reply({embeds:[e],components:ui.myDutyButtons(c),ephemeral:true});
}

async function handleMyDutyButton(i) {
  const action=i.customId.split(':')[1], g=store.getGuild(i.guildId), c=store.activeClaimForUser(g,i.user.id);
  if(!c) return i.reply({content:'⚠️ You no longer have an active duty.',ephemeral:true});
  const d=g.duties[c.dutyId];
  if(action==='release') {
    if(c.status!=='claimed') return i.reply({content:'⚠️ You can only release a claim before signing on.',ephemeral:true});
    await store.mutateGuild(i.guildId,g=>{const cc=g.claims[c.id];cc.status='released';cc.releasedAt=store.now();g.duties[c.dutyId].status='available';store.audit(g,'claim_release',i.user.id,{claimId:c.id,dutyNumber:c.dutyNumber});});
    await postConfigured(i.guildId,'shiftActivity',{content:`↩️ **CLAIM RELEASED** • Duty **${c.dutyNumber}** • ${i.user}`});
    await refreshAllocationsBoard(i.guildId);
    return i.reply({content:`↩️ Claim for **${c.dutyNumber}** released. The claim remains in history.`,ephemeral:true});
  }
  if(action==='signon') {
    if(c.status!=='claimed') return i.reply({content:'⚠️ Duty is not awaiting sign-on.',ephemeral:true});
    const at=store.now();
    await store.mutateGuild(i.guildId,g=>{const cc=g.claims[c.id];cc.status='on_duty';cc.signedOnAt=at;g.duties[c.dutyId].status='on_duty';g.profiles[i.user.id].lastActive=at;const a=currentAllocation(g,c.dutyId);if(a&&g.fleet[a.vehicle]&&['available','allocated','spare'].includes(g.fleet[a.vehicle].status))g.fleet[a.vehicle].status='in_service';store.audit(g,'sign_on',i.user.id,{claimId:c.id,dutyNumber:c.dutyNumber});});
    await postConfigured(i.guildId,'shiftActivity',{content:`🟡 **DRIVER SIGNED ON** • Duty **${c.dutyNumber}** • ${i.user} • ${ui.shortTime(at)}`});
    await refreshAllocationsBoard(i.guildId);
    return i.reply({content:`🟢 Signed on to **${c.dutyNumber}**. Automatic time tracking has started.`,ephemeral:true});
  }
  if(c.status!=='on_duty') return i.reply({content:'⚠️ You must be signed on first.',ephemeral:true});
  if(action==='startbreak') {
    if(store.openBreak(c)) return i.reply({content:'⚠️ You are already on a break.',ephemeral:true});
    const at=store.now(); await store.mutateGuild(i.guildId,g=>{g.claims[c.id].breaks.push({id:store.id('break'),startAt:at,endAt:null});store.audit(g,'break_start',i.user.id,{claimId:c.id,dutyNumber:c.dutyNumber});});
    return i.reply({content:`☕ Break started at ${ui.shortTime(at)}.`,ephemeral:true});
  }
  if(action==='endbreak') {
    if(!store.openBreak(c)) return i.reply({content:'⚠️ You do not have an active break.',ephemeral:true});
    const at=store.now(); await store.mutateGuild(i.guildId,g=>{const b=g.claims[c.id].breaks.find(x=>!x.endAt);b.endAt=at;store.audit(g,'break_end',i.user.id,{claimId:c.id,dutyNumber:c.dutyNumber});});
    return i.reply({content:`▶️ Break ended at ${ui.shortTime(at)}.`,ephemeral:true});
  }
  if(action==='signoff') {
    const at=store.now();
    await store.mutateGuild(i.guildId,g=>{
      const cc=g.claims[c.id]; const open=cc.breaks.find(b=>!b.endAt); if(open)open.endAt=at; cc.status='completed';cc.signedOffAt=at;
      const dd=g.duties[c.dutyId];dd.status='completed';dd.completedAt=at;
      const a=currentAllocation(g,c.dutyId);if(a){a.toAt=at;const v=g.fleet[a.vehicle];if(v&&['allocated','in_service'].includes(v.status))v.status='available';}
      g.profiles[i.user.id].lastActive=at;store.audit(g,'sign_off',i.user.id,{claimId:c.id,dutyNumber:c.dutyNumber});
    });
    const final=store.getGuild(i.guildId).claims[c.id];
    await postConfigured(i.guildId,'shiftActivity',{content:`✅ **DUTY COMPLETED** • **${c.dutyNumber}** • ${i.user} • Working time **${ui.fmtMs(store.claimWorkMs(final))}**`});
    await refreshAllocationsBoard(i.guildId);
    return i.reply({content:`✅ Signed off **${c.dutyNumber}**. Working time: **${ui.fmtMs(store.claimWorkMs(final))}**. Your permanent statistics have updated automatically.`,ephemeral:true});
  }
}

async function handleClaims(i) {
  const g=store.getGuild(i.guildId); if(!isStaff(i,g)) return deny(i,'Only Controllers/Supervisors can view live claims.');
  const active=Object.values(g.claims).filter(c=>['claimed','on_duty'].includes(c.status)).sort((a,b)=>new Date(a.claimedAt)-new Date(b.claimedAt));
  const available=Object.values(g.duties).filter(d=>d.status==='available');
  const claimed=active.filter(c=>c.status==='claimed').map(c=>`**${c.dutyNumber}** — <@${c.userId}> • claimed ${ui.shortTime(c.claimedAt)}`).join('\n')||'None';
  const on=active.filter(c=>c.status==='on_duty').map(c=>`**${c.dutyNumber}** — <@${c.userId}> • signed on ${ui.shortTime(c.signedOnAt)}`).join('\n')||'None';
  const e=ui.baseEmbed(g,'SHIFT CLAIMS').addFields({name:'🔵 CLAIMED',value:truncate(claimed,1024)},{name:'🟡 ON DUTY',value:truncate(on,1024)},{name:'🟢 AVAILABLE',value:truncate(available.map(d=>d.number).join(', ')||'None',1024)});
  return i.reply({embeds:[e],ephemeral:true});
}

async function handleDriver(i) {
  const g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i,'Only Controllers/Supervisors can view staff driver records.');
  const user=i.options.getUser('user'),p=g.profiles[user.id];if(!p)return i.reply({content:`⚠️ ${user} has no SouthOps profile.`,ephemeral:true});
  const s=store.driverStats(g,user.id),c=store.activeClaimForUser(g,user.id),d=c?g.duties[c.dutyId]:null,a=c?currentAllocation(g,c.dutyId):null;
  const routes=Object.entries(s.routeCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([r,n])=>`${r} ×${n}`).join(', ')||'None';
  const vehicles=Object.entries(s.vehicleCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,n])=>`${v} ×${n}`).join(', ')||'None';
  const e=ui.baseEmbed(g,'DRIVER RECORD').setDescription(`**${p.fullName}** • ${user}\nDiscord ID: \`${user.id}\``).addFields(
    {name:'Current Status',value:c?(c.status==='on_duty'?'🟡 On Duty':'🔵 Claimed'):'⚪ Off Duty',inline:true},
    {name:'Current Duty',value:d?`${d.number} • ${(d.routes||[]).join('/')}`:'—',inline:true},
    {name:'Current Vehicle',value:a?.vehicle||'—',inline:true},
    {name:'Completed Duties',value:String(s.completed),inline:true},{name:'Total Claims',value:String(s.claims),inline:true},{name:'Working Time',value:ui.fmtMs(s.workMs),inline:true},
    {name:'Break Time',value:ui.fmtMs(s.breakMs),inline:true},{name:'Routes Operated',value:String(Object.keys(s.routeCounts).length),inline:true},{name:'Vehicles Driven',value:String(Object.keys(s.vehicleCounts).length),inline:true},
    {name:'Defects / Requests / Incidents',value:`${s.defects} / ${s.requests} / ${s.incidents}`},
    {name:'Route History',value:truncate(routes,1024)},{name:'Vehicle History',value:truncate(vehicles,1024)},
    {name:'Profile',value:`Driver ID: ${p.driverNumber||'—'}\nFavourite Map: ${p.favouriteMap||'—'}\nFavourite Route: ${p.favouriteRoute||'—'}\nCreated: ${ui.fmtTime(p.createdAt)}\nLast Active: ${ui.fmtTime(p.lastActive)}`}
  );
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`driverclaims:${user.id}`).setLabel('Claim History').setStyle(ButtonStyle.Secondary));
  return i.reply({embeds:[e],components:[row],ephemeral:true});
}

async function handleDriverClaims(i) {
  const g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i);
  const userId=i.customId.split(':')[1],claims=latestClaims(g,userId,15);
  const text=claims.map(c=>{
    const work=c.signedOnAt?` • ${ui.fmtMs(store.claimWorkMs(c))}`:'';
    return `${ui.claimStatusLabel(c.status)} **${c.dutyNumber}**\nClaimed ${ui.fmtTime(c.claimedAt)}${c.signedOnAt?`\nSigned on ${ui.fmtTime(c.signedOnAt)}`:''}${c.signedOffAt?`\nSigned off ${ui.fmtTime(c.signedOffAt)}`:''}${c.releasedAt?`\nReleased ${ui.fmtTime(c.releasedAt)}`:''}${work}`;
  }).join('\n\n')||'No claims recorded.';
  const e=ui.baseEmbed(g,`CLAIM HISTORY • ${profileName(g,userId)}`).setDescription(truncate(text,4000));
  return i.reply({embeds:[e],ephemeral:true});
}

async function handleFleet(i) {
  const g=store.getGuild(i.guildId),sub=i.options.getSubcommand();
  if(sub!=='list'&&!isStaff(i,g))return deny(i,'Only Controllers/Supervisors can change the fleet.');
  if(sub==='add'){
    const v=i.options.getString('vehicle').trim(),depot=i.options.getString('depot')||null,notes=i.options.getString('notes')||null;
    if(g.fleet[v]&&!g.fleet[v].removedAt)return i.reply({content:`⚠️ Vehicle **${v}** already exists.`,ephemeral:true});
    if(g.fleet[v]?.removedAt)return i.reply({content:`⚠️ Vehicle **${v}** is archived. Use \`/fleet restore\` so its history remains linked.`,ephemeral:true});
    await store.mutateGuild(i.guildId,g=>{g.fleet[v]={vehicle:v,depot,notes,status:'available',createdAt:store.now(),createdBy:i.user.id};store.audit(g,'fleet_add',i.user.id,{vehicle:v,depot});});
    return i.reply({content:`🚌 Vehicle **${v}** added to the permanent fleet database.`});
  }
  if(sub==='remove'){
    const v=i.options.getString('vehicle').trim(),bus=g.fleet[v]; if(!bus||bus.removedAt)return i.reply({content:`⚠️ Active vehicle **${v}** not found.`,ephemeral:true});
    const at=store.now(); await store.mutateGuild(i.guildId,g=>{for(const a of g.allocations.filter(a=>a.vehicle===v&&!a.toAt))a.toAt=at;g.fleet[v].removedAt=at;g.fleet[v].removedBy=i.user.id;g.fleet[v].status='removed';store.audit(g,'fleet_remove',i.user.id,{vehicle:v});});
    await refreshAllocationsBoard(i.guildId); return i.reply({content:`🗃️ **${v}** removed from the active fleet. All historical duties, allocations, defects and driver records are preserved.`});
  }
  if(sub==='restore'){
    const v=i.options.getString('vehicle').trim(),bus=g.fleet[v]; if(!bus||!bus.removedAt)return i.reply({content:`⚠️ Removed vehicle **${v}** not found.`,ephemeral:true});
    await store.mutateGuild(i.guildId,g=>{g.fleet[v].removedAt=null;g.fleet[v].removedBy=null;g.fleet[v].restoredAt=store.now();g.fleet[v].restoredBy=i.user.id;g.fleet[v].status='available';store.audit(g,'fleet_restore',i.user.id,{vehicle:v});});
    await refreshAllocationsBoard(i.guildId); return i.reply({content:`♻️ **${v}** restored to the active fleet with its full history intact.`});
  }
  if(sub==='status'){
    const v=i.options.getString('vehicle').trim(),status=i.options.getString('status');if(!g.fleet[v])return i.reply({content:`⚠️ Vehicle **${v}** not found.`,ephemeral:true});
    await store.mutateGuild(i.guildId,g=>{g.fleet[v].status=status;g.fleet[v].updatedAt=store.now();store.audit(g,'fleet_status',i.user.id,{vehicle:v,status});});
    return i.reply({content:`✅ **${v}** status → **${status.replace('_',' ')}**.`});
  }
  const depot=i.options.getString('depot'),fleet=Object.values(g.fleet).filter(v=>!v.removedAt).filter(v=>!depot||String(v.depot||'').toLowerCase()===depot.toLowerCase()).sort((a,b)=>a.vehicle.localeCompare(b.vehicle));
  const text=fleet.slice(0,50).map(v=>`**${v.vehicle}** • ${v.status.replace('_',' ')}${v.depot?` • ${v.depot}`:''}`).join('\n')||'No vehicles found.';
  return i.reply({embeds:[ui.baseEmbed(g,'FLEET').setDescription(truncate(text,4000))],ephemeral:true});
}

async function handleAllocate(i) {
  const g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i,'Only Controllers/Supervisors can allocate vehicles.');
  const duty=store.findDuty(g,i.options.getString('duty')),vehicle=(i.options.getString('vehicle')||'').trim(),allocation=(i.options.getString('allocation')||'').trim();
  if(!duty||!['available','claimed','on_duty'].includes(duty.status))return i.reply({content:'⚠️ Live duty not found.',ephemeral:true});
  if(!vehicle&&!allocation)return i.reply({content:'⚠️ Supply a fleet number, allocation number, or both.',ephemeral:true});
  if(vehicle&&!activeFleetVehicle(g,vehicle))return i.reply({content:`⚠️ Vehicle **${vehicle}** is not in the active fleet.`,ephemeral:true});
  const at=store.now();
  await store.mutateGuild(i.guildId,g=>{
    const d=g.duties[duty.id]; if(allocation)d.allocationNumber=allocation;
    if(vehicle){const old=currentAllocation(g,duty.id);if(old){old.toAt=at;const oldV=g.fleet[old.vehicle];if(oldV&&!oldV.removedAt&&['allocated','in_service'].includes(oldV.status))oldV.status='available';}
      g.allocations.push({id:store.id('alloc'),dutyId:duty.id,dutyNumber:duty.number,allocationNumber:d.allocationNumber||null,vehicle,fromAt:at,toAt:null,assignedBy:i.user.id});g.fleet[vehicle].status=duty.status==='on_duty'?'in_service':'allocated';}
    store.audit(g,'allocate',i.user.id,{dutyId:duty.id,dutyNumber:duty.number,allocationNumber:d.allocationNumber||null,vehicle:vehicle||null});
  });
  await refreshAllocationsBoard(i.guildId);
  return i.reply({content:`🚍 Duty **${duty.number}** updated • Allocation **${store.getGuild(i.guildId).duties[duty.id].allocationNumber||'—'}** • Fleet **${currentAllocation(store.getGuild(i.guildId),duty.id)?.vehicle||'—'}**. History retained.`});
}

async function handleAllocations(i){
  const g=store.getGuild(i.guildId); return i.reply({embeds:[allocationBoardEmbed(g)]});
}
async function handleAllocationEdit(i){
  const g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i,'Only Controllers/Supervisors can edit allocations.');const sub=i.options.getSubcommand(),duty=store.findDuty(g,i.options.getString('duty'));
  if(!duty||!['available','claimed','on_duty'].includes(duty.status))return i.reply({content:'⚠️ Live duty not found.',ephemeral:true}); const at=store.now();
  if(sub==='clear'){await store.mutateGuild(i.guildId,g=>{const a=currentAllocation(g,duty.id);if(a){a.toAt=at;const v=g.fleet[a.vehicle];if(v&&!v.removedAt)v.status='available';}g.duties[duty.id].allocationNumber=null;store.audit(g,'allocation_clear',i.user.id,{dutyId:duty.id,dutyNumber:duty.number});});await refreshAllocationsBoard(i.guildId);return i.reply({content:`✅ Live allocation cleared from duty **${duty.number}**. Historical records retained.`});}
  const allocation=i.options.getString('allocation'),vehicle=i.options.getString('vehicle'),routes=i.options.getString('routes');if(vehicle&&!activeFleetVehicle(g,vehicle.trim()))return i.reply({content:`⚠️ Vehicle **${vehicle}** is not in the active fleet.`,ephemeral:true});
  await store.mutateGuild(i.guildId,g=>{const d=g.duties[duty.id];if(allocation!==null)d.allocationNumber=allocation.trim()||null;if(routes!==null)d.routes=splitList(routes);if(vehicle){const old=currentAllocation(g,d.id);if(old){old.toAt=at;const ov=g.fleet[old.vehicle];if(ov&&!ov.removedAt)ov.status='available';}g.allocations.push({id:store.id('alloc'),dutyId:d.id,dutyNumber:d.number,allocationNumber:d.allocationNumber||null,vehicle:vehicle.trim(),fromAt:at,toAt:null,assignedBy:i.user.id});g.fleet[vehicle.trim()].status=d.status==='on_duty'?'in_service':'allocated';}store.audit(g,'allocation_edit',i.user.id,{dutyId:d.id,dutyNumber:d.number,allocationNumber:d.allocationNumber,routes:d.routes,vehicle:vehicle||null});});
  await refreshAllocationsBoard(i.guildId);return i.reply({content:`✅ Duty **${duty.number}** live allocation edited. The public allocations sheet has been refreshed.`});
}

async function handleDefect(i) {
  const g=store.getGuild(i.guildId);if(!isDriver(i,g))return deny(i);
  if(!g.profiles[i.user.id])return i.reply({content:'⚠️ Create a driver profile first.',ephemeral:true});
  const c=store.activeClaimForUser(g,i.user.id),a=c?currentAllocation(g,c.dutyId):null;
  const vehicle=(i.options.getString('vehicle')||a?.vehicle||'').trim();if(!vehicle)return i.reply({content:'⚠️ No vehicle supplied and you do not have a current allocation.',ephemeral:true});
  const details=i.options.getString('details').trim(), defect={id:store.id('def'),vehicle,reporterId:i.user.id,dutyId:c?.dutyId||null,dutyNumber:c?.dutyNumber||null,routes:c?(g.duties[c.dutyId]?.routes||[]):[],details,status:'open',createdAt:store.now(),resolvedAt:null,resolvedBy:null,cancelledAt:null,cancelledBy:null};
  await store.mutateGuild(i.guildId,g=>{g.defects[defect.id]=defect;store.audit(g,'defect_report',i.user.id,{defectId:defect.id,vehicle,dutyNumber:defect.dutyNumber});});
  const e=ui.baseEmbed(g,'DEFECT REPORTED').setDescription(`🚌 **${vehicle}**\n${truncate(details,3000)}`).addFields({name:'Driver',value:`<@${i.user.id}>`,inline:true},{name:'Duty',value:defect.dutyNumber||'—',inline:true},{name:'Routes',value:defect.routes.join(', ')||'—',inline:true});
  await postConfigured(i.guildId,'defects',{content:`⚠️ New defect reported by ${i.user}`,embeds:[e]});
  return i.reply({content:`🔧 Defect **${defect.id}** recorded for **${vehicle}** and Control has been notified.`,ephemeral:true});
}

function defectRows(defects){
  return defects.slice(0,5).map(d=>new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`defect:fixed:${d.id}`).setLabel(`Fixed ${d.vehicle}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`defect:add:${d.id}`).setLabel('Report Defect').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`defect:cancel:${d.id}`).setLabel('Cancel Defect').setStyle(ButtonStyle.Danger)
  ));
}
async function handleDefects(i){
  const g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i,'Only Controllers/Supervisors can manage defects.');
  const ds=Object.values(g.defects).filter(d=>d.status==='open').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const text=ds.map(d=>`⚠️ **${d.vehicle}** • ${d.id}\n${truncate(d.details,250)}\nReported by <@${d.reporterId}> ${ui.shortTime(d.createdAt)}`).join('\n\n')||'✅ No active defects.';
  return i.reply({embeds:[ui.baseEmbed(g,'ACTIVE DEFECTS').setDescription(truncate(text,4000))],components:defectRows(ds),ephemeral:true});
}
async function handleDefectButton(i){
  const [_,action,id]=i.customId.split(':'),g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i);const d=g.defects[id];if(!d)return i.reply({content:'Defect no longer exists.',ephemeral:true});
  if(action==='add'){
    const modal=new ModalBuilder().setCustomId(`defectfollow:${id}`).setTitle(`Report another defect • ${d.vehicle}`);
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Defect details').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
    return i.showModal(modal);
  }
  const at=store.now();await store.mutateGuild(i.guildId,g=>{const x=g.defects[id];x.status=action==='fixed'?'fixed':'cancelled';if(action==='fixed'){x.resolvedAt=at;x.resolvedBy=i.user.id;}else{x.cancelledAt=at;x.cancelledBy=i.user.id;}store.audit(g,`defect_${action}`,i.user.id,{defectId:id,vehicle:x.vehicle});});
  return i.reply({content:action==='fixed'?`✅ **${d.vehicle}** defect marked fixed.`:`❌ Defect ${id} cancelled. Historical record retained.`,ephemeral:true});
}
async function handleDefectFollowModal(i){
  const id=i.customId.split(':')[1],g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i);const parent=g.defects[id];if(!parent)return i.reply({content:'Original defect not found.',ephemeral:true});
  const details=i.fields.getTextInputValue('details').trim(),d={id:store.id('def'),vehicle:parent.vehicle,reporterId:i.user.id,dutyId:parent.dutyId,dutyNumber:parent.dutyNumber,routes:parent.routes||[],details,status:'open',createdAt:store.now(),relatedDefectId:id};
  await store.mutateGuild(i.guildId,g=>{g.defects[d.id]=d;store.audit(g,'defect_report_staff',i.user.id,{defectId:d.id,vehicle:d.vehicle,relatedDefectId:id});});
  await postConfigured(i.guildId,'defects',{content:`⚠️ Additional defect on **${d.vehicle}** reported by ${i.user}: ${details}`});
  return i.reply({content:`⚠️ Additional defect recorded for **${d.vehicle}**.`,ephemeral:true});
}

async function handleControlMessage(i){
  const g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i,'Only Controllers/Supervisors can send Control messages.');
  const sub=i.options.getSubcommand();let recipients=[],targetLabel='';
  const message=i.options.getString('message');
  if(sub==='driver'){const u=i.options.getUser('user');recipients=[u.id];targetLabel=`Driver: ${u.tag}`;}
  if(sub==='route'){const rs=splitList(i.options.getString('routes'));recipients=store.activeDriversForRoutes(g,rs);targetLabel=`Route(s): ${rs.join(', ')}`;}
  if(sub==='duty'){const ds=splitList(i.options.getString('duties'));recipients=store.activeDriversForDuties(g,ds);targetLabel=`Duty/Duties: ${ds.join(', ')}`;}
  if(sub==='everyone'){recipients=store.allActiveDrivers(g);targetLabel='All currently signed-on drivers';}
  recipients=[...new Set(recipients)];if(!recipients.length)return i.reply({content:'⚠️ No currently matching drivers were found for that target.',ephemeral:true});
  const ch=await fetchChannel(i.guildId,g.config.channels.controlMessages);if(!ch)return i.reply({content:'⚠️ Configure a text channel for Control Messages using `/setup` first.',ephemeral:true});
  const record={id:store.id('msg'),senderId:i.user.id,targetType:sub,targetLabel,recipients,message,createdAt:store.now(),acknowledged:{}};
  await store.mutateGuild(i.guildId,g=>{g.controlMessages[record.id]=record;store.audit(g,'control_message',i.user.id,{messageId:record.id,targetType:sub,targetLabel,recipients});});
  const e=ui.baseEmbed(g,'CONTROL MESSAGE').setDescription(truncate(message,3500)).addFields({name:'Target',value:targetLabel},{name:'Sent by',value:`<@${i.user.id}>`,inline:true},{name:'Acknowledged',value:`0 / ${recipients.length}`,inline:true});
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ack:${record.id}`).setLabel('Acknowledge').setStyle(ButtonStyle.Success));
  await ch.send({content:mentionList(recipients),embeds:[e],components:[row],allowedMentions:{users:recipients}});
  return i.reply({content:`📡 Control message sent to **${recipients.length}** driver${recipients.length===1?'':'s'} in ${ch}.`,ephemeral:true});
}
async function handleAck(i){
  const id=i.customId.split(':')[1],g=store.getGuild(i.guildId),m=g.controlMessages[id];if(!m)return i.reply({content:'⚠️ This Control message is no longer in the database.',ephemeral:true});
  if(!m.recipients.includes(i.user.id))return i.reply({content:'This Control message was not addressed to you.',ephemeral:true});
  if(m.acknowledged[i.user.id])return i.reply({content:'✅ You already acknowledged this message.',ephemeral:true});
  await store.mutateGuild(i.guildId,g=>{g.controlMessages[id].acknowledged[i.user.id]=store.now();store.audit(g,'control_message_ack',i.user.id,{messageId:id});});
  const fresh=store.getGuild(i.guildId).controlMessages[id],count=Object.keys(fresh.acknowledged).length;
  const old=i.message.embeds[0];
  const e=EmbedBuilder.from(old);const fields=e.data.fields||[];const idx=fields.findIndex(f=>f.name==='Acknowledged');if(idx>=0)fields[idx].value=`${count} / ${fresh.recipients.length}`;e.setFields(fields);
  await i.update({embeds:[e],components:i.message.components});
}

async function handleRequest(i){
  const g=store.getGuild(i.guildId);if(!isDriver(i,g))return deny(i);if(!g.profiles[i.user.id])return i.reply({content:'Create a driver profile first.',ephemeral:true});
  const c=store.activeClaimForUser(g,i.user.id),category=i.options.getString('category'),details=i.options.getString('details');
  const r={id:store.id('req'),userId:i.user.id,dutyId:c?.dutyId||null,dutyNumber:c?.dutyNumber||null,category,details,status:'open',createdAt:store.now(),handledBy:null,resolvedAt:null};
  await store.mutateGuild(i.guildId,g=>{g.requests[r.id]=r;store.audit(g,'driver_request',i.user.id,{requestId:r.id,category,dutyNumber:r.dutyNumber});});
  const ch=await fetchChannel(i.guildId,g.config.channels.requests);if(ch){
    const e=ui.baseEmbed(g,'DRIVER REQUEST').setDescription(truncate(details,3500)).addFields({name:'Driver',value:`<@${i.user.id}>`,inline:true},{name:'Category',value:category.replaceAll('_',' '),inline:true},{name:'Duty',value:r.dutyNumber||'—',inline:true});
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`request:accept:${r.id}`).setLabel('Accept').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`request:reply:${r.id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`request:escalate:${r.id}`).setLabel('Escalate').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`request:resolve:${r.id}`).setLabel('Resolve').setStyle(ButtonStyle.Success));
    await ch.send({content:`🆘 ${i.user}`,embeds:[e],components:[row],allowedMentions:{users:[i.user.id]}});
  }
  return i.reply({content:`🆘 Request **${r.id}** sent to Control.`,ephemeral:true});
}
async function handleRequestButton(i){
  const [_,action,id]=i.customId.split(':'),g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i);const r=g.requests[id];if(!r)return i.reply({content:'Request not found.',ephemeral:true});
  if(action==='reply'){
    const modal=new ModalBuilder().setCustomId(`requestreply:${id}`).setTitle('Reply to Driver');modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reply').setLabel('Control reply').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));return i.showModal(modal);
  }
  await store.mutateGuild(i.guildId,g=>{const x=g.requests[id];if(action==='accept'){x.status='accepted';x.handledBy=i.user.id;}if(action==='escalate'){x.status='escalated';x.handledBy=i.user.id;}if(action==='resolve'){x.status='resolved';x.handledBy=i.user.id;x.resolvedAt=store.now();}store.audit(g,`request_${action}`,i.user.id,{requestId:id,userId:x.userId});});
  return i.reply({content:`✅ Request **${id}** → **${action}** by ${i.user}.`});
}
async function handleRequestReplyModal(i){
  const id=i.customId.split(':')[1],g=store.getGuild(i.guildId);if(!isStaff(i,g))return deny(i);const r=g.requests[id];if(!r)return i.reply({content:'Request not found.',ephemeral:true});const reply=i.fields.getTextInputValue('reply');
  await store.mutateGuild(i.guildId,g=>{const x=g.requests[id];x.replies=x.replies||[];x.replies.push({by:i.user.id,at:store.now(),message:reply});x.handledBy=i.user.id;if(x.status==='open')x.status='accepted';store.audit(g,'request_reply',i.user.id,{requestId:id,userId:x.userId});});
  return i.reply({content:`📡 <@${r.userId}> **Control reply:** ${reply}`,allowedMentions:{users:[r.userId]}});
}

async function handleIncident(i){
  const g=store.getGuild(i.guildId);if(!isDriver(i,g))return deny(i);if(!g.profiles[i.user.id])return i.reply({content:'Create a driver profile first.',ephemeral:true});const c=store.activeClaimForUser(g,i.user.id),a=c?currentAllocation(g,c.dutyId):null;
  const incident={id:store.id('inc'),userId:i.user.id,dutyId:c?.dutyId||null,dutyNumber:c?.dutyNumber||null,vehicle:i.options.getString('vehicle')||a?.vehicle||null,routes:c?(g.duties[c.dutyId]?.routes||[]):[],details:i.options.getString('details'),createdAt:store.now()};
  await store.mutateGuild(i.guildId,g=>{g.incidents[incident.id]=incident;store.audit(g,'incident',i.user.id,{incidentId:incident.id,dutyNumber:incident.dutyNumber,vehicle:incident.vehicle});});
  await postConfigured(i.guildId,'audit',{content:`🚨 **INCIDENT ${incident.id}** • ${i.user} • Duty ${incident.dutyNumber||'—'} • Vehicle ${incident.vehicle||'—'}\n${incident.details}`});
  return i.reply({content:`🚨 Incident **${incident.id}** permanently recorded.`,ephemeral:true});
}

async function handleBackup(i){
  const g=store.getGuild(i.guildId);if(!isAdmin(i,g))return deny(i,'Only SouthOps Admins / server managers can create backups.');store.backupNow();await audit(i.guildId,'manual_backup',i.user.id,{},`${i.user} created a manual SouthOps backup.`);return i.reply({content:'💾 Manual backup created successfully.',ephemeral:true});
}

client.on('interactionCreate', async i => {
  if(!i.guildId) return;
  try {
    if(i.isChatInputCommand()){
      const handlers={setup:handleSetup,config:handleConfig,profile:handleProfile,duty:handleDuty,duties:handleDuties,myduty:handleMyDuty,claims:handleClaims,driver:handleDriver,fleet:handleFleet,allocate:handleAllocate,allocations:handleAllocations,allocation:handleAllocationEdit,defect:handleDefect,defects:handleDefects,'control-message':handleControlMessage,request:handleRequest,incident:handleIncident,backup:handleBackup};
      if(handlers[i.commandName]) return await handlers[i.commandName](i);
    }
    if(i.isButton()){
      if(i.customId.startsWith('claim:'))return await handleClaimButton(i);
      if(i.customId.startsWith('myduty:'))return await handleMyDutyButton(i);
      if(i.customId.startsWith('driverclaims:'))return await handleDriverClaims(i);
      if(i.customId.startsWith('defect:'))return await handleDefectButton(i);
      if(i.customId.startsWith('ack:'))return await handleAck(i);
      if(i.customId.startsWith('request:'))return await handleRequestButton(i);
    }
    if(i.isModalSubmit()){
      if(i.customId==='profile:create'||i.customId==='profile:edit')return await handleProfileModal(i);
      if(i.customId.startsWith('defectfollow:'))return await handleDefectFollowModal(i);
      if(i.customId.startsWith('requestreply:'))return await handleRequestReplyModal(i);
    }
  } catch(err){
    console.error('Interaction error:',err);
    const msg={content:`❌ SouthOps error: ${truncate(err.message,1500)}`,ephemeral:true};
    try{if(i.replied||i.deferred)await i.followUp(msg);else await i.reply(msg);}catch{}
  }
});

client.once('clientReady',()=>{
  console.log(`SouthOps V4.0.3 TEST online as ${client.user.tag}`);
  console.log(`Persistent data: ${store.DATA_FILE}`);
});

async function main(){
  if(!process.env.DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN in .env');
  if(String(process.env.AUTO_DEPLOY_COMMANDS).toLowerCase()==='true'){
    console.log('Auto-deploying slash commands...');
    await require('./deploy-commands')();
  }
  await client.login(process.env.DISCORD_TOKEN);
}
main().catch(err=>{console.error(err);process.exit(1);});
