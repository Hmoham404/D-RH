param(
  [string]$SourceXlsx = "Classeur1.xlsx",
  [string]$EmployeesJson = "src/employees.json",
  [string]$OutputJson = "src/data/classeur1PointageReport.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Convert-ColumnLettersToIndex {
  param([string]$Letters)

  $index = 0
  foreach ($char in $Letters.ToUpperInvariant().ToCharArray()) {
    $index = ($index * 26) + ([int][char]$char - 64)
  }

  return ($index - 1)
}

function Get-SharedStrings {
  param($ZipArchive)

  $values = @()
  $entry = $ZipArchive.Entries | Where-Object { $_.FullName -eq "xl/sharedStrings.xml" }
  if (-not $entry) {
    return $values
  }

  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    [xml]$xml = $reader.ReadToEnd()
  } finally {
    $reader.Close()
  }

  foreach ($si in $xml.sst.si) {
    if ($si.t) {
      $values += [string]$si.t
      continue
    }

    if ($si.r) {
      $parts = @()
      foreach ($run in $si.r) {
        if ($run.t) {
          $parts += [string]$run.t
        }
      }
      $values += ($parts -join "")
      continue
    }

    $values += ""
  }

  return $values
}

function Resolve-CellValue {
  param(
    $Cell,
    [string[]]$SharedStrings
  )

  if ($null -eq $Cell) {
    return ""
  }

  $cellType = if ($Cell.PSObject.Properties["t"]) { [string]$Cell.t } else { "" }
  $cellValue = if ($Cell.PSObject.Properties["v"]) { [string]$Cell.v } else { "" }

  if ($cellType -eq "s") {
    $index = [int]$Cell.v
    if ($index -ge 0 -and $index -lt $SharedStrings.Count) {
      return [string]$SharedStrings[$index]
    }
  }

  if ($Cell.PSObject.Properties["is"] -and $Cell.is -and $Cell.is.t) {
    return [string]$Cell.is.t
  }

  return $cellValue
}

function Read-WorksheetRows {
  param(
    [string]$XlsxPath,
    [int]$WorksheetNumber = 1
  )

  $zip = [System.IO.Compression.ZipFile]::OpenRead($XlsxPath)
  try {
    $sharedStrings = Get-SharedStrings -ZipArchive $zip
    $sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/worksheets/sheet$WorksheetNumber.xml" }
    if (-not $sheetEntry) {
      throw "Worksheet sheet$WorksheetNumber.xml introuvable dans $XlsxPath"
    }

    $reader = [System.IO.StreamReader]::new($sheetEntry.Open())
    try {
      [xml]$sheetXml = $reader.ReadToEnd()
    } finally {
      $reader.Close()
    }

    $rows = @()
    foreach ($row in $sheetXml.worksheet.sheetData.row) {
      $cellMap = @{}
      $maxIndex = -1

      foreach ($cell in $row.c) {
        $columnLetters = ($cell.r -replace "\d", "")
        $index = Convert-ColumnLettersToIndex -Letters $columnLetters
        $cellMap[$index] = Resolve-CellValue -Cell $cell -SharedStrings $sharedStrings
        if ($index -gt $maxIndex) {
          $maxIndex = $index
        }
      }

      $values = @()
      for ($i = 0; $i -le $maxIndex; $i++) {
        if ($cellMap.ContainsKey($i)) {
          $values += [string]$cellMap[$i]
        } else {
          $values += ""
        }
      }

      $rows += ,$values
    }

    return $rows
  } finally {
    $zip.Dispose()
  }
}

function Normalize-Code {
  param([string]$Value)

  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return ""
  }

  $trimmed = $raw.Trim()
  if ($trimmed -match "^\d+$") {
    return ([int]$trimmed).ToString()
  }

  return $trimmed.ToUpperInvariant()
}

function Normalize-NameForTokens {
  param([string]$Value)

  $clean = ([string]$Value).ToUpperInvariant()
  $clean = $clean -replace "[\.\-_\/]", " "
  $clean = $clean -replace "[^A-Z0-9 ]", " "
  $tokens = $clean.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries) | Sort-Object
  return ($tokens -join "|")
}

