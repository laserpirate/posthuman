# screen-grab.ps1: copy a rectangle of the real screen (what the monitor shows) to a PNG.
#   powershell -File tools/screen-grab.ps1 x y w h out.png
param([int]$x, [int]$y, [int]$w, [int]$h, [string]$out)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System.Runtime.InteropServices;
public class PHDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
'@
[PHDpi]::SetProcessDPIAware() | Out-Null
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
