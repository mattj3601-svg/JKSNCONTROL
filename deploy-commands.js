require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

async function deploy() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID are required in .env');
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Deployed ${commands.length} commands to test guild ${GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`Deployed ${commands.length} global commands.`);
  }
}

if (require.main === module) deploy().catch(e => { console.error(e); process.exit(1); });
module.exports = deploy;
