/**
 * Automated test simulating the exact user scenario:
 * Platform: Sleeper
 * League ID: 1389343427119828992
 * Owner: 8 (Reidolph)
 * Scoring: PPR
 * Flex: WRT
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.axios = {
    get: async (url) => {
        if (url.startsWith('data/')) {
            const data = JSON.parse(fs.readFileSync(url, 'utf8'));
            return { data };
        }
        const res = await fetch(url);
        return { data: await res.json() };
    }
};

const SleeperService = require('../js/services/sleeperService.js');
const PlayerMatcher = require('../js/playerMatcher.js');
const OptimizerService = require('../js/services/optimizerService.js');

async function run() {
    console.log('--- TESTING SLEEPER LEAGUE 1389343427119828992 OWNER 8 ---');

    // 1. Fetch league data
    const leagueData = await SleeperService.loadLeagueData('1389343427119828992');
    assert.ok(leagueData.rosteredPlayers.length > 0, 'Rostered players should not be empty');
    assert.strictEqual(leagueData.leagueName, 'Fantasyland', 'League name should be Fantasyland');
    console.log(`[+] Found League: ${leagueData.leagueName}`);
    
    // Owner 8 verification
    const owner8 = leagueData.owners.find(o => String(o.id) === '8');
    assert.ok(owner8, 'Owner 8 should exist');
    console.log(`[+] Found Owner 8: ${owner8.owner}`);

    // 2. Load PPR rankings from local cache
    const positions = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];
    const fpData = {};
    for (const pos of positions) {
        fpData[pos] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `PPR-${pos}.json`), 'utf8'));
    }

    // 3. Match rankings into rostered players + unrostered free agents
    const index = PlayerMatcher.createIndex(leagueData.rosteredPlayers);
    for (const p of leagueData.rosteredPlayers) {
        p.rank = -1;
        p.flxRank = -1;
    }

    const unrosteredMap = new Map();
    for (const [pos, playerList] of Object.entries(fpData)) {
        const isFlex = (pos === 'FLX');
        for (const fpPlayer of playerList) {
            const matchedRosterPlayer = index.find(fpPlayer.name, pos);
            if (matchedRosterPlayer) {
                if (isFlex) {
                    matchedRosterPlayer.flxRank = fpPlayer.rank;
                } else {
                    matchedRosterPlayer.rank = fpPlayer.rank;
                }
            } else {
                const cleanName = PlayerMatcher.normalizeName(fpPlayer.name);
                const playerPos = fpPlayer.position || pos;
                const key = cleanName + '_' + (playerPos === 'FLX' ? '' : playerPos);

                let entry = unrosteredMap.get(key);
                if (!entry) {
                    entry = {
                        id: fpPlayer.id || false,
                        name: (fpPlayer.name || '').replace(/\./g, ''),
                        position: playerPos,
                        onRoster: 0,
                        starter: false,
                        rank: -1,
                        flxRank: -1
                    };
                    unrosteredMap.set(key, entry);
                }

                if (isFlex) {
                    entry.flxRank = fpPlayer.rank;
                } else {
                    entry.rank = fpPlayer.rank;
                    if (playerPos !== 'FLX') {
                        entry.position = playerPos;
                    }
                }
            }
        }
    }

    const allRankedPlayers = [...leagueData.rosteredPlayers, ...unrosteredMap.values()];

    // 4. Solve lineup
    const { optimalLineup, fullBench, benchAlerts } = OptimizerService.solveLineup(
        allRankedPlayers,
        leagueData.startingSlots,
        '8',
        'WRT'
    );

    console.log('\n[+] Optimal Starting Lineup:');
    optimalLineup.forEach(p => {
        console.log(`    - ${p.slot.padEnd(5)} | ${p.name.padEnd(25)} | #${String(p.rank).padEnd(4)} | Highlight: ${p.highlight.padEnd(8)} | Badge: ${p.badge || '-'}`);
    });

    console.log('\n[+] Full Bench:');
    fullBench.forEach(p => {
        console.log(`    - ${p.position.padEnd(5)} | ${p.name.padEnd(25)} | #${String(p.rank).padEnd(4)} | Highlight: ${p.highlight.padEnd(8)} | Badge: ${p.badge || '-'}`);
    });

    // 5. Assertions for user's specific test cases
    // Case 1: Philadelphia Eagles DST is available and ranked #1, should be recommended as PICKUP
    const eagles = optimalLineup.find(p => p.name === 'Philadelphia Eagles');
    assert.ok(eagles, 'Philadelphia Eagles DST should be in optimal lineup');
    assert.strictEqual(eagles.slot, 'DST');
    assert.strictEqual(eagles.highlight, 'pickup');
    assert.strictEqual(eagles.badge, 'PICKUP');
    console.log('\n[PASS] Philadelphia Eagles DST correctly recommended as PICKUP');

    // Case 2: Jacksonville Jaguars DST was starting, displaced by Eagles, should be recommended as DROP
    const jaguars = fullBench.find(p => p.name === 'Jacksonville Jaguars');
    assert.ok(jaguars, 'Jacksonville Jaguars DST should be on bench');
    assert.strictEqual(jaguars.highlight, 'drop');
    assert.strictEqual(jaguars.badge, 'DROP');
    console.log('[PASS] Jacksonville Jaguars DST correctly recommended as DROP');

    // Case 3: Owner 8 has 5 normal bench players, they should all be in fullBench
    const expectedBenchPlayers = [
        'Patrick Mahomes',
        'Aaron Jones',
        'Marvin Harrison',
        'Jakobi Meyers',
        'Jayden Reed'
    ];
    for (const bName of expectedBenchPlayers) {
        const found = fullBench.find(p => p.name === bName);
        assert.ok(found, `Expected bench player ${bName} must be present in fullBench`);
        assert.strictEqual(found.highlight, 'none');
        console.log(`[PASS] Bench player ${bName} (#${found.rank}) present in fullBench`);
    }

    // Case 4: Verify suggested pickups are highlighted in Weekly and ROS rankings
    const FantasyProsService = require('../js/services/fantasyProsService.js');
    const rosData = await FantasyProsService.fetchRosRankings('PPR');
    const rosRoster = leagueData.rosteredPlayers.map(p => ({ ...p, rank: -1, flxRank: -1 }));
    const rosIndex = PlayerMatcher.createIndex(rosRoster);
    const rosUnrosteredMap = new Map();
    for (const [pos, list] of Object.entries(rosData)) {
        const isFlex = (pos === 'FLX');
        for (const fp of list) {
            const matched = rosIndex.find(fp.name, pos);
            if (matched) {
                if (isFlex) matched.flxRank = fp.rank;
                else matched.rank = fp.rank;
            } else {
                const clean = PlayerMatcher.normalizeName(fp.name);
                const playerPos = fp.position || pos;
                const key = clean + '_' + (playerPos === 'FLX' ? '' : playerPos);
                let entry = rosUnrosteredMap.get(key);
                if (!entry) {
                    entry = { id: fp.id || false, name: (fp.name || '').replace(/\./g, ''), position: playerPos, onRoster: 0, starter: false, rank: -1, flxRank: -1 };
                    rosUnrosteredMap.set(key, entry);
                }
                if (isFlex) entry.flxRank = fp.rank;
                else { entry.rank = fp.rank; if (playerPos !== 'FLX') entry.position = playerPos; }
            }
        }
    }
    const allRosRankedPlayers = [...rosRoster, ...rosUnrosteredMap.values()];

    const pickupNames = new Set(
        optimalLineup
            .filter(p => p.highlight === 'pickup')
            .map(p => PlayerMatcher.normalizeName(p.name))
    );

    const weeklyCols = OptimizerService.buildPositionColumns(allRankedPlayers, '8', 'WRT', pickupNames);
    const rosCols = OptimizerService.buildPositionColumns(allRosRankedPlayers, '8', 'WRT', pickupNames);

    // Verify Eagles DST in weekly and ROS rankings
    const eaglesWeekly = weeklyCols['DST'].players.find(p => p.name === 'Philadelphia Eagles');
    assert.ok(eaglesWeekly, 'Eagles DST must be in weekly DST column');
    assert.strictEqual(eaglesWeekly.isPickup, true, 'Eagles DST must be flagged isPickup in Weekly');
    console.log('[PASS] Weekly DST rankings correctly highlights Philadelphia Eagles DST as isPickup: true');

    const eaglesRos = rosCols['DST'].players.find(p => p.name === 'Philadelphia Eagles');
    assert.ok(eaglesRos, 'Eagles DST must be in ROS DST column');
    assert.strictEqual(eaglesRos.isPickup, true, 'Eagles DST must be flagged isPickup in ROS');
    console.log('[PASS] ROS DST rankings correctly highlights Philadelphia Eagles DST as isPickup: true');

    // Verify rostered player (e.g. Bijan Robinson) is NOT marked isPickup
    const bijanWeekly = weeklyCols['RB'].players.find(p => p.name.includes('Bijan Robinson'));
    assert.ok(bijanWeekly, 'Bijan Robinson must be in weekly RB column');
    assert.strictEqual(bijanWeekly.isPickup, false, 'Bijan Robinson must have isPickup: false');
    assert.strictEqual(String(bijanWeekly.onRoster), '8', 'Bijan Robinson must have onRoster: 8');
    console.log('[PASS] Rostered player Bijan Robinson has onRoster: 8 and isPickup: false');

    console.log('\nALL SLEEPER TEST SUITE CHECKS PASSED! [OK]');
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
