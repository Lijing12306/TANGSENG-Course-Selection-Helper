import { spawn } from 'node:child_process';
import path from 'node:path';
import { DATA_DIR, ensureDir, writeTextFile } from '../core/storage.js';
import { logger } from '../core/logger.js';

const PS_SCRIPT = path.join(DATA_DIR, 'notify.ps1');
const SOUND = 'C:\\Windows\\Media\\notify.wav';

const PS_TOAST = `param([string]$Title, [string]$Body)
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $texts = $template.GetElementsByTagName("text")
  $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
  $texts.Item(1).AppendChild($template.CreateTextNode($Body)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("选课助手").Show($toast)
} catch {
  [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
  [System.Windows.Forms.MessageBox]::Show($Body, $Title) | Out-Null
}
`;

let scriptReady = false;
function ensureScript() {
  if (scriptReady) return PS_SCRIPT;
  ensureDir(DATA_DIR);
  writeTextFile(PS_SCRIPT, PS_TOAST);
  scriptReady = true;
  return PS_SCRIPT;
}

function runPowershell(script, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script,
    ], { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve(false); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function showToast(title, body) {
  if (process.platform !== 'win32') {
    process.stdout.write(`\u0007[通知] ${title} - ${body}\n`);
    return false;
  }
  const script = `& ${JSON.stringify(ensureScript())} -Title ${JSON.stringify(String(title))} -Body ${JSON.stringify(String(body))}`;
  return runPowershell(script);
}

export async function playSound() {
  if (process.platform !== 'win32') {
    process.stdout.write('\u0007');
    return false;
  }
  const script = `try { (New-Object Media.SoundPlayer '${SOUND}').PlaySync() } catch { [console]::beep(880,300); [console]::beep(1320,300) }`;
  return runPowershell(script, 5000);
}

export async function sendLocal({ title, body, toast = true, sound = true }) {
  logger.info(`[本地通知] ${title} - ${body}`);
  const jobs = [];
  if (toast) jobs.push(showToast(title, body));
  if (sound) jobs.push(playSound());
  await Promise.allSettled(jobs);
  return true;
}
