const assert = require('assert');
const FantasyProsService = require('../js/services/fantasyProsService.js');

async function test() {
    console.log('--- TESTING LIVE FANTASYPROS RANKINGS FETCHER ---');

    console.log('1. Testing getNflState()...');
    const state = await FantasyProsService.getNflState();
    console.log('   [+] NFL State:', state);
    assert.ok(state.week >= 1 && state.week <= 18, 'Valid week');
    assert.ok(state.year, 'Valid year');

    console.log('2. Testing live fetchRankings("PPR")...');
    const start = Date.now();
    const rankings = await FantasyProsService.fetchRankings('PPR');
    const elapsed = Date.now() - start;
    console.log(`   [+] Fetched 7 positions in ${elapsed}ms`);

    for (const pos of ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST']) {
        assert.ok(rankings[pos], `Rankings for ${pos} must exist`);
        assert.ok(rankings[pos].length > 0, `Rankings for ${pos} must not be empty`);
        console.log(`   - ${pos.padEnd(4)}: ${rankings[pos].length} players | #1: ${rankings[pos][0].name} (#${rankings[pos][0].rank})`);
    }

    console.log('3. Testing in-memory cache speed...');
    const startMem = Date.now();
    const memRankings = await FantasyProsService.fetchRankings('PPR');
    const memElapsed = Date.now() - startMem;
    console.log(`   [+] Memory cache took ${memElapsed}ms`);
    assert.strictEqual(rankings, memRankings, 'Should be exact same object reference');

    console.log('4. Testing live fetchRosRankings("PPR")...');
    const rosStart = Date.now();
    const rosRankings = await FantasyProsService.fetchRosRankings('PPR');
    const rosElapsed = Date.now() - rosStart;
    console.log(`   [+] Fetched 7 ROS positions in ${rosElapsed}ms`);

    for (const pos of ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST']) {
        assert.ok(rosRankings[pos], `ROS rankings for ${pos} must exist`);
        assert.ok(rosRankings[pos].length > 0, `ROS rankings for ${pos} must not be empty`);
        console.log(`   - ROS ${pos.padEnd(4)}: ${rosRankings[pos].length} players | #1: ${rosRankings[pos][0].name} (#${rosRankings[pos][0].rank})`);
    }

    console.log('\nALL LIVE FANTASYPROS FETCHER TESTS PASSED! [OK]');
}

test().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
