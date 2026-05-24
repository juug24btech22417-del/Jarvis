import sys
import time
import os
import subprocess
import pyautogui
from pathlib import Path


def open_whatsapp():
    """Open the WhatsApp desktop application on Windows.
    Tries the typical installed path first, then falls back to the URL protocol.
    """
    try:
        # Common install location for WhatsApp Desktop (Windows Store version)
        possible_paths = [
            Path(os.getenv('LOCALAPPDATA')) / 'WhatsApp' / 'WhatsApp.exe',
            Path('C:/Program Files/WhatsApp/WhatsApp.exe'),
        ]
        for exe_path in possible_paths:
            if exe_path.is_file():
                subprocess.Popen([str(exe_path)], shell=True)
                return
        # Fallback to URL protocol which usually opens the app if registered
        os.startfile('whatsapp://')
    except Exception as e:
        print(f"Failed to launch WhatsApp: {e}")
        sys.exit(1)


def focus_search_and_type(contact: str):
    """Focus the search bar, type the contact name, and press Enter."""
    # Wait for the app window to appear
    time.sleep(5)
    # Click on the search bar (top-left). Adjust coordinates if needed.
    # You can also use an image locate if you prefer.
    pyautogui.moveTo(200, 120, duration=0.5)  # Approximate position of the search field
    pyautogui.click()
    pyautogui.write(contact, interval=0.05)
    pyautogui.press('enter')
    time.sleep(2)


def send_message(message: str):
    """Type the message in the chat input and send it."""
    # Click on the message input area (bottom of the chat). Adjust if needed.
    pyautogui.moveTo(400, 720, duration=0.5)
    pyautogui.click()
    pyautogui.write(message, interval=0.04)
    pyautogui.press('enter')


def main():
    if len(sys.argv) < 3:
        print("Usage: whatsapp_desktop.py <contact> <message>")
        sys.exit(1)
    contact = sys.argv[1]
    message = sys.argv[2]
    open_whatsapp()
    focus_search_and_type(contact)
    send_message(message)
    print("Message sent to", contact)

if __name__ == "__main__":
    main()
