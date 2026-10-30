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

    // 5. Invariant checks (rosters change week to week, so avoid asserting specific player names)
    const myRoster = leagueData.rosteredPlayers.filter(p => String(p.onRoster) === '8');
    const pickups = optimalLineup.filter(p => p.highlight === 'pickup');
    const drops = fullBench.filter(p => p.highlight === 'drop');
    assert.ok(drops.length <= pickups.length, 'Drops should not exceed pickups');
    for (const pk of pickups) {
        assert.strictEqual(pk.onRoster, 0, `Pickup ${pk.name} must be a free agent`);
        assert.strictEqual(pk.badge, 'PICKUP');
        assert.ok(pk.targetDrop, `Pickup ${pk.name} should be paired with a drop`);
        assert.ok(drops.some(d => d.name === pk.targetDrop), `Paired drop ${pk.targetDrop} must be on the bench list`);
    }
    for (const d of drops) {
        assert.strictEqual(d.badge, 'DROP');
        assert.ok(pickups.some(pk => pk.name === d.targetPickup), `Drop ${d.name} must be paired with a pickup`);
    }
    console.log(`\n[PASS] ${pickups.length} pickups are free agents, each paired 1:1 with a drop`);

    // Every rostered player appears exactly once, either in the lineup or on the bench
    for (const p of myRoster) {
        const inLineup = optimalLineup.filter(o => o.name === p.name && o.onRoster !== 0).length;
        const onBench = fullBench.filter(b => b.name === p.name).length;
        assert.strictEqual(inLineup + onBench, 1, `${p.name} must appear exactly once in lineup or bench`);
    }
    console.log(`[PASS] All ${myRoster.length} rostered players accounted for exactly once`);

    // K/DST pickups swap out a same-position player when one is available
    for (const pk of pickups.filter(p => p.position === 'K' || p.position === 'DST')) {
        const samePosOnBench = myRoster.some(p => p.position === pk.position && fullBench.some(b => b.name === p.name));
        if (samePosOnBench) {
            const drop = fullBench.find(b => b.name === pk.targetDrop);
            assert.strictEqual(drop.position, pk.position, `${pk.position} pickup ${pk.name} should drop a ${pk.position}`);
        }
    }
    console.log('[PASS] K/DST pickups are paired with same-position drops');

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

    // Suggested pickups are flagged in the ranking columns; rostered players never are
    for (const [pos, col] of Object.entries(weeklyCols)) {
        for (const p of col.players) {
            const isPick = pickupNames.has(PlayerMatcher.normalizeName(p.name));
            assert.strictEqual(p.isPickup, isPick, `${pos} column: ${p.name} isPickup should be ${isPick}`);
            if (String(p.onRoster) === '8') {
                assert.strictEqual(p.isPickup, false, `Rostered player ${p.name} must not be flagged as a pickup`);
            }
        }
    }
    for (const col of Object.values(rosCols)) {
        for (const p of col.players) {
            assert.strictEqual(p.isPickup, pickupNames.has(PlayerMatcher.normalizeName(p.name)));
        }
    }
    console.log('[PASS] Weekly and ROS columns flag exactly the suggested pickups');

    console.log('\nALL SLEEPER TEST SUITE CHECKS PASSED! [OK]');
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
