$workDir = "d:\wyt\test-master\works"
$files = @("work1.html","work3.html","work4.html","work5.html","work6.html","work7.html","work8.html","work9.html")

foreach ($f in $files) {
    $path = Join-Path $workDir $f
    $content = [System.IO.File]::ReadAllText($path)
    $modified = $false
    
    # 1. Update .viewer-nav background (white -> black)
    # Match: background: rgba(255,255,255,0.2); inside .viewer-nav { block
    $content = [regex]::Replace($content, '(?<=\.viewer-nav\s*\{(?:[^}]*?))background:\s*rgba\(255,\s*255,\s*255,\s*0\.2\);', 'background: rgba(0,0,0,0.7);')
    
    # 2. Update .viewer-nav:hover background
    $content = [regex]::Replace($content, '(?<=\.viewer-nav:hover\s*\{(?:[^}]*?))background:\s*rgba\(255,\s*255,\s*255,\s*0\.4\);', 'background: rgba(0,0,0,0.9);')
    
    # 3. Update .image-viewer-close right: 130px -> 200px
    $content = [regex]::Replace($content, '(?<=\.image-viewer-close\s*\{(?:[^}]*?))right:\s*130px;', 'right: 200px;')
    
    # 4. Update .viewer-sidebar block
    $oldSidebar = ".viewer-sidebar {`n            width: 100px;`n            background: rgba(0,0,0,0.4);`n            padding: 50px 6px 6px 6px;`n            overflow: hidden;`n            display: flex;`n            flex-direction: column;`n            gap: 4px;`n        }"
    $newSidebar = ".viewer-sidebar {`n            width: 140px;`n            background: rgba(0,0,0,0.4);`n            padding: 50px 8px 8px 8px;`n            overflow-y: auto;`n            display: flex;`n            flex-direction: column;`n            gap: 4px;`n            direction: rtl;`n            scrollbar-width: auto;`n            scrollbar-color: rgba(255,255,255,0.5) rgba(0,0,0,0.2);`n        }`n`n        /* 侧边栏滚动条样式 */`n        .viewer-sidebar::-webkit-scrollbar {`n            width: 10px;`n        }`n        .viewer-sidebar::-webkit-scrollbar-track {`n            background: rgba(0,0,0,0.2);`n            border-radius: 5px;`n            margin: 20px 0;`n        }`n        .viewer-sidebar::-webkit-scrollbar-thumb {`n            background: rgba(255,255,255,0.5);`n            border-radius: 5px;`n            min-height: 30px;`n            border: 2px solid rgba(0,0,0,0.2);`n            background-clip: padding-box;`n        }`n        .viewer-sidebar::-webkit-scrollbar-thumb:hover {`n            background: rgba(255,255,255,0.75);`n            background-clip: padding-box;`n        }"
    
    if ($content.Contains($oldSidebar)) {
        $content = $content.Replace($oldSidebar, $newSidebar)
        $modified = $true
    }
    
    # 5. Add auto-scroll in openImageViewer (after document.body.style.overflow = 'hidden';)
    $oldOpenEnd = "viewer.classList.add('active');`n            document.body.style.overflow = 'hidden';`n        }`n        `n        function showViewerItem"
    $newOpenEnd = "viewer.classList.add('active');`n            document.body.style.overflow = 'hidden';`n            // 滚动到当前缩略图`n            requestAnimationFrame(function() {`n                const activeWrap = sidebar.children[viewerIndex];`n                if (activeWrap) {`n                    activeWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });`n                }`n            });`n        }`n        `n        function showViewerItem"
    
    if ($content.Contains($oldOpenEnd)) {
        $content = $content.Replace($oldOpenEnd, $newOpenEnd)
        $modified = $true
    }
    
    # 6. Add auto-scroll in showViewerItem (after thumbs.forEach block)
    $oldShowEnd = "            // 更新缩略图高亮`n            const thumbs = sidebar.querySelectorAll('.viewer-thumb');`n            thumbs.forEach(function(thumb, i) {`n                thumb.classList.toggle('active', i === viewerIndex);`n            });`n        }`n        `n        function prevImage"
    $newShowEnd = "            // 更新缩略图高亮`n            const thumbs = sidebar.querySelectorAll('.viewer-thumb');`n            thumbs.forEach(function(thumb, i) {`n                thumb.classList.toggle('active', i === viewerIndex);`n            });`n            // 滚动到当前缩略图`n            const activeWrap = thumbs[viewerIndex] ? thumbs[viewerIndex].parentElement : null;`n            if (activeWrap) {`n                activeWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });`n            }`n        }`n        `n        function prevImage"
    
    if ($content.Contains($oldShowEnd)) {
        $content = $content.Replace($oldShowEnd, $newShowEnd)
        $modified = $true
    }
    
    # Write back
    [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Output "$f : processed (scroll logic added: $modified)"
}

Write-Output "`n=== Done ==="