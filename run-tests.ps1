param(
    [string]$Output = "suite-report.txt"
)

# Runs every node:test file in tests/ one at a time and writes a per-file
# summary, so a failure names the suite rather than only the assertion.
$results = @()

Get-ChildItem tests/*.test.cjs | ForEach-Object {
    $name = $_.Name
    $out = & node $_.FullName 2>&1 | Out-String

    $summary = [regex]::Match($out, "(\d+) passed, (\d+) failed")
    $nodePass = [regex]::Match($out, "(?m)^. (pass|tests) (\d+)")
    $failCount = 0
    $passCount = 0

    if ($summary.Success) {
        $passCount = [int]$summary.Groups[1].Value
        $failCount = [int]$summary.Groups[2].Value
    } else {
        $passCount = ([regex]::Matches($out, "(?m)^\s*ok ")).Count
        $failCount = ([regex]::Matches($out, "(?m)^\s*(FAIL|not ok) ")).Count

        $failMatch = [regex]::Match($out, "(?m)^.{0,3}fail (\d+)")
        if ($failMatch.Success) { $failCount = [int]$failMatch.Groups[1].Value }

        $passMatch = [regex]::Match($out, "(?m)^.{0,3}pass (\d+)")
        if ($passMatch.Success) { $passCount = [int]$passMatch.Groups[1].Value }
    }

    $results += [pscustomobject]@{ file = $name; pass = $passCount; fail = $failCount }
}

$lines = @()

$results | Where-Object { $_.fail -gt 0 } | ForEach-Object {
    $lines += ("FAILED {0}  ({1} passed, {2} failed)" -f $_.file, $_.pass, $_.fail)
}

$lines += ("TOTAL pass=" + ($results | Measure-Object pass -Sum).Sum + " fail=" + ($results | Measure-Object fail -Sum).Sum)

$lines | Set-Content -Encoding utf8 $Output
$lines | Write-Output
