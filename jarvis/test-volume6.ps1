# Master volume set via Core Audio API. Working approach.
# Reference: https://www.reddit.com/r/PowerShell/comments/volume_coreaudio
# Key insight: use [Activator]::CreateInstance on the CLSID type to
# get the COM enumerator, then use reflection.InvokeMember on the
# resulting __ComObject to call methods without needing a managed
# interface definition.
param([int]$Target = 50)

# Create the device enumerator via CLSID.
$enType = [Type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E")
$en = [Activator]::CreateInstance($enType)

# GetDefaultAudioEndpoint via late binding.
# PowerShell's COM RCW supports InvokeMember for methods on COM
# objects whose interface isn't declared in managed code.
$dev = $en.GetType().InvokeMember(
    "GetDefaultAudioEndpoint",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $en, @(0, 1, $null))

# dev should now be the default IMMDevice. Activate it to get
# IAudioEndpointVolume by IID.
$epObj = $dev.GetType().InvokeMember(
    "Activate",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $dev,
    @([ref]([Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"), 0, [IntPtr]::Zero, [ref]$null))

# Read current volume (out float parameter).
$args = @([uint32]0, [ref]0.0)
$null = $epObj.GetType().InvokeMember(
    "GetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, $args)
$before = [float]$args[1]

# Set new volume.
$scalar = [float]($Target / 100.0)
$null = $epObj.GetType().InvokeMember(
    "SetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, @([uint32]0, $scalar, [Guid]::Empty))

Start-Sleep -Milliseconds 200

# Read back.
$args = @([uint32]0, [ref]0.0)
$null = $epObj.GetType().InvokeMember(
    "GetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, $args)
$after = [float]$args[1]

Write-Output ("target:$Target before:$before set:$scalar after:$after")
