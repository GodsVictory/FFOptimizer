/**
 * Runs the test suite. Offline tests always run; tests that hit live Sleeper/FantasyPros APIs
 * (and depend on current league rosters) only run with --live.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const OFFLINE = [
    'test_optimizer.js',
    'test_fixes.js',
    'test_real_data.js',
    'test_query_params.js',
    'test_league_history.js',
    'test_chart_selection.js',
    'serve_check.js'
];
const LIVE = [
    'test_live_rankings.js',
    'test_rankings_cache.js',
    'test_ros_rankings.js',
    'test_etienne_rank.js',
    'test_sleeper_league.js'
];

const files = process.argv.includes('--live') ? [...OFFLINE, ...LIVE] : OFFLINE;
const failed = [];

for (const file of files) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', timeout: 120000 });
    if (result.status === 0) {
        console.log(`PASS  ${file}`);
    } else {
        failed.push(file);
        console.log(`FAIL  ${file}`);
        console.log((result.stdout || '').split('\n').slice(-15).join('\n'));
        console.log(result.stderr || '');
    }
}

console.log(`\n${files.length - failed.length}/${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
