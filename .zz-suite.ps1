$files = Get-ChildItem tests/*.test.cjs | ForEach-Object { $_.Name }
$bad = @()
foreach ($f in $files) {
    $out = & node --test "tests/$f" 2>&1 | Out-String
    if ($out -match "fail (\d+)") {
        if ([int]$Matches[1] -gt 0) { $bad += "$f : FAIL $($Matches[1])" }
    } elseif ($out -notmatch "pass \d+") {
        $bad += "$f : ERROR"
    }
}
if ($bad.Count -eq 0) {
    "ALL $($files.Count) SUITES PASS"
} else {
    $bad
}