function Convert-ExcelPointageDate {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $number = 0.0
  if ([double]::TryParse($Value, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    return ([datetime]"1899-12-30").AddDays($number)
  }

  $formats = @(
    "MM/dd/yyyy HH:mm:ss",
    "M/d/yyyy H:mm:ss",
    "MM/dd/yyyy H:mm:ss",
    "M/d/yyyy HH:mm:ss"
  )

  foreach ($format in $formats) {
    try {
      return [datetime]::ParseExact($Value, $format, [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
    }
  }

  try {
    return [datetime]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture)
  } catch {
    return $null
  }
}

function Format-MinutesAsClock {
  param([int]$Minutes)

  if ($Minutes -lt 0) {
    return ""
  }

  $hours = [int][math]::Floor($Minutes / 60)
  $remaining = [int]($Minutes % 60)
  return ("{0:D2}:{1:D2}" -f $hours, $remaining)
}

if (-not (Test-Path -LiteralPath $SourceXlsx)) {
  throw "Fichier source introuvable: $SourceXlsx"
}

if (-not (Test-Path -LiteralPath $EmployeesJson)) {
  throw "Base employes introuvable: $EmployeesJson"
}

$worksheetRows = Read-WorksheetRows -XlsxPath $SourceXlsx -WorksheetNumber 1
if ($worksheetRows.Count -lt 2) {
  throw "Le fichier $SourceXlsx ne contient pas de donnees exploitables."
}

$employees = Get-Content -LiteralPath $EmployeesJson -Raw | ConvertFrom-Json
$employeesByCode = @{}
$employeesByName = @{}

foreach ($employee in $employees) {
  $codes = @(
    (Normalize-Code $employee.id),
    (Normalize-Code $employee.zk),
    (Normalize-Code $employee.finalCode),
    (Normalize-Code $employee.saber)
  ) | Where-Object { $_ }

  $nameToken = Normalize-NameForTokens ($employee.fullName)
  if ($nameToken) {
    $employeesByName[$nameToken] = $employee
  }

  foreach ($code in ($codes | Select-Object -Unique)) {
    if (-not $employeesByCode.ContainsKey($code)) {
      $employeesByCode[$code] = @()
    }

    $employeesByCode[$code] += $employee
  }
}

$sourceRows = @()
$groupedRows = @{}

foreach ($row in ($worksheetRows | Select-Object -Skip 1)) {
  if ($row.Count -lt 8) {
    continue
  }

  $pointageDate = Convert-ExcelPointageDate $row[3]
  if ($null -eq $pointageDate) {
    continue
  }

  $sourceId = [string]$row[1]
  $sourceName = [string]$row[2]
  $normalizedCode = Normalize-Code $sourceId
  $sourceTokens = Normalize-NameForTokens $sourceName
  $matchedEmployee = $null
  $candidateEmployees = @()

  if ($normalizedCode -and $employeesByCode.ContainsKey($normalizedCode)) {
    $candidateEmployees = $employeesByCode[$normalizedCode]
  }

  if ($candidateEmployees.Count -eq 1) {
    $matchedEmployee = $candidateEmployees[0]
  } elseif ($candidateEmployees.Count -gt 1) {
    $matchedEmployee = $candidateEmployees | Where-Object {
      (Normalize-NameForTokens $_.fullName) -eq $sourceTokens
    } | Select-Object -First 1

    if (-not $matchedEmployee) {
      $matchedEmployee = $candidateEmployees[0]
    }
  } elseif ($sourceTokens -and $employeesByName.ContainsKey($sourceTokens)) {
    $matchedEmployee = $employeesByName[$sourceTokens]
  }

  $matchedName = if ($matchedEmployee) { [string]$matchedEmployee.fullName } else { ([string]$sourceName).Replace(".", " ").ToUpperInvariant() }
  $department = if ($matchedEmployee) { [string]$matchedEmployee.department } else { "" }
  $service = if ($matchedEmployee) { [string]$matchedEmployee.service } else { "" }
  $kind = if ($matchedEmployee) { [string]$matchedEmployee.kind } else { "" }
  $status = if ($matchedEmployee) { [string]$matchedEmployee.status } else { "" }
  $employeeKey = if ($matchedEmployee) {
    if (-not [string]::IsNullOrWhiteSpace([string]$matchedEmployee.zk)) {
      [string]$matchedEmployee.zk
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$matchedEmployee.id)) {
      [string]$matchedEmployee.id
    } else {
      [string]$matchedEmployee.finalCode
    }
  } else {
    [string]$sourceId
  }
  $dayKey = $pointageDate.ToString("yyyy-MM-dd")
  $groupKey = "$employeeKey|$dayKey"

  $sourceRecord = [pscustomobject]@{
    selection = [string]$row[0]
    sourceId = $sourceId
    sourceName = $sourceName
    matchedName = $matchedName
    pointageAt = $pointageDate.ToString("yyyy-MM-ddTHH:mm:ss")
    pointageAtDisplay = $pointageDate.ToString("dd/MM/yyyy HH:mm:ss")
    workCode = [string]$row[4]
    pointageState = [string]$row[5]
    terminal = [string]$row[6]
    pointageType = [string]$row[7]
    department = $department
    service = $service
    kind = $kind
    employeeStatus = $status
  }
  $sourceRows += $sourceRecord

  if (-not $groupedRows.ContainsKey($groupKey)) {
    $groupedRows[$groupKey] = [pscustomobject]@{
      sourceId = $sourceId
      sourceName = $sourceName
      matchedName = $matchedName
      department = $department
      service = $service
      kind = $kind
      employeeStatus = $status
      isoDate = $dayKey
      punches = @()
      terminals = @()
    }
  }

  $groupedRows[$groupKey].punches += $pointageDate
  if (-not [string]::IsNullOrWhiteSpace([string]$row[6])) {
    $groupedRows[$groupKey].terminals += [string]$row[6]
  }
}

$dailyTables = @()
$allGroupRows = $groupedRows.Values | Sort-Object isoDate, matchedName, sourceId
$uniqueDays = $allGroupRows.isoDate | Sort-Object -Unique

foreach ($isoDate in $uniqueDays) {
  $rowsForDay = @()
  $dayGroups = $allGroupRows | Where-Object { $_.isoDate -eq $isoDate }

  foreach ($group in $dayGroups) {
    $sortedPunches = @($group.punches | Sort-Object)
    $punchLabels = $sortedPunches | ForEach-Object { $_.ToString("HH:mm") }
    $firstPunch = $sortedPunches[0]
    $lastPunch = $sortedPunches[-1]
    $isGuard = ([string]$group.service).ToUpperInvariant().Contains("GARDIEN")
    $rule = if ($isGuard) { "Gardien meme jour" } else { "Premiere entree / derniere sortie" }
    $state = "OK"
    $entryDisplay = $firstPunch.ToString("dd/MM/yyyy HH:mm")
    $exitDisplay = $lastPunch.ToString("dd/MM/yyyy HH:mm")
    $bruteMinutes = ""
    $afterBreakMinutes = ""
    $roundedMinutes = ""
    $roundedClock = ""

    if ((@($sortedPunches).Count % 2) -ne 0) {
      $state = "A verifier"
      $rule = "Pointage impair"
      $exitDisplay = ""
    } else {
      $duration = [int][math]::Round(($lastPunch - $firstPunch).TotalMinutes)
      $afterBreak = [math]::Max(0, $duration - 30)
      $rounded = [int]([math]::Floor($afterBreak / 30) * 30)
      $bruteMinutes = $duration
      $afterBreakMinutes = $afterBreak
      $roundedMinutes = $rounded
      $roundedClock = Format-MinutesAsClock -Minutes $rounded
    }

    $rowsForDay += [pscustomobject]@{
      sourceId = $group.sourceId
      sourceName = ([string]$group.sourceName).Replace(".", " ").ToUpperInvariant()
      matchedName = $group.matchedName
      department = $group.department
      service = $group.service
      kind = $group.kind
      employeeStatus = $group.employeeStatus
      isoDate = $group.isoDate
      dateLabel = ([datetime]::ParseExact($group.isoDate, "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)).ToString("dd/MM/yyyy")
      punches = ($punchLabels -join ", ")
      entry = $entryDisplay
      exit = $exitDisplay
      bruteMinutes = $bruteMinutes
      afterBreakMinutes = $afterBreakMinutes
      roundedMinutes = $roundedMinutes
      roundedClock = $roundedClock
      rule = $rule
      state = $state
      terminals = (($group.terminals | Sort-Object -Unique) -join ", ")
    }
  }

  $dailyTables += [pscustomobject]@{
    isoDate = $isoDate
    dateLabel = ([datetime]::ParseExact($isoDate, "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)).ToString("dd/MM/yyyy")
    rowCount = @($rowsForDay).Count
    okCount = @($rowsForDay | Where-Object { $_.state -eq "OK" }).Count
    verifyCount = @($rowsForDay | Where-Object { $_.state -eq "A verifier" }).Count
    rows = $rowsForDay
  }
}

$periodStart = ($sourceRows | Sort-Object pointageAt | Select-Object -First 1).pointageAt.Substring(0, 10)
$periodEnd = ($sourceRows | Sort-Object pointageAt | Select-Object -Last 1).pointageAt.Substring(0, 10)
$output = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
  sourceFile = $SourceXlsx
  period = [pscustomobject]@{
    start = $periodStart
    end = $periodEnd
    dayCount = @($uniqueDays).Count
    days = $uniqueDays
  }
  totals = [pscustomobject]@{
    sourceRows = @($sourceRows).Count
    uniqueEmployees = @($allGroupRows.sourceId | Sort-Object -Unique).Count
    controlRows = @($allGroupRows).Count
  }
  sourceRows = $sourceRows
  dailyControls = $dailyTables
}

$outputDirectory = Split-Path -Parent $OutputJson
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

$output | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputJson -Encoding UTF8
Write-Output "Rapport genere: $OutputJson"
