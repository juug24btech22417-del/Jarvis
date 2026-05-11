@echo off
echo Getting Google Calendar refresh token...
echo.

curl -X POST https://oauth2.googleapis.com/token ^
  -d "client_id=563771606829-koeq7m1s2kcov50v2jp4nsfc7tmoerch.apps.googleusercontent.com" ^
  -d "client_secret=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" ^
  -d "code=4/1Aci98E_XAM4ILQ_FRCzAkWIUEC7mp2h7jIJrp7F_Z1vn9TTGXkxT0LOAPpU" ^
  -d "grant_type=authorization_code" ^
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"

echo.
echo.
echo Look for "refresh_token" in the output above.
echo Copy the value (starts with 1//) and add it to your .env.local file
echo.
pause
