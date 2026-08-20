import os
import pandas as pd
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])

# Fetch latest singles rankings (paginated, all rows)
print("Fetching all singles rankings...")
all_singles = []
page = 0
while True:
    res = sb.table('rankings_singles_normalized').select('player_id,rank,gender').order('rank').range(page*1000, page*1000+999).execute()
    if not res.data:
        break
    all_singles.extend(res.data)
    page += 1

# Fetch all doubles rankings (paginated)
print("Fetching all doubles rankings...")
all_doubles = []
page = 0
while True:
    res = sb.table('rankings_doubles_teams').select('p1_ittf_id,p2_ittf_id,current_rank').order('id').range(page*5000, page*5000+4999).execute()
    if not res.data:
        break
    all_doubles.extend(res.data)
    page += 1

# Build a map of player -> best doubles rank
doubles_by_player = {}
for d in all_doubles:
    p1 = d.get('p1_ittf_id')
    p2 = d.get('p2_ittf_id')
    rank = d.get('current_rank')

    for player_id in [p1, p2]:
        if player_id:
            if player_id not in doubles_by_player:
                doubles_by_player[player_id] = rank
            else:
                doubles_by_player[player_id] = min(doubles_by_player[player_id], rank)

# MEN TOP 50
print('\n' + '='*90)
print('MEN - TOP 50 SINGLES')
print('='*90)

men = [r for r in all_singles if r['gender'] == 'M'][:50]
men_data = []
for i, row in enumerate(men):
    player_id = row['player_id']
    singles_rank = row['rank']

    # Get player name
    player_res = sb.table('wtt_players').select('player_name').eq('ittf_id', player_id).execute()
    name = player_res.data[0]['player_name'][:35] if player_res.data else f'ID:{player_id}'

    doubles_rank = doubles_by_player.get(player_id, '-')
    gap = singles_rank - doubles_rank if doubles_rank != '-' else 0

    men_data.append({
        'Rank': i+1,
        'Name': name,
        'Singles': singles_rank,
        'Doubles': doubles_rank,
        'Gap': gap
    })

df_men = pd.DataFrame(men_data)
print(df_men.to_string(index=False))
print(f"\nTotal: {len(men_data)} players\n")

# WOMEN TOP 50
print('='*90)
print('WOMEN - TOP 50 SINGLES')
print('='*90)

women = [r for r in all_singles if r['gender'] == 'W'][:50]
women_data = []
for i, row in enumerate(women):
    player_id = row['player_id']
    singles_rank = row['rank']

    # Get player name
    player_res = sb.table('wtt_players').select('player_name').eq('ittf_id', player_id).execute()
    name = player_res.data[0]['player_name'][:35] if player_res.data else f'ID:{player_id}'

    doubles_rank = doubles_by_player.get(player_id, '-')
    gap = singles_rank - doubles_rank if doubles_rank != '-' else 0

    women_data.append({
        'Rank': i+1,
        'Name': name,
        'Singles': singles_rank,
        'Doubles': doubles_rank,
        'Gap': gap
    })

df_women = pd.DataFrame(women_data)
print(df_women.to_string(index=False))
print(f"\nTotal: {len(women_data)} players")
