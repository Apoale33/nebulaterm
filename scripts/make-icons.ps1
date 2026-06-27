# Generates NebulaTerm PNG icons at several sizes using System.Drawing.
# Output: build/icons/icon_<size>.png  (packed into build/icon.ico by make-ico.js)
Add-Type -AssemblyName System.Drawing

$sizes = 16, 24, 32, 48, 64, 128, 256
$outDir = Join-Path $PSScriptRoot '..\build\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [int]([Math]::Max(1, $s * 0.06))
    $rx = $pad; $ry = $pad; $rw = $s - 2 * $pad; $rh = $s - 2 * $pad
    $rect = New-Object System.Drawing.Rectangle($rx, $ry, $rw, $rh)
    $d = [int]($s * 0.30); if ($d -lt 2) { $d = 2 }

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($rx, $ry, $d, $d, 180, 90)
    $path.AddArc($rx + $rw - $d, $ry, $d, $d, 270, 90)
    $path.AddArc($rx + $rw - $d, $ry + $rh - $d, $d, $d, 0, 90)
    $path.AddArc($rx, $ry + $rh - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $c1 = [System.Drawing.Color]::FromArgb(255, 41, 121, 245)
    $c2 = [System.Drawing.Color]::FromArgb(255, 19, 78, 180)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 55.0)
    $g.FillPath($brush, $path)

    $fontSize = [single]($s * 0.42)
    $font = New-Object System.Drawing.Font('Consolas', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $textRect = New-Object System.Drawing.RectangleF(0, [single](-$s * 0.03), [single]$s, [single]$s)
    $g.DrawString('>_', $font, $white, $textRect, $sf)

    $g.Dispose()
    $bmp.Save((Join-Path $outDir ("icon_{0}.png" -f $s)), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("icon_{0}.png" -f $s)
}
