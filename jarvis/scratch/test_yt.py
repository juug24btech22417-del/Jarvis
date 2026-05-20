import pyautogui
import time
import subprocess
import urllib.parse
import os

try:
    query = "MKBHD"
    encoded_query = urllib.parse.quote(query)
    url = f'https://www.youtube.com/results?search_query={encoded_query}'
    
    print(f'Launching YouTube search for: {query}')
    subprocess.Popen(f'start "" "{url}"', shell=True)
    
    print('Waiting 6.0 seconds for page load...')
    time.sleep(6.0)
    
    # Take screenshot before click
    img1 = pyautogui.screenshot()
    img1.save(os.path.join(os.path.dirname(__file__), "yt_before_click.png"))
    
    # In a typical maximized browser on 1080p, the first video in search results 
    # might actually require scrolling, or maybe it's not at 700x350. 
    # Let's use Tab navigation which is safer!
    
    # Wait, let's just take the screenshot first so we can SEE what the screen looks like.
    
    print('SUCCESS')
except Exception as e:
    print(f'Error: {e}')
