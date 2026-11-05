// Checks the live dependencies of FF Optimizer: Sleeper's NFL state, FantasyPros weekly + ROS rankings
// (fields the app reads), and the deployed site itself. Exits non-zero on any problem.
const SITE = 'https://reidlindsey.com/FFOptimizer/'
const FP = 'https://partners.fantasypros.com/api/v1/consensus-rankings.php?sport=NFL&export=json&scoring=PPR'
const NEED = ['player_id', 'player_name', 'player_position_id', 'player_team_id', 'rank_ecr', 'r2p_pts', 'player_opponent', 'player_game_kickoff_ts', 'player_bye_week', 'player_yahoo_id']
const problems = []
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r }

try {
  const state = await (await get('https://api.sleeper.app/v1/state/nfl')).json()
  if (!state.season || state.display_week == null) problems.push('Sleeper state is missing season/display_week')
  const offseason = state.season_type !== 'regular'
  const week = Math.max(1, Math.min(18, Number(state.display_week) || 1))
  for (const [label, url] of [['weekly RB', `${FP}&year=${state.season}&week=${week}&position=RB`], ['ROS WR', `${FP}&year=${state.season}&type=ROS&position=WR`]]) {
    const data = await (await get(url)).json()
    const players = data.players || []
    if (!players.length) { if (!offseason) problems.push(`FantasyPros ${label}: no players`); continue }
    const missing = NEED.filter(k => !(k in players[0]) && !(label.startsWith('ROS') && ['player_opponent', 'player_game_kickoff_ts'].includes(k)))
    if (missing.length) problems.push(`FantasyPros ${label}: missing ${missing.join(', ')}`)
  }
  const page = await (await get(SITE)).text()
  if (!page.includes('id="app"')) problems.push('Site does not contain the app root')
} catch (e) {
  problems.push(e.message)
}
if (problems.length) { console.error('Live check failed:\n- ' + problems.join('\n- ')); process.exit(1) }
console.log('Live check passed')
