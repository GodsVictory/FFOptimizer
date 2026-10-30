/**
 * End-to-end simulation with actual repository data/*.json files
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CONFIG = require('../js/config.js');
const PlayerMatcher = require('../js/playerMatcher.js');
const YahooService = require('../js/services/yahooService.js');
const OptimizerService = require('../js/services/optimizerService.js');

console.log('--- RUNNING END-TO-END DATA INTEGRATION TEST ---\n');

// 1. Load actual FantasyPros ranking data
const dataDir = path.join(__dirname, '..', 'data');
const positions = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];
const fpData = {};

for (const pos of positions) {
    const filePath = path.join(dataDir, `STD-${pos}.json`);
    assert.ok(fs.existsSync(filePath), `Ranking file must exist: ${filePath}`);
    const raw = fs.readFileSync(filePath, 'utf8');
    fpData[pos] = JSON.parse(raw);
    assert.ok(Array.isArray(fpData[pos]), `${pos} rankings must be an array`);
    console.log(`[+] Loaded actual STD-${pos}.json: ${fpData[pos].length} players`);
}

// 2. Build a Yahoo-style roster from players that exist in the current data files, so the test
//    doesn't break when the bundled rankings are refreshed and a hardcoded player drops out.
const pick = (pos, i) => fpData[pos][i].name;
const rosterLines = [
    ['QB', pick('QB', 0), 'QB'],
    ['RB', pick('RB', 0), 'RB'],
    ['RB', pick('RB', 1), 'RB'],
    ['WR', pick('WR', 0), 'WR'],
    ['WR', pick('WR', 1), 'WR'],
    ['TE', pick('TE', 0), 'TE'],
    ['W/R/T', pick('RB', 2), 'RB'],
    ['K', pick('K', 0), 'K'],
    ['DEF', pick('DST', 0), 'DEF'],
    ['BN', pick('RB', 3), 'RB'],
    ['BN', pick('WR', 2), 'WR']
];
const yahooRosterText = 'Pos\tPlayer\tOpp\tStatus\n' +
    rosterLines.map(([slot, name, pos]) => `${slot}\t${name} Tm - ${pos}\tvsOPP\tSun 1:00pm`).join('\n');

const parsed = YahooService.parseRosterText(yahooRosterText);
console.log(`\n[+] Parsed ${parsed.rosteredPlayers.length} players from Yahoo roster.`);

// 3. Match players to actual FantasyPros rankings
const index = PlayerMatcher.createIndex(parsed.rosteredPlayers);

let matchedCount = 0;
for (const [pos, list] of Object.entries(fpData)) {
    const isFlex = (pos === 'FLX');
    for (const fpPlayer of list) {
        const found = index.find(fpPlayer.name, pos);
        if (found) {
            if (isFlex) {
                found.flxRank = fpPlayer.rank;
            } else {
                found.rank = fpPlayer.rank;
                matchedCount++;
            }
        }
    }
}

console.log(`\n[+] Players matched with actual FantasyPros ranks:`);
for (const p of parsed.rosteredPlayers) {
    console.log(`    - ${p.slot.padEnd(5)} | ${p.name.padEnd(20)} | Pos: ${p.position} | Rank: #${p.rank} | FlxRank: #${p.flxRank}`);
    assert.ok(p.rank > -1, `Player ${p.name} should match with real rank`);
}

// 4. Run Optimizer on real data
const { optimalLineup, benchAlerts } = OptimizerService.solveLineup(
    parsed.rosteredPlayers,
    parsed.startingSlots,
    1,
    'WRT'
);

console.log(`\n[+] Optimal Lineup:`);
optimalLineup.forEach(slot => {
    console.log(`    - ${slot.slot.padEnd(5)} | ${slot.name.padEnd(20)} | Rank: #${slot.rank} | Status: ${slot.highlight}`);
});

assert.strictEqual(optimalLineup.length, 9, 'Should produce 9 starters');
console.log('\n[PASS] End-to-end integration test with real data succeeded!');
