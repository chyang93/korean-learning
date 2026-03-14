param(
  [string]$WorkspaceRoot = (Get-Location).Path,
  [string]$ManifestPath = 'data/grammar-manifest.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Add-Err {
  param([string]$Message)
  $errors.Add($Message)
}

function Add-Warn {
  param([string]$Message)
  $warnings.Add($Message)
}

function Has-Prop {
  param(
    [object]$Obj,
    [string]$Name
  )
  return $null -ne $Obj -and ($Obj.PSObject.Properties.Name -contains $Name)
}

$manifestFullPath = Join-Path $WorkspaceRoot $ManifestPath
if (-not (Test-Path -Path $manifestFullPath -PathType Leaf)) {
  Add-Err "ERROR_MANIFEST_LOAD: manifest file not found: $ManifestPath"
} else {
  $rawManifest = Get-Content -Path $manifestFullPath -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($rawManifest)) {
    Add-Err "ERROR_MANIFEST_LOAD: manifest file is empty: $ManifestPath"
  } else {
    try {
      $manifest = $rawManifest | ConvertFrom-Json
    } catch {
      Add-Err "ERROR_MANIFEST_LOAD: manifest JSON parse failed: $($_.Exception.Message)"
    }
  }
}

if ($errors.Count -eq 0) {
  if (-not (Has-Prop -Obj $manifest -Name 'chapters')) {
    Add-Err 'ERROR_MANIFEST_LOAD: chapters missing in manifest'
  } else {
    $chapters = @($manifest.chapters)
    if ($chapters.Count -eq 0) {
      Add-Err 'ERROR_MANIFEST_LOAD: chapters is empty'
    }

    ($chapters | Where-Object { Has-Prop -Obj $_ -Name 'id' } | Group-Object -Property id) | ForEach-Object {
      if ($_.Count -gt 1) { Add-Err "ERROR_MANIFEST_SCHEMA: duplicate chapter.id = $($_.Name)" }
    }

    ($chapters | Where-Object { Has-Prop -Obj $_ -Name 'path' } | Group-Object -Property path) | ForEach-Object {
      if ($_.Count -gt 1) { Add-Err "ERROR_MANIFEST_SCHEMA: duplicate chapter.path = $($_.Name)" }
    }

    ($chapters | Where-Object { Has-Prop -Obj $_ -Name 'part' } | Group-Object -Property part) | ForEach-Object {
      if ($_.Count -gt 1) { Add-Warn "WARN_DUPLICATE_PART: duplicate chapter.part = $($_.Name)" }
    }

    foreach ($chapter in $chapters) {
      foreach ($field in @('id','part','title','path','enabled')) {
        if (-not (Has-Prop -Obj $chapter -Name $field)) {
          Add-Err "ERROR_MANIFEST_SCHEMA: chapter missing field '$field'"
        }
      }

      if (-not (Has-Prop -Obj $chapter -Name 'enabled') -or -not [bool]$chapter.enabled) {
        continue
      }

      $chapterPath = [string]$chapter.path
      $chapterFullPath = Join-Path $WorkspaceRoot $chapterPath
      if (-not (Test-Path -Path $chapterFullPath -PathType Leaf)) {
        Add-Err "ERROR_CHAPTER_LOAD: [$($chapter.id)] chapter file not found: $chapterPath"
        continue
      }

      $rawChapter = Get-Content -Path $chapterFullPath -Raw -Encoding UTF8
      if ([string]::IsNullOrWhiteSpace($rawChapter)) {
        Add-Err "ERROR_CHAPTER_LOAD: [$($chapter.id)] chapter file is empty: $chapterPath"
        continue
      }

      try {
        $chapterData = $rawChapter | ConvertFrom-Json
      } catch {
        Add-Err "ERROR_CHAPTER_LOAD: [$($chapter.id)] chapter JSON parse failed: $chapterPath ; $($_.Exception.Message)"
        continue
      }

      if ($chapterData -is [System.Array]) {
        Add-Err "ERROR_CHAPTER_SCHEMA: [$($chapter.id)] chapter must be an object, not array: $chapterPath"
        continue
      }

      foreach ($field in @('id','title','part','introDialogue','grammarRule','examples')) {
        if (-not (Has-Prop -Obj $chapterData -Name $field)) {
          Add-Err "ERROR_CHAPTER_SCHEMA: [$($chapter.id)] missing field '$field'"
        }
      }

      if ((Has-Prop -Obj $chapterData -Name 'part') -and ([int]$chapterData.part -ne [int]$chapter.part)) {
        Add-Err "ERROR_CHAPTER_SCHEMA: [$($chapter.id)] part mismatch (manifest=$($chapter.part), chapter=$($chapterData.part))"
      }

      if ((Has-Prop -Obj $chapterData -Name 'examples') -and (@($chapterData.examples).Count -eq 0)) {
        Add-Warn "WARN_MISSING_FIELD: [$($chapter.id)] examples is empty"
      }

      if (Has-Prop -Obj $chapterData -Name 'grammarRule') {
        $gr = $chapterData.grammarRule
        foreach ($recommended in @('pattern','meaning','rule')) {
          if (-not (Has-Prop -Obj $gr -Name $recommended)) {
            Add-Warn "WARN_MISSING_FIELD: [$($chapter.id)] grammarRule.$recommended missing (normalizer can fill defaults)"
          }
        }
      }

      if (Has-Prop -Obj $chapterData -Name 'introDialogue') {
        $intro = $chapterData.introDialogue
        foreach ($f in @('A','A_zh','B','B_zh')) {
          if (-not (Has-Prop -Obj $intro -Name $f)) {
            Add-Warn "WARN_MISSING_FIELD: [$($chapter.id)] introDialogue.$f missing"
          }
        }
      }
    }
  }
}

Write-Output '=== Grammar Manifest Validation ==='
Write-Output "Manifest: $ManifestPath"
Write-Output ("Errors: " + $errors.Count)
Write-Output ("Warnings: " + $warnings.Count)

if ($warnings.Count -gt 0) {
  Write-Output '--- Warnings ---'
  $warnings | ForEach-Object { Write-Output $_ }
}

if ($errors.Count -gt 0) {
  Write-Output '--- Errors ---'
  $errors | ForEach-Object { Write-Output $_ }
  exit 1
}

Write-Output 'Validation passed.'
exit 0
