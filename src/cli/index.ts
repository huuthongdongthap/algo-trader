// CLI entry point - Commander.js program setup
// algo: Algorithmic trading platform CLI

import { Command } from 'commander';
import { createRequire } from 'module';

// Existing commands (no dispatcher needed)
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { backtestCommand } from './commands/backtest.js';
import { configCommand } from './commands/config-cmd.js';
import { hedgeScanCommand } from './commands/hedge-scan.js';

// Agent dispatcher
import { AgentDispatcher } from '../agents/agent-dispatcher.js';

// Specialist agents
import { ScannerAgent } from '../agents/scanner-agent.js';
import { MonitorAgent } from '../agents/monitor-agent.js';
import { EstimateAgent } from '../agents/estimate-agent.js';
import { RiskAgent } from '../agents/risk-agent.js';
import { CalibrateAgent } from '../agents/calibrate-agent.js';
import { ReportAgent } from '../agents/report-agent.js';
import { DoctorAgent } from '../agents/doctor-agent.js';

// Dark edge agents (P1)
import { NegRiskScanAgent } from '../agents/neg-risk-scan-agent.js';
import { EndgameAgent } from '../agents/endgame-agent.js';
import { ResolutionArbAgent } from '../agents/resolution-arb-agent.js';
import { WhaleWatchAgent } from '../agents/whale-watch-agent.js';

// Dark edge agents (P2)
import { EventClusterAgent } from '../agents/event-cluster-agent.js';
import { VolumeAlertAgent } from '../agents/volume-alert-agent.js';
import { SplitMergeArbAgent } from '../agents/split-merge-arb-agent.js';

// Dark edge agents (P3)
import { NewsSniperAgent } from '../agents/news-snipe-agent.js';
import { ContrarianAgent } from '../agents/contrarian-agent.js';

// HFT + Admin agents
import { SeedAdminAgent } from '../agents/seed-admin-agent.js';
import { WarmModelAgent } from '../agents/warm-model-agent.js';
import { HftLoopAgent } from '../agents/hft-loop-agent.js';

// Agent-dispatched command creators
import { createScanCommand } from './commands/scan-cmd.js';
import { createMonitorCommand } from './commands/monitor-cmd.js';
import { createEstimateCommand } from './commands/estimate-cmd.js';
import { createRiskCommand } from './commands/risk-cmd.js';
import { createCalibrateCommand } from './commands/calibrate-cmd.js';
import { createReportCommand } from './commands/report-cmd.js';
import { createDoctorCommand } from './commands/doctor-cmd.js';

// Dark edge command creators (P1)
import { createNegRiskScanCommand } from './commands/neg-risk-scan-cmd.js';
import { createEndgameCommand } from './commands/endgame-cmd.js';
import { createResolutionArbCommand } from './commands/resolution-arb-cmd.js';
import { createWhaleWatchCommand } from './commands/whale-watch-cmd.js';

// Dark edge command creators (P2)
import { createEventClusterCommand } from './commands/event-cluster-cmd.js';
import { createVolumeAlertCommand } from './commands/volume-alert-cmd.js';
import { createSplitMergeArbCommand } from './commands/split-merge-arb-cmd.js';

// Dark edge command creators (P3)
import { createNewsSniperCommand } from './commands/news-snipe-cmd.js';
import { createContrarianCommand } from './commands/contrarian-cmd.js';

// HFT + Admin command creators
import { createSeedAdminCommand } from './commands/seed-admin-cmd.js';
import { createWarmModelCommand } from './commands/warm-model-cmd.js';
import { createHftLoopCommand } from './commands/hft-loop-cmd.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg = require('../../package.json') as { version: string; description: string };

const program = new Command();

program
  .name('algo')
  .description(pkg.description)
  .version(pkg.version)
  .option('-v, --verbose', 'enable verbose/debug logging')
  .option('--config-file <path>', 'path to .env config file (default: .env)');

// Existing commands
program.addCommand(startCommand);
program.addCommand(statusCommand);
program.addCommand(backtestCommand);
program.addCommand(configCommand);
program.addCommand(hedgeScanCommand);

// Setup dispatcher and register all specialist agents
const dispatcher = new AgentDispatcher();
dispatcher.register(new ScannerAgent());
dispatcher.register(new MonitorAgent());
dispatcher.register(new EstimateAgent());
dispatcher.register(new RiskAgent());
dispatcher.register(new CalibrateAgent());
dispatcher.register(new ReportAgent());
dispatcher.register(new DoctorAgent());
dispatcher.register(new NegRiskScanAgent());
dispatcher.register(new EndgameAgent());
dispatcher.register(new ResolutionArbAgent());
dispatcher.register(new WhaleWatchAgent());
dispatcher.register(new EventClusterAgent());
dispatcher.register(new VolumeAlertAgent());
dispatcher.register(new SplitMergeArbAgent());
dispatcher.register(new NewsSniperAgent());
dispatcher.register(new ContrarianAgent());
dispatcher.register(new SeedAdminAgent());
dispatcher.register(new WarmModelAgent());
const hftAgent = new HftLoopAgent();
hftAgent.setDispatcher(dispatcher);
dispatcher.register(hftAgent);

// Agent-dispatched commands
createScanCommand(program, dispatcher);
createMonitorCommand(program, dispatcher);
createEstimateCommand(program, dispatcher);
createRiskCommand(program, dispatcher);
createCalibrateCommand(program, dispatcher);
createReportCommand(program, dispatcher);
createDoctorCommand(program, dispatcher);
createNegRiskScanCommand(program, dispatcher);
createEndgameCommand(program, dispatcher);
createResolutionArbCommand(program, dispatcher);
createWhaleWatchCommand(program, dispatcher);
createEventClusterCommand(program, dispatcher);
createVolumeAlertCommand(program, dispatcher);
createSplitMergeArbCommand(program, dispatcher);
createNewsSniperCommand(program, dispatcher);
createContrarianCommand(program, dispatcher);
createSeedAdminCommand(program, dispatcher);
createWarmModelCommand(program, dispatcher);
createHftLoopCommand(program, dispatcher);

// Meta command: list all registered specialist agents
program
  .command('agents')
  .description('List registered specialist agents')
  .action(() => {
    console.log(JSON.stringify(dispatcher.listAgents(), null, 2));
  });

program.parse(process.argv);
