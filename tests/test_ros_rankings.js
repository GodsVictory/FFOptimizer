/**
 * Automated test suite for Rest of Season (ROS) rankings loading, caching,
 * player matching, and positional column generation.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Mock axios for Node environment to read from local files
global.axios = {
    get: async (url) => {
        if (url.startsWith('data/')) {
            const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', url), 'utf8'));
            return { data };
        }
        const res = await fetch(url);
        return { data: await res.json() };
    }
};

const CONFIG = require('../js/config.js');
const FantasyProsService = require('../js/services/fantasyProsService.js');
const PlayerMatcher = require('../js/playerMatcher.js');
const OptimizerService = require('../js/services/optimizerService.js');
const SleeperService = require('../js/services/sleeperService.js');

console.log('--- RUNNING REST OF SEASON (ROS) RANKINGS TESTS ---\n');

async function run() {
    // 1. Verify existence of ROS ranking files
    console.log('1. Checking ROS JSON files on disk...');
    const positions = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];
    const scorings = ['STD', 'HALF', 'PPR'];
    let totalFilesChecked = 0;

    for (const s of scorings) {
        for (const pos of positions) {
            const fpath = path.join(__dirname, '..', 'data', `ROS-${s}-${pos}.json`);
            assert.ok(fs.existsSync(fpath), `File should exist: ${fpath}`);
            const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
            assert.ok(Array.isArray(data), `${fpath} should contain an array`);
            assert.ok(data.length > 0, `${fpath} should not be empty`);
            totalFilesChecked++;
        }
    }
    console.log(`   [PASS] All ${totalFilesChecked} ROS ranking files verified on disk.`);

    // 2. Test FantasyProsService.fetchRosRankings()
    console.log('\n2. Testing FantasyProsService.fetchRosRankings()...');
    const rosPpr = await FantasyProsService.fetchRosRankings('PPR');
    assert.strictEqual(typeof rosPpr, 'object');
    for (const pos of positions) {
        assert.ok(Array.isArray(rosPpr[pos]), `rosPpr.${pos} should be an array`);
        assert.ok(rosPpr[pos].length > 0, `rosPpr.${pos} should contain players`);
    }
    console.log(`   [PASS] fetchRosRankings('PPR') loaded all 7 positions successfully.`);

    // Test in-memory caching
    const startCache = Date.now();
    const cachedPpr = await FantasyProsService.fetchRosRankings('PPR');
    const cacheElapsed = Date.now() - startCache;
    assert.strictEqual(cachedPpr, rosPpr, 'Subsequent fetch should return cached reference');
    console.log(`   [PASS] In-memory caching works instantly (${cacheElapsed}ms).`);

    // 3. Test ROS Player Matching and Positional Column Generation with Sleeper League
    console.log('\n3. Testing ROS matching with Sleeper League 1389343427119828992 Owner 8...');
    const leagueData = await SleeperService.loadLeagueData('1389343427119828992');
    const owner8Players = leagueData.rosteredPlayers.filter(p => String(p.onRoster) === '8');
    assert.ok(owner8Players.length > 0, 'Owner 8 should have rostered players');

    // Clone rostered players and match ROS ranks
    const rosRoster = leagueData.rosteredPlayers.map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        onRoster: p.onRoster,
        starter: p.starter,
        rank: -1,
        flxRank: -1
    }));
    const rosIndex = PlayerMatcher.createIndex(rosRoster);
    const rosUnrosteredMap = new Map();

    for (const [pos, playerList] of Object.entries(rosPpr)) {
        const isFlex = (pos === 'FLX');
        for (const fpPlayer of playerList) {
            const matchedRosterPlayer = rosIndex.find(fpPlayer.name, pos);
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

                let entry = rosUnrosteredMap.get(key);
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
                    rosUnrosteredMap.set(key, entry);
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

    const allRosRankedPlayers = [...rosRoster, ...rosUnrosteredMap.values()];

    // Generate ROS position columns for Owner 8
    const rosColumns = OptimizerService.buildPositionColumns(allRosRankedPlayers, '8', 'WRT');

    for (const pos of positions) {
        assert.ok(rosColumns[pos], `ROS column for ${pos} must exist`);
        assert.ok(rosColumns[pos].players.length > 0, `ROS column for ${pos} must have players`);
        assert.ok(rosColumns[pos].players.length <= 10, `ROS column for ${pos} capped at 10`);
    }

    // Verify Owner 8's star players appear on ROS cards with onRoster flag
    const rbCol = rosColumns['RB'];
    const bijan = rbCol.players.find(p => p.name.includes('Bijan Robinson'));
    assert.ok(bijan, 'Bijan Robinson should be in top 10 ROS RB');
    assert.strictEqual(String(bijan.onRoster), '8', 'Bijan Robinson should be flagged on Owner 8 roster in ROS');
    console.log(`   [PASS] ROS RB #1/#2: ${bijan.name} (Rank #${bijan.rank}, onRoster: ${bijan.onRoster})`);

    const qbCol = rosColumns['QB'];
    console.log('   [+] ROS QB Top 5:');
    qbCol.players.slice(0, 5).forEach(p => {
        const rosteredTag = String(p.onRoster) === '8' ? ' [ROSTERED]' : '';
        console.log(`       #${p.rank} ${p.name}${rosteredTag}`);
    });

    console.log('\nALL ROS RANKINGS TESTS PASSED! [OK]');
}

run().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
