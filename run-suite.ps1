$results = @()

Get-ChildItem tests/*.test.cjs | ForEach-Object {
    $out = & node $_.FullName 2>&1 | Out-String

    $nodePass = [regex]::Match($out, "(?m)^.\s+pass (\d+)")
    $nodeFail = [regex]::Match($out, "(?m)^.\s+fail (\d+)")
    $legacy = [regex]::Match($out, "(\d+) passed, (\d+) failed")

    if ($legacy.Success) {
        $results += [pscustomobject]@{ file = $_.Name; pass = [int]$legacy.Groups[1].Value; fail = [int]$legacy.Groups[2].Value }
    } elseif ($nodePass.Success) {
        $results += [pscustomobject]@{ file = $_.Name; pass = [int]$nodePass.Groups[1].Value; fail = [int]$nodeFail.Groups[1].Value }
    } else {
        $results += [pscustomobject]@{ file = $_.Name; pass = 0; fail = 1 }
    }
}

$failed = $results | Where-Object { $_.fail -gt 0 }

foreach ($row in $failed) {
    Write-Output ("FAILED {0}: pass={1} fail={2}" -f $row.file, $row.pass, $row.fail)
}

Write-Output ("TOTAL pass=" + ($results | Measure-Object pass -Sum).Sum + " fail=" + ($results | Measure-Object fail -Sum).Sum + " files=" + $results.Count)
