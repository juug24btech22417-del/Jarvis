import urllib.request
import re
import sys
import urllib.parse

query = "MKBHD"
url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    video_ids = re.findall(r"watch\?v=(\S{11})", html)
    if video_ids:
        print(f"FOUND: {video_ids[0]}")
    else:
        print("Not found")
except Exception as e:
    print(f"Error: {e}")
