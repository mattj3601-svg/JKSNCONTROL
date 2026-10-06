const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('setup').setDescription('Configure SouthOps for this server')
    .addStringOption(o=>o.setName('company').setDescription('Company / operation name').setRequired(true))
    .addRoleOption(o=>o.setName('driver_role').setDescription('Driver role'))
    .addRoleOption(o=>o.setName('controller_role').setDescription('Controller role'))
    .addRoleOption(o=>o.setName('supervisor_role').setDescription('Supervisor role'))
    .addRoleOption(o=>o.setName('admin_role').setDescription('SouthOps admin role'))
    .addChannelOption(o=>o.setName('control_messages').setDescription('Channel for official Control messages'))
    .addChannelOption(o=>o.setName('defects').setDescription('Defect notifications channel'))
    .addChannelOption(o=>o.setName('requests').setDescription('Driver requests channel'))
    .addChannelOption(o=>o.setName('shift_activity').setDescription('Shift activity channel'))
    .addChannelOption(o=>o.setName('audit').setDescription('Audit/logging channel'))
    .addChannelOption(o=>o.setName('allocations').setDescription('Channel for the permanent live allocations board'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('config').setDescription('View or edit SouthOps configuration')
    .addSubcommand(s=>s.setName('view').setDescription('View configuration'))
    .addSubcommand(s=>s.setName('depot-add').setDescription('Add a depot').addStringOption(o=>o.setName('name').setDescription('Depot name').setRequired(true)))
    .addSubcommand(s=>s.setName('depot-remove').setDescription('Remove a depot').addStringOption(o=>o.setName('name').setDescription('Depot name').setRequired(true))),

  new SlashCommandBuilder()
    .setName('profile').setDescription('Driver profiles')
    .addSubcommand(s=>s.setName('create').setDescription('Create your driver profile'))
    .addSubcommand(s=>s.setName('edit').setDescription('Edit your driver profile'))
    .addSubcommand(s=>s.setName('view').setDescription('View a driver profile').addUserOption(o=>o.setName('user').setDescription('Driver to view'))),

  new SlashCommandBuilder()
    .setName('duty').setDescription('Duty management')
    .addSubcommand(s=>s.setName('create').setDescription('Create a duty')
      .addStringOption(o=>o.setName('number').setDescription('Duty number').setRequired(true))
      .addStringOption(o=>o.setName('routes').setDescription('Routes, comma-separated').setRequired(true))
      .addStringOption(o=>o.setName('start').setDescription('Scheduled start, e.g. 08:00'))
      .addStringOption(o=>o.setName('finish').setDescription('Scheduled finish, e.g. 18:30'))
      .addStringOption(o=>o.setName('depot').setDescription('Depot'))
      .addStringOption(o=>o.setName('notes').setDescription('Notes'))
      .addStringOption(o=>o.setName('allocation').setDescription('Allocation number, e.g. T101')))
    .addSubcommand(s=>s.setName('cancel').setDescription('Cancel a duty')
      .addStringOption(o=>o.setName('number').setDescription('Duty number').setRequired(true))
      .addStringOption(o=>o.setName('reason').setDescription('Reason'))),

  new SlashCommandBuilder().setName('duties').setDescription('Show current duties and claim available shifts'),
  new SlashCommandBuilder().setName('myduty').setDescription('View and manage your current duty'),
  new SlashCommandBuilder().setName('claims').setDescription('View live shift claims'),

  new SlashCommandBuilder().setName('driver').setDescription('Staff driver record')
    .addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)),

  new SlashCommandBuilder().setName('fleet').setDescription('Fleet management')
    .addSubcommand(s=>s.setName('add').setDescription('Add a bus')
      .addStringOption(o=>o.setName('vehicle').setDescription('Fleet number / vehicle ID').setRequired(true))
      .addStringOption(o=>o.setName('depot').setDescription('Depot'))
      .addStringOption(o=>o.setName('notes').setDescription('Notes')))
    .addSubcommand(s=>s.setName('list').setDescription('List active fleet').addStringOption(o=>o.setName('depot').setDescription('Filter depot')))
    .addSubcommand(s=>s.setName('remove').setDescription('Remove/archive a bus from the active fleet').addStringOption(o=>o.setName('vehicle').setDescription('Fleet number').setRequired(true)))
    .addSubcommand(s=>s.setName('restore').setDescription('Restore a removed bus').addStringOption(o=>o.setName('vehicle').setDescription('Fleet number').setRequired(true)))
    .addSubcommand(s=>s.setName('status').setDescription('Change vehicle status')
      .addStringOption(o=>o.setName('vehicle').setDescription('Vehicle').setRequired(true))
      .addStringOption(o=>o.setName('status').setDescription('Status').setRequired(true).addChoices(
        {name:'Available',value:'available'},{name:'Allocated',value:'allocated'},{name:'In Service',value:'in_service'},
        {name:'Spare',value:'spare'},{name:'VOR',value:'vor'},{name:'Engineering',value:'engineering'},{name:'Breakdown',value:'breakdown'}
      ))),

  new SlashCommandBuilder().setName('allocate').setDescription('Allocate/change a bus and allocation number on a duty')
    .addStringOption(o=>o.setName('duty').setDescription('Duty number').setRequired(true))
    .addStringOption(o=>o.setName('vehicle').setDescription('Fleet number / vehicle ID'))
    .addStringOption(o=>o.setName('allocation').setDescription('Allocation number, e.g. T101')),

  new SlashCommandBuilder().setName('allocations').setDescription('Show the live allocations sheet'),

  new SlashCommandBuilder().setName('allocation').setDescription('Edit live allocation details')
    .addSubcommand(s=>s.setName('edit').setDescription('Edit a duty allocation at any time')
      .addStringOption(o=>o.setName('duty').setDescription('Duty number').setRequired(true))
      .addStringOption(o=>o.setName('allocation').setDescription('Allocation number, e.g. T101'))
      .addStringOption(o=>o.setName('vehicle').setDescription('Fleet number'))
      .addStringOption(o=>o.setName('routes').setDescription('Replace duty routes, comma-separated')))
    .addSubcommand(s=>s.setName('clear').setDescription('Clear the live vehicle/allocation number from a duty')
      .addStringOption(o=>o.setName('duty').setDescription('Duty number').setRequired(true))),

  new SlashCommandBuilder().setName('defect').setDescription('Report a vehicle defect')
    .addStringOption(o=>o.setName('details').setDescription('Defect details').setRequired(true))
    .addStringOption(o=>o.setName('vehicle').setDescription('Vehicle (leave blank to use current allocation)')),

  new SlashCommandBuilder().setName('defects').setDescription('View/manage active defects'),

  new SlashCommandBuilder().setName('control-message').setDescription('Send an official Control message')
    .addSubcommand(s=>s.setName('driver').setDescription('Message a specific driver')
      .addUserOption(o=>o.setName('user').setDescription('Driver').setRequired(true))
      .addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)))
    .addSubcommand(s=>s.setName('route').setDescription('Message drivers on one or more routes')
      .addStringOption(o=>o.setName('routes').setDescription('Routes, comma-separated').setRequired(true))
      .addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)))
    .addSubcommand(s=>s.setName('duty').setDescription('Message drivers on one or more duties')
      .addStringOption(o=>o.setName('duties').setDescription('Duty numbers, comma-separated').setRequired(true))
      .addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)))
    .addSubcommand(s=>s.setName('everyone').setDescription('Message all currently signed-on drivers')
      .addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true))),

  new SlashCommandBuilder().setName('request').setDescription('Send a request to Control')
    .addStringOption(o=>o.setName('category').setDescription('Request category').setRequired(true).addChoices(
      {name:'Running Late',value:'running_late'},{name:'Vehicle Problem',value:'vehicle_problem'},
      {name:'Passenger Issue',value:'passenger_issue'},{name:'Accident / Incident',value:'accident_incident'},
      {name:'Route Assistance',value:'route_assistance'},{name:'Lost Property',value:'lost_property'},{name:'Other',value:'other'}
    ))
    .addStringOption(o=>o.setName('details').setDescription('What do you need from Control?').setRequired(true)),

  new SlashCommandBuilder().setName('incident').setDescription('Record an operational incident')
    .addStringOption(o=>o.setName('details').setDescription('Incident details').setRequired(true))
    .addStringOption(o=>o.setName('vehicle').setDescription('Vehicle')),

  new SlashCommandBuilder().setName('backup').setDescription('Create a manual SouthOps data backup')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

module.exports = commands.map(c => c.toJSON());
