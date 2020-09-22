import requests
import json
import datetime

with open('data/lastUpdatedAt.json', 'w') as f:
    f.write(json.dumps(
        {"date": datetime.datetime.now().strftime("%m/%d/%Y %H:%M"), "week": str(
            (datetime.date.today() - datetime.timedelta(days=1)).isocalendar()[
                1] - 36)}))


getPos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
url = 'https://api.sleeper.app/v1/players/nfl'
r = requests.get(url)
players = r.json()
outPlayers = {}
for player in players:
#    if 'status' in players[player]:
#        if players[player]['status'] == 'Inactive':
#            continue
    if 'team' in players[player]:
        if players[player]['team'] is None:
            continue
    if players[player]['position'] not in getPos:
        continue
    outPlayers[player] = {}
    if 'position' in players[player]:
        outPlayers[player]['position'] = players[player]['position']
        if players[player]['position'] == "DEF":
            outPlayers[player]['name'] = players[player]['first_name'] +\
                " " + players[player]['last_name']
            outPlayers[player]['id'] = players[player]['player_id']
        else:
            outPlayers[player]['name'] = players[player]['full_name']
            outPlayers[player]['id'] = players[player]['yahoo_id']

with open('data/sleeperPlayers.json', 'w') as f:
    f.write(json.dumps(outPlayers))

getPos = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST']
scoring = ['STD', 'HALF', 'PPR']

for pos in getPos:
    for scoringType in scoring:
        outPlayers = []
        url = 'https://partners.fantasypros.com/api/v1/consensus-rankings.php?sport=NFL&year=2020&week=' + str(
            (datetime.date.today() - datetime.timedelta(days=1)).isocalendar()[
                1] - 36)+'&scoring='+scoringType+'&export=json&position=' + pos.upper()
        r = requests.get(url)
        for player in r.json()['players']:
            if pos == 'DST':
                outPlayers.append({
                    'name': player['player_name'],
                    'position': player['player_position_id'],
                    'id': player['player_team_id'],
                    'rank': player['rank_ecr']
                })
            else:
                outPlayers.append({
                    'name': player['player_name'],
                    'position': player['player_position_id'],
                    'id': player['player_yahoo_id'],
                    'rank': player['rank_ecr']
                })

        with open('data/' + scoringType+'-'+pos+'.json', 'w') as f:
            f.write(json.dumps(outPlayers))
