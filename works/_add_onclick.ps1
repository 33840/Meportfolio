$workDir = "d:\wyt\test-master\works"
$files = @("work3.html","work4.html","work5.html","work6.html","work7.html","work8.html","work9.html")

foreach ($f in $files) {
    $path = Join-Path $workDir $f
    $content = [System.IO.File]::ReadAllText($path)
    $modified = $false
    $count = 0
    
    # Find all img tags that have the specific class pattern but no onclick
    # Pattern: class="flex-shrink-0 h-[70vh] w-auto rounded-lg shadow-md hover:opacity-90 transition"
    # Add cursor-pointer to class and onclick="openImageViewer(event)"
    $pattern = '<img\s([^>]*?)class="([^"]*?)"([^>]*?)>'
    
    $result = [regex]::Matches($content, $pattern)
    foreach ($m in $result) {
        $fullMatch = $m.Value
        $beforeClass = $m.Groups[1].Value
        $classValue = $m.Groups[2].Value
        $afterClass = $m.Groups[3].Value
        
        # Check if this img has the target class pattern and no onclick
        if ($classValue -match 'flex-shrink-0 h-\[70vh\]' -and $classValue -match 'hover:opacity-90 transition') {
            # Skip if already has onclick
            if ($fullMatch -match 'onclick=') { continue }
            
            # Add cursor-pointer to class if not already there
            $newClass = $classValue
            if ($newClass -notmatch 'cursor-pointer') {
                $newClass = $newClass -replace 'hover:opacity-90 transition', 'cursor-pointer hover:opacity-90 transition'
            }
            
            # Add onclick attribute
            $newImg = "<img$beforeClassclass=`"$newClass`"$afterClass onclick=`"openImageViewer(event)`">"
            
            # Replace in content
            $content = $content.Replace($fullMatch, $newImg)
            $count++
            $modified = $true
        }
    }
    
    if ($modified) {
        [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
        Write-Output "$f : added onclick to $count images"
    } else {
        Write-Output "$f : no changes needed"
    }
}

Write-Output "`n=== Done ==="