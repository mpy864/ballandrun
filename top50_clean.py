import os
import pandas as pd
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])

# Get latest ranking date
print("Getting latest ranking date...")
latest_res = sb.table('rankings_singles_normalized').select('ranking_date').order('ranking_date').limit(1).execute()
latest_date = latest_res.data[-1]['ranking_date'] if latest_res.data else None
print(f"Latest date: {latest_date}\n")

# Get latest singles for men (rank <= 50)
print("Fetching men...")
men_res = sb.table('rankings_singles_normalized').select('player_id,rank').eq('gender', 'M').eq('ranking_date', latest_date).lte('rank', 50).order('rank').execute()

# Get latest singles for women (rank <= 50)
print("Fetching women...")
women_res = sb.table('rankings_singles_normalized').select('player_id,rank').eq('gender', 'W').eq('ranking_date', latest_date).lte('rank', 50).order('rank').execute()

# Get all doubles
print("Fetching doubles...")
all_d = sb.table('rankings_doubles_teams').select('p1_ittf_id,p2_ittf_id,current_rank').order('id').execute()

# Build doubles map
d_map = {}
for d in all_d.data or []:
    p1, p2, rank = d.get('p1_ittf_id'), d.get('p2_ittf_id'), d.get('current_rank')
    for pid in [p1, p2]:
        if pid:
            d_map[pid] = min(d_map.get(pid, 9999), rank)

# Process MEN
print('\n' + '='*90)
print('MEN - TOP 50 SINGLES')
print('='*90)
men_data = []
for i, row in enumerate(men_res.data or []):
    pid = row['player_id']
    sr = row['rank']
    p_res = sb.table('wtt_players').select('player_name').eq('ittf_id', pid).execute()
    name = p_res.data[0]['player_name'][:40] if p_res.data else f'ID:{pid}'
    dr = d_map.get(pid, '-')
    gap = sr - dr if dr != '-' else 0
    men_data.append({'No': i+1, 'Player': name, 'Singles': sr, 'Doubles': dr, 'Gap': gap})

df_men = pd.DataFrame(men_data)
print(df_men.to_string(index=False))

# Process WOMEN
print('\n' + '='*90)
print('WOMEN - TOP 50 SINGLES')
print('='*90)
women_data = []
for i, row in enumerate(women_res.data or []):
    pid = row['player_id']
    sr = row['rank']
    p_res = sb.table('wtt_players').select('player_name').eq('ittf_id', pid).execute()
    name = p_res.data[0]['player_name'][:40] if p_res.data else f'ID:{pid}'
    dr = d_map.get(pid, '-')
    gap = sr - dr if dr != '-' else 0
    women_data.append({'No': i+1, 'Player': name, 'Singles': sr, 'Doubles': dr, 'Gap': gap})

df_women = pd.DataFrame(women_data)
print(df_women.to_string(index=False))
