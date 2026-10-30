/**
 * Regression tests for league slot parsing, free agent handling, drop pairing, and rankings caching.
 * Runs fully offline (network calls are mocked).
 */

const assert = require('assert');

global.CONFIG = require('../js/config.js');
const OptimizerService = require('../js/services/optimizerService.js');
const YahooService = require('../js/services/yahooService.js');

let mockGet = null;
global.axios = { get: async (url, opts) => mockGet(url, opts) };

const EspnService = require('../js/services/espnService.js');
const SleeperService = require('../js/services/sleeperService.js');
const FantasyProsService = require('../js/services/fantasyProsService.js');

const P = (name, position, extra = {}) => ({
    name, position, onRoster: 1, starter: false, rank: -1, flxRank: -1, ...extra
});
const FA = (name, position, extra = {}) => P(name, position, { onRoster: 0, ...extra });

async function run() {
    // ---------------------------------------------------------------
    // 1. ESPN: FLEX is slot 23, RB/WR is 3, WR/TE is 5, OP is 7
    // ---------------------------------------------------------------
    mockGet = async (url) => {
        assert.ok(url.includes('/seasons/2026/'), 'ESPN season should come from the caller');
        return {
            data: {
                settings: {
                    name: 'ESPN Test',
                    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 7: 1, 16: 1, 17: 1, 20: 6, 21: 1 } },
                    scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] }
                },
                teams: [{
                    id: 3, name: 'Team Three',
                    roster: { entries: [
                        { lineupSlotId: 23, playerPoolEntry: { player: { id: 1, fullName: 'Flex Guy', defaultPositionId: 3 } } },
                        { lineupSlotId: 20, playerPoolEntry: { player: { id: 2, fullName: 'Bench Guy', defaultPositionId: 2 } } },
                        { lineupSlotId: 21, playerPoolEntry: { player: { id: 3, fullName: 'Hurt Guy', defaultPositionId: 2 } } }
                    ] }
                }]
            }
        };
    };
    const espn = await EspnService.loadLeagueData('123', 2026);
    assert.strictEqual(espn.startingSlots.filter(s => s === 'FLX').length, 1, 'ESPN slot 23 must become a FLX slot');
    assert.strictEqual(espn.startingSlots.filter(s => s === 'SFLX').length, 1, 'ESPN slot 7 must become a superflex slot');
    assert.strictEqual(espn.flex, 'WRT');
    const espnPlayer = n => espn.rosteredPlayers.find(p => p.name === n);
    assert.strictEqual(espnPlayer('Flex Guy').starter, true, 'Player in FLEX (slot 23) is a starter');
    assert.strictEqual(espnPlayer('Bench Guy').starter, false);
    assert.strictEqual(espnPlayer('Hurt Guy').starter, false);
    console.log('[PASS] ESPN FLEX/OP slots parsed and FLEX starters recognized');

    // ---------------------------------------------------------------
    // 2. Sleeper: extra flex slot types + players missing from the bundled file
    // ---------------------------------------------------------------
    SleeperService._playersDb = { '100': { position: 'RB', name: 'Known Back', id: 'sr-100' } };
    SleeperService._livePlayersDb = null;
    let liveFetches = 0;
    mockGet = async (url) => {
        if (url.endsWith('/players/nfl')) {
            liveFetches++;
            return { data: { '200': { position: 'WR', full_name: 'New Signing', sportradar_id: 'sr-200' } } };
        }
        if (url.endsWith('/rosters')) {
            return { data: [{ roster_id: 1, owner_id: 'u1', players: ['100', '200', 'KC', '999'], starters: ['100', '200'] }] };
        }
        if (url.endsWith('/users')) return { data: [{ user_id: 'u1', display_name: 'Me' }] };
        return { data: {
            name: 'Sleeper Test',
            roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'WRRB_FLEX', 'REC_FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN'],
            scoring_settings: { rec: 0.5 }
        } };
    };
    const sleeper = await SleeperService.loadLeagueData('abc');
    assert.deepStrictEqual(sleeper.startingSlots, ['QB', 'RB', 'WR', 'TE', 'FLX', 'WRRB', 'REC', 'SFLX', 'K', 'DST']);
    const names = sleeper.rosteredPlayers.map(p => p.name);
    assert.ok(names.includes('New Signing'), 'Player missing from bundled file is loaded from live Sleeper DB');
    assert.ok(names.includes('Kansas City Chiefs'), 'Unknown team defense id is reconstructed');
    assert.strictEqual(sleeper.rosteredPlayers.find(p => p.name === 'Kansas City Chiefs').position, 'DST');
    assert.strictEqual(sleeper.unresolvedPlayers, 1, 'Unidentifiable players are counted');
    assert.strictEqual(liveFetches, 1);
    console.log('[PASS] Sleeper flex slot types and missing-player lookup');

    // ---------------------------------------------------------------
    // 3. Optimizer: flex slot eligibility
    // ---------------------------------------------------------------
    const flexRoster = [
        P('QB One', 'QB', { rank: 1, pts: 24, starter: true }),
        P('QB Two', 'QB', { rank: 5, pts: 20 }),
        P('RB One', 'RB', { rank: 1, flxRank: 1, pts: 18, starter: true }),
        P('RB Two', 'RB', { rank: 20, flxRank: 40, pts: 9 }),
        P('WR One', 'WR', { rank: 1, flxRank: 2, pts: 17, starter: true }),
        P('TE One', 'TE', { rank: 1, flxRank: 5, pts: 14, starter: true }),
        P('TE Two', 'TE', { rank: 3, flxRank: 10, pts: 12 })
    ];
    const flexResult = OptimizerService.solveLineup(flexRoster, ['QB', 'RB', 'WR', 'TE', 'WRRB', 'SFLX'], 1, 'WRT');
    const slotOf = (res, n) => (res.optimalLineup.find(o => o.name === n) || {}).slot;
    assert.strictEqual(slotOf(flexResult, 'RB Two'), 'WRRB', 'TE is not eligible for an RB/WR flex');
    assert.strictEqual(slotOf(flexResult, 'QB Two'), 'SFLX', 'Superflex takes the QB with more projected points');
    assert.strictEqual(flexResult.optimalLineup.find(o => o.slot === 'WRRB').slotLabel, 'W/R');
    console.log('[PASS] W/R and superflex slots honor position eligibility');

    // ---------------------------------------------------------------
    // 4. Optimizer: pickup margin avoids churn
    // ---------------------------------------------------------------
    const marginRoster = [P('My Kicker', 'K', { rank: 6, starter: true }), FA('Slightly Better K', 'K', { rank: 5 })];
    let res = OptimizerService.solveLineup(marginRoster, ['K'], 1, 'WRT');
    assert.strictEqual(res.optimalLineup[0].name, 'My Kicker', 'A 1-spot better kicker is not worth a waiver move');
    marginRoster[1].rank = 2;
    res = OptimizerService.solveLineup(marginRoster, ['K'], 1, 'WRT');
    assert.strictEqual(res.optimalLineup[0].highlight, 'pickup', 'A clearly better kicker is suggested');
    console.log('[PASS] Pickup margin');

    // ---------------------------------------------------------------
    // 5. Optimizer: drop pairing
    // ---------------------------------------------------------------
    const dropRoster = [
        P('Starting DST', 'DST', { rank: 20, starter: true }),
        P('Bench DST', 'DST', { rank: 25 }),
        P('Rookie Stash', 'RB', {}), // unranked weekly and ROS
        FA('Waiver DST', 'DST', { rank: 1 })
    ];
    res = OptimizerService.solveLineup(dropRoster, ['DST'], 1, 'WRT');
    const dstPickup = res.optimalLineup.find(o => o.name === 'Waiver DST');
    assert.strictEqual(dstPickup.highlight, 'pickup');
    assert.strictEqual(OptimizerService.normalizeSlot('W/R'), 'WRRB');
    assert.ok(['Starting DST', 'Bench DST'].includes(dstPickup.targetDrop), 'DST pickup drops a DST, not the RB stash');
    assert.strictEqual(res.fullBench.find(b => b.name === 'Rookie Stash').highlight, 'none');

    const valueRoster = [
        P('Starter WR', 'WR', { rank: 30, flxRank: 60, rosRank: 8, starter: true }),  // bad week, great ROS
        P('Deep Bench WR', 'WR', { rank: 80, flxRank: 150, rosRank: 90 }),
        FA('Hot Waiver WR', 'WR', { rank: 10, flxRank: 20 })
    ];
    res = OptimizerService.solveLineup(valueRoster, ['WR'], 1, 'WRT');
    const wrPickup = res.optimalLineup.find(o => o.name === 'Hot Waiver WR');
    assert.strictEqual(wrPickup.targetDrop, 'Deep Bench WR', 'Drop the least valuable player, not the benched starter');
    assert.strictEqual(res.fullBench.find(b => b.name === 'Starter WR').highlight, 'bench');
    console.log('[PASS] Drop pairing prefers same-position K/DST and lowest ROS value');

    // ---------------------------------------------------------------
    // 6. Optimizer + Yahoo paste: free agents unknown
    // ---------------------------------------------------------------
    res = OptimizerService.solveLineup(valueRoster, ['WR'], 1, 'WRT', { includeFreeAgents: false });
    assert.ok(!res.optimalLineup.some(o => o.highlight === 'pickup'), 'No pickups when free agents are unknown');
    assert.ok(!res.fullBench.some(b => b.highlight === 'drop'));

    const pasted = YahooService.parseRosterText('QB\tJosh Allen Buf - QB\nW/R\tPuka Nacua LAR - WR\nW/T\tTrey McBride Ari - TE\nBN\tBench Guy Buf - RB');
    assert.strictEqual(pasted.freeAgentsKnown, false, 'Paste mode marks free agents as unknown');
    assert.deepStrictEqual(pasted.startingSlots, ['QB', 'WRRB', 'REC']);
    assert.strictEqual(pasted.rosteredPlayers.find(p => p.name === 'Puka Nacua').position, 'WR');
    console.log('[PASS] Yahoo paste mode disables free agent suggestions and parses W/R, W/T slots');

    // ---------------------------------------------------------------
    // 7. FantasyPros cache: partial/fallback results are not persisted
    // ---------------------------------------------------------------
    const store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    FantasyProsService.clearCache();
    FantasyProsService._nflState = { week: 8, year: '2026' };
    let failPos = 'K';
    FantasyProsService.jsonp = async (url) => {
        if (url.includes(`position=${failPos}`)) throw new Error('boom');
        return { players: [{ player_name: 'X', rank_ecr: 1, player_position_id: 'QB' }] };
    };
    mockGet = async (url) => {
        if (url === 'data/lastUpdatedAt.json') return { data: { week: '7', date: '10/20/2026 10:00' } };
        return { data: [] };
    };
    await FantasyProsService.fetchRankings('PPR');
    assert.strictEqual(store['ff_rankings_PPR'], undefined, 'Partial results must not be written to localStorage');

    // Partial memory entry expires quickly
    FantasyProsService._cacheTimes['PPR'] = Date.now() - FantasyProsService.PARTIAL_TTL - 1000;
    failPos = 'NONE';
    FantasyProsService._nflState = { week: 8, year: '2026' };
    await FantasyProsService.fetchRankings('PPR');
    assert.ok(store['ff_rankings_PPR'], 'Complete live results are persisted after a retry');

    // Full memory entry expires after the regular TTL
    FantasyProsService._cacheTimes['PPR'] = Date.now() - FantasyProsService.CACHE_TTL - 1000;
    delete store['ff_rankings_PPR'];
    let calls = 0;
    const origJsonp = FantasyProsService.jsonp;
    FantasyProsService.jsonp = async (url) => { calls++; return origJsonp(url); };
    await FantasyProsService.fetchRankings('PPR');
    assert.ok(calls > 0, 'Stale in-memory rankings are re-fetched');

    // Total failure falls back to bundled files and reports their week
    FantasyProsService.clearCache();
    FantasyProsService._nflState = { week: 8, year: '2026' };
    FantasyProsService.jsonp = async () => { throw new Error('offline'); };
    mockGet = async (url) => {
        if (url === 'data/lastUpdatedAt.json') return { data: { week: '7', date: '10/20/2026 10:00' } };
        return { data: [{ name: 'Saved Player', position: 'QB', rank: 1 }] };
    };
    await FantasyProsService.fetchRankings('HALF');
    const meta = await FantasyProsService.fetchMetadata('HALF');
    assert.strictEqual(meta.isFallback, true);
    assert.strictEqual(meta.week, '7');
    assert.strictEqual(store['ff_rankings_HALF'], undefined);

    // No live data and no bundled data is an error, not an empty lineup
    FantasyProsService.clearCache();
    FantasyProsService._nflState = { week: 8, year: '2026' };
    mockGet = async () => { throw new Error('404'); };
    await assert.rejects(() => FantasyProsService.fetchRankings('STD'), /no offline rankings/);
    console.log('[PASS] Rankings cache TTLs and fallback handling');

    console.log('\nALL REGRESSION TESTS PASSED');
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
