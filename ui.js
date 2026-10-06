const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function companyName(guildData) { return guildData?.config?.companyName || 'SouthOps'; }
function fmtMs(ms = 0) {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function fmtTime(iso) {
  if (!iso) return '—';
  return `<t:${Math.floor(new Date(iso).getTime()/1000)}:f>`;
}
function shortTime(iso) {
  if (!iso) return '—';
  return `<t:${Math.floor(new Date(iso).getTime()/1000)}:t>`;
}
function baseEmbed(g, title) {
  return new EmbedBuilder().setTitle(`${companyName(g)} • ${title}`).setColor(0x2b7cff).setTimestamp();
}
function dutyStatusLabel(status) {
  return ({available:'🟢 AVAILABLE', claimed:'🔵 CLAIMED', on_duty:'🟡 ON DUTY', completed:'✅ COMPLETED', cancelled:'❌ CANCELLED'})[status] || status.toUpperCase();
}
function claimStatusLabel(status) {
  return ({claimed:'🔵 CLAIMED', on_duty:'🟡 ON DUTY', completed:'✅ COMPLETED', released:'↩️ RELEASED', cancelled:'❌ CANCELLED', no_sign_on:'⚠️ NO SIGN-ON'})[status] || status;
}
function dutyEmbed(g, duty, claim = null) {
  const e = baseEmbed(g, `DUTY ${duty.number}`)
    .addFields(
      { name:'Status', value:dutyStatusLabel(duty.status), inline:true },
      { name:'Routes', value:(duty.routes || []).join(', ') || 'Not set', inline:true },
      { name:'Allocation', value:duty.allocationNumber || '—', inline:true },
      { name:'Depot', value:duty.depot || 'Not set', inline:true },
      { name:'Scheduled', value:`${duty.startTime || '—'} → ${duty.endTime || '—'}`, inline:true }
    );
  if (claim) e.addFields({ name:'Driver', value:`<@${claim.userId}>`, inline:true }, {name:'Claimed',value:shortTime(claim.claimedAt),inline:true});
  if (duty.notes) e.addFields({name:'Notes',value:duty.notes.slice(0,1024)});
  return e;
}
function myDutyButtons(claim) {
  const row = new ActionRowBuilder();
  if (claim.status === 'claimed') {
    row.addComponents(
      new ButtonBuilder().setCustomId('myduty:signon').setLabel('Sign On').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('myduty:release').setLabel('Release Claim').setStyle(ButtonStyle.Secondary)
    );
  } else if (claim.status === 'on_duty') {
    const onBreak = (claim.breaks || []).some(b => !b.endAt);
    row.addComponents(
      new ButtonBuilder().setCustomId(onBreak ? 'myduty:endbreak' : 'myduty:startbreak').setLabel(onBreak ? 'End Break' : 'Start Break').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('myduty:signoff').setLabel('Sign Off').setStyle(ButtonStyle.Danger)
    );
  }
  return row.components.length ? [row] : [];
}
module.exports = { fmtMs, fmtTime, shortTime, baseEmbed, dutyEmbed, myDutyButtons, dutyStatusLabel, claimStatusLabel };
