/**
 * Verification test for Travis Etienne vs Trevor Etienne player mismatch bug.
 * Verifies that Travis Etienne maintains his true FantasyPros ROS rank (25 in PPR / 27 in HALF / 25 in STD)
 * and is NEVER overwritten by Trevor Etienne (rank 92 in PPR / 91 in HALF / 87 in STD).
 */

const fs = require('fs');
const assert = require('assert');

// Ensure Fuse is loaded in global scope for testing fuzzy search behavior
try {
    global.Fuse = require('./fuse.js');
} catch (e) {}

const PlayerMatcher = require('../js/playerMatcher.js');
const SleeperService = require('../js/services/sleeperService.js');

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

console.log('--- TESTING TRAVIS ETIENNE ROS RANK MATCHING ---');

async function run() {
    // 1. Unit tests on PlayerMatcher
    console.log('1. Testing PlayerMatcher mismatch prevention...');
    const roster = [
        { id: '970693f0-0af4-4627-ac0c-bf519f7433ee', name: 'Travis Etienne', position: 'RB', rank: -1 },
        { id: 'bijan-uuid', name: 'Bijan Robinson', position: 'RB', rank: -1 }
    ];
    const index = PlayerMatcher.createIndex(roster);

    // Exact matches
    assert.strictEqual(index.find('Travis Etienne Jr.', 'RB').name, 'Travis Etienne');
    assert.strictEqual(index.find('Travis Etienne', 'RB').name, 'Travis Etienne');
    assert.strictEqual(index.find('Bijan Robinson', 'RB').name, 'Bijan Robinson');

    // Mismatches that Fuse used to wrongly match
    assert.strictEqual(index.find('Trevor Etienne', 'RB'), null, 'Trevor Etienne must NOT match Travis Etienne');
    assert.strictEqual(index.find('Brian Robinson', 'RB'), null, 'Brian Robinson must NOT match Bijan Robinson');
    assert.strictEqual(index.find('Brian Robinson Jr.', 'RB'), null, 'Brian Robinson Jr. must NOT match Bijan Robinson');

    console.log('   [PASS] PlayerMatcher correctly rejected Trevor Etienne and Brian Robinson.');

    // 2. Integration test with Sleeper League 1389343427119828992 (Owner 8 owns Travis Etienne)
    console.log('2. Testing Sleeper League 1389343427119828992 with PPR, HALF, and STD ROS rankings...');
    const leagueData = await SleeperService.loadLeagueData('1389343427119828992');
    const owner8 = leagueData.rosteredPlayers.filter(p => String(p.onRoster) === '8');
    const travis = owner8.find(p => p.name.includes('Etienne'));
    assert.ok(travis, 'Owner 8 must own Travis Etienne');

    const scorings = [
        { format: 'PPR', expectedRank: 25 },
        { format: 'HALF', expectedRank: 27 },
        { format: 'STD', expectedRank: 25 }
    ];

    for (const { format, expectedRank } of scorings) {
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

        const rosRb = JSON.parse(fs.readFileSync(`data/ROS-${format}-RB.json`, 'utf8'));

        for (const fpPlayer of rosRb) {
            const matched = rosIndex.find(fpPlayer.name, 'RB', fpPlayer.id);
            if (matched) {
                matched.rank = fpPlayer.rank;
            }
        }

        const matchedEtienne = rosRoster.find(p => p.name.includes('Etienne'));
        assert.strictEqual(
            matchedEtienne.rank,
            expectedRank,
            `Travis Etienne rank in ${format} should be ${expectedRank}, got ${matchedEtienne.rank}`
        );
        console.log(`   [PASS] Travis Etienne in ${format} has rank #${matchedEtienne.rank} (NOT overwritten by Trevor Etienne).`);
    }

    console.log('\nALL TRAVIS ETIENNE TESTS PASSED! [OK]');
}

run().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
