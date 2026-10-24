# front.ps1: put the window whose title contains the given text on top (topmost), for the on-screen
# palette test, so the screen copy sees the test browser and not whatever else is in front.
#   powershell -File tools/front.ps1 <title text> [off]
param([string]$title, [string]$mode = 'on')
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class PHWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
'@
$found = $null
$cb = [PHWin+EnumProc]{ param($h, $l)
  if ([PHWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][PHWin]::GetWindowText($h, $sb, 512)
    if ($sb.ToString().Contains($title)) { $script:found = $h; return $false }
  }
  return $true }
[void][PHWin]::EnumWindows($cb, [IntPtr]::Zero)
if (-not $found) { Write-Output 'not found'; exit 1 }
$after = if ($mode -eq 'off') { [IntPtr](-2) } else { [IntPtr](-1) } # HWND_NOTOPMOST / HWND_TOPMOST
[void][PHWin]::SetWindowPos($found, $after, 0, 0, 0, 0, 0x0003) # SWP_NOSIZE | SWP_NOMOVE
if ($mode -ne 'off') { [PHWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [PHWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); [void][PHWin]::SetForegroundWindow($found) }
Write-Output 'ok'
