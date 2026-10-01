param(
  [ValidateSet('show', 'register')][string]$Action = 'show',
  [ValidateSet('Achernar.Code', 'Achernar.Desktop')][string]$AppId = 'Achernar.Code'
)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  # Register only this app for the current user. Do not change global banner,
  # sound, Focus Assist or lock-screen preferences.
  $registration = 'HKCU:\Software\Classes\AppUserModelId\' + $AppId
  $displayName = if ($AppId -eq 'Achernar.Code') { 'Achernar Code' } else { 'Achernar' }
  if (-not (Test-Path -LiteralPath $registration)) { New-Item -Path $registration -Force | Out-Null }
  if ((Get-ItemProperty -LiteralPath $registration -Name DisplayName -ErrorAction SilentlyContinue).DisplayName -ne $displayName) {
    New-ItemProperty -LiteralPath $registration -Name DisplayName -Value $displayName -PropertyType String -Force | Out-Null
  }
  if ($Action -eq 'register') { [Console]::Write('ok'); exit 0 }
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast duration="short"><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
  $text = $xml.GetElementsByTagName('text')
  $text.Item(0).AppendChild($xml.CreateTextNode([string]$payload.title)) | Out-Null
  $text.Item(1).AppendChild($xml.CreateTextNode([string]$payload.body)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(5)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId)
  $notifier.Show($toast)
  # Show creates the initial preference entry and respects OS suppression.
  if ([string]$notifier.Setting -like 'Disabled*') { exit 2 }
  [Console]::Write('ok')
} catch { exit 1 }
